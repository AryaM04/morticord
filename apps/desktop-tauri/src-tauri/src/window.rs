// The main window: show it, keep it in the tray on close (a setting), and
// put the unread count on the taskbar button (Windows) or the dock icon
// (macOS).
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Manager;

/// The "close to the tray" setting. The web app sends it at start.
pub struct CloseToTray(pub AtomicBool);

/// Show the main window, and give it the focus.
pub fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Hide the window instead of closing it, when the setting is on.
pub fn on_window_event<R: tauri::Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let keep = window.app_handle().state::<CloseToTray>().0.load(Ordering::Relaxed);
        if keep {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

#[tauri::command]
pub fn set_close_to_tray(state: tauri::State<'_, CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

/// A red dot, 16 x 16 pixels, as RGBA. Windows shows it on the taskbar button.
#[cfg_attr(not(windows), allow(dead_code))]
fn badge_dot() -> Vec<u8> {
    const SIZE: i32 = 16;
    let mut pixels = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            // The distance from the center, doubled, so the center is 15 and not 7.5.
            let dx = 2 * x + 1 - SIZE;
            let dy = 2 * y + 1 - SIZE;
            let inside = dx * dx + dy * dy <= SIZE * SIZE;
            pixels.extend_from_slice(if inside { &[0xe0, 0x40, 0x40, 0xff] } else { &[0, 0, 0, 0] });
        }
    }
    pixels
}

/// Show the count of unread direct messages and mentions. Zero removes the badge.
#[tauri::command]
pub fn set_unread_badge<R: tauri::Runtime>(app: tauri::AppHandle<R>, count: u32) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    #[cfg(windows)]
    {
        let icon = (count > 0).then(|| tauri::image::Image::new_owned(badge_dot(), 16, 16));
        window.set_overlay_icon(icon).map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        let value = (count > 0).then_some(i64::from(count));
        window.set_badge_count(value).map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draws_a_round_dot() {
        let pixels = badge_dot();
        assert_eq!(pixels.len(), 16 * 16 * 4);
        let alpha = |x: usize, y: usize| pixels[(y * 16 + x) * 4 + 3];
        assert_eq!(alpha(8, 8), 0xff);
        assert_eq!(alpha(0, 0), 0);
        assert_eq!(alpha(15, 15), 0);
    }
}
