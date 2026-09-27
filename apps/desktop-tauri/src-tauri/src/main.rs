// Entry point. All real setup lives in lib.rs so tests and mobile targets
// can reuse it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    desktop_tauri_lib::run();
}
