// The desktop app. It loads the web build in a native window and adds what
// a browser tab cannot do: the OS key store, system notifications, a
// global push-to-talk shortcut, a tray icon, deep links, link previews
// without a server, and updates. See docs/concepts/desktop-shells.md.
//
// Camera, microphone and screen share permission prompts come from the
// operating system webview (WebView2 on Windows, WKWebView on macOS).
use std::sync::atomic::AtomicBool;

use serde::Serialize;
use tauri_plugin_window_state::StateFlags;

mod deep_link;
mod link_preview;
mod notify;
mod secure_store;
mod server;
mod shortcut;
mod tray;
mod updates;
mod window;

/// The server origin that the content security policy of this start allows.
struct ServerUrl(Option<String>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInit {
    os: &'static str,
    version: String,
    server_url: Option<String>,
    deep_links: Vec<String>,
}

/// The start data for the web app. It also ends the wait of the start deep links.
#[tauri::command]
fn desktop_init(
    app: tauri::AppHandle,
    server: tauri::State<'_, ServerUrl>,
    links: tauri::State<'_, deep_link::PendingLinks>,
) -> DesktopInit {
    DesktopInit {
        os: std::env::consts::OS,
        version: app.package_info().version.to_string(),
        server_url: server.0.clone(),
        deep_links: links.take(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    // Tauri reads the content security policy only at start. Add the server
    // that the user chose, so the window can connect to it and nothing else.
    let server_url = server::read_server_url(&context.config().identifier);
    if let Some(csp) = context.config().app.security.csp.clone() {
        context.config_mut().app.security.csp = Some(server::content_security_policy(csp, server_url.as_deref()));
    }

    tauri::Builder::default()
        // First plugin: a second start of the app gives its deep link to
        // this instance and then stops.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| window::show_main(app)))
        .plugin(tauri_plugin_deep_link::init())
        // Restore the size and the position, but not the visibility: a
        // window that was in the tray at exit must show at the next start.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ServerUrl(server_url))
        .manage(window::CloseToTray(AtomicBool::new(true)))
        .manage(shortcut::PushToTalk::default())
        .manage(updates::PendingUpdate::default())
        .setup(|app| {
            deep_link::setup(app.handle())?;
            tray::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(window::on_window_event)
        .invoke_handler(tauri::generate_handler![
            desktop_init,
            secure_store::secure_get,
            secure_store::secure_set,
            secure_store::secure_delete,
            server::check_server,
            server::set_server_url,
            link_preview::link_preview_fetch,
            notify::notify,
            shortcut::set_push_to_talk,
            tray::set_voice_state,
            window::set_close_to_tray,
            window::set_unread_badge,
            updates::check_update,
            updates::install_update,
        ])
        .build(context)
        .expect("The desktop app could not start.")
        .run(|_app, _event| {
            // A click on the dock icon shows the window again.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                window::show_main(_app);
            }
        });
}
