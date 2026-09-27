// Minimal Tauri application setup.
//
// This shell only loads the web app in a native window. It has no plugins
// yet. Later milestones add push-to-talk, tray icons, deep links and an
// updater (see the plan, section 8).
//
// Camera, microphone and screen share permission prompts come from the
// operating system webview (WebView2 on Windows, WKWebView on macOS). No
// extra Rust code is needed for them on Windows: WebView2 shows its own
// permission prompt for `getUserMedia` and `getDisplayMedia`, the same as
// Edge does.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the desktop shell");
}
