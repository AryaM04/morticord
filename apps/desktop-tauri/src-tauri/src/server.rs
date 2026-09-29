// The server address of the desktop app. The user types it on the first
// start. The app keeps it in the OS key store, and adds it to the content
// security policy (CSP) of the window at start. Tauri reads the CSP only
// at start, so a new address needs a restart.
use std::collections::HashMap;
use std::time::Duration;

use tauri::utils::config::{Csp, CspDirectiveSources};
use url::Url;

use crate::secure_store;

/// The key of the server address in the secure store.
pub const SERVER_URL_KEY: &str = "server-url";
const CHECK_TIMEOUT: Duration = Duration::from_secs(5);

/// The origin of a server address, such as "https://chat.example.com" for
/// "chat.example.com". The address can have only a scheme (http or https,
/// default https), a host, a port and a "/" path.
pub fn normalize_server_address(input: &str) -> Result<String, String> {
    let text = input.trim();
    let with_scheme = if text.contains("://") { text.to_owned() } else { format!("https://{text}") };
    let invalid = || "Type a server address such as chat.example.com or http://192.168.1.5:3000.".to_owned();
    let url = Url::parse(&with_scheme).map_err(|_| invalid())?;
    let simple = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| !host.is_empty())
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none();
    if !simple {
        return Err(invalid());
    }
    Ok(url.origin().ascii_serialization())
}

/// The WebSocket origin of a server origin: "wss://" for https, "ws://" for http.
fn websocket_origin(origin: &str) -> String {
    if let Some(rest) = origin.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = origin.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        origin.to_owned()
    }
}

/// Add the server to the CSP of the config: the API and the gateway
/// (connect-src), and avatars and guild icons (img-src).
pub fn content_security_policy(base: Csp, server_origin: Option<&str>) -> Csp {
    let mut map: HashMap<String, CspDirectiveSources> = base.into();
    if let Some(origin) = server_origin {
        let connect = map.entry("connect-src".to_owned()).or_default();
        connect.push(origin);
        connect.push(websocket_origin(origin));
        map.entry("img-src".to_owned()).or_default().push(origin);
    }
    Csp::DirectiveMap(map)
}

/// The origin of this app, as the server sees it in the Origin header.
fn app_origin<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> String {
    if tauri::is_dev() {
        if let Some(dev_url) = &app.config().build.dev_url {
            return dev_url.origin().ascii_serialization();
        }
    }
    if cfg!(windows) {
        "http://tauri.localhost".to_owned()
    } else {
        "tauri://localhost".to_owned()
    }
}

/// Check that a server answers `GET /api/v1/health` and allows this app
/// (CORS). Returns the server origin.
#[tauri::command]
pub async fn check_server<R: tauri::Runtime>(app: tauri::AppHandle<R>, url: String) -> Result<String, String> {
    let origin = normalize_server_address(&url)?;
    let own_origin = app_origin(&app);
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|error| format!("The app could not make a connection: {error}"))?;
    let response = client
        .get(format!("{origin}/api/v1/health"))
        .header(reqwest::header::ORIGIN, &own_origin)
        .send()
        .await
        .map_err(|_| format!("The server at {origin} did not answer. Check the address."))?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!(
            "The server at {origin} is not ready (HTTP status {}). Check the address.",
            response.status().as_u16()
        ));
    }
    let allowed = response
        .headers()
        .get(reqwest::header::ACCESS_CONTROL_ALLOW_ORIGIN)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == own_origin || value == "*");
    if !allowed {
        return Err(format!(
            "The server does not allow this app. Add {own_origin} to CORS_ALLOWED_ORIGINS in the .env file of the server."
        ));
    }
    Ok(origin)
}

/// Keep the server address (or forget it, for null) and restart the app.
#[tauri::command]
pub fn set_server_url<R: tauri::Runtime>(app: tauri::AppHandle<R>, url: Option<String>) -> Result<(), String> {
    let service = app.config().identifier.clone();
    match url {
        Some(url) => secure_store::set(&service, SERVER_URL_KEY, &normalize_server_address(&url)?)?,
        None => secure_store::delete(&service, SERVER_URL_KEY)?,
    }
    app.restart()
}

/// Read the kept server address. A value that is not valid counts as no value.
pub fn read_server_url(service: &str) -> Option<String> {
    secure_store::get(service, SERVER_URL_KEY)
        .ok()
        .flatten()
        .and_then(|value| normalize_server_address(&value).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_server_addresses() {
        assert_eq!(normalize_server_address("chat.example.com").unwrap(), "https://chat.example.com");
        assert_eq!(normalize_server_address(" https://chat.example.com/ ").unwrap(), "https://chat.example.com");
        assert_eq!(normalize_server_address("https://chat.example.com:443").unwrap(), "https://chat.example.com");
        assert_eq!(normalize_server_address("http://localhost:3000").unwrap(), "http://localhost:3000");
        assert_eq!(normalize_server_address("http://192.168.1.5:5173/").unwrap(), "http://192.168.1.5:5173");
    }

    #[test]
    fn refuses_addresses_with_more_than_an_origin() {
        for input in [
            "",
            "ftp://example.com",
            "https://example.com/app",
            "https://example.com/?a=1",
            "https://user:pass@example.com",
            "javascript:alert(1)",
            "https://",
        ] {
            assert!(normalize_server_address(input).is_err(), "{input} must be refused");
        }
    }

    #[test]
    fn adds_the_server_to_connect_and_img_sources() {
        let base = Csp::Policy("default-src 'self'; connect-src 'self' ipc:; img-src 'self' blob:".into());
        let csp = content_security_policy(base, Some("https://chat.example.com"));
        let map: HashMap<String, CspDirectiveSources> = csp.into();
        let connect: Vec<String> = map["connect-src"].clone().into();
        let img: Vec<String> = map["img-src"].clone().into();
        assert_eq!(connect, ["'self'", "ipc:", "https://chat.example.com", "wss://chat.example.com"]);
        assert_eq!(img, ["'self'", "blob:", "https://chat.example.com"]);
    }

    #[test]
    fn uses_ws_for_an_http_server_and_adds_nothing_without_a_server() {
        let base = Csp::Policy("connect-src 'self'".into());
        let map: HashMap<String, CspDirectiveSources> =
            content_security_policy(base.clone(), Some("http://localhost:3000")).into();
        let connect: Vec<String> = map["connect-src"].clone().into();
        assert_eq!(connect, ["'self'", "http://localhost:3000", "ws://localhost:3000"]);

        let map: HashMap<String, CspDirectiveSources> = content_security_policy(base, None).into();
        let connect: Vec<String> = map["connect-src"].clone().into();
        assert_eq!(connect, ["'self'"]);
    }
}
