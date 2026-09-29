// Build the app manifest. Each app command gets its own permission
// ("allow-<command>"), so capabilities/default.json can list only the
// commands that the window needs.
fn main() {
    let commands = &[
        "desktop_init",
        "secure_get",
        "secure_set",
        "secure_delete",
        "check_server",
        "set_server_url",
        "link_preview_fetch",
        "notify",
        "set_push_to_talk",
        "set_voice_state",
        "set_close_to_tray",
        "set_unread_badge",
        "check_update",
        "install_update",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("The Tauri build step failed.");
}
