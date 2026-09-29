// The tray icon and its menu: Show, Mute, Deafen and Quit. Mute and Deafen
// work only during a call. The web app owns the call state: the menu sends
// "tray-action" events to it, and the web app sends the new state back
// with `set_voice_state`.
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, Wry};

use crate::window::show_main;

/// The menu items that follow the call state.
pub struct VoiceMenuItems {
    mute: CheckMenuItem<Wry>,
    deafen: CheckMenuItem<Wry>,
}

pub fn setup(app: &tauri::AppHandle<Wry>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let mute = CheckMenuItem::with_id(app, "mute", "Mute", false, false, None::<&str>)?;
    let deafen = CheckMenuItem::with_id(app, "deafen", "Deafen", false, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &mute,
            &deafen,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip(app.package_info().name.clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "mute" => {
                let _ = app.emit_to("main", "tray-action", "mute");
            }
            "deafen" => {
                let _ = app.emit_to("main", "tray-action", "deafen");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(VoiceMenuItems { mute, deafen });
    Ok(())
}

#[tauri::command]
pub fn set_voice_state(items: tauri::State<'_, VoiceMenuItems>, in_call: bool, muted: bool, deafened: bool) -> Result<(), String> {
    let update = || -> tauri::Result<()> {
        items.mute.set_enabled(in_call)?;
        items.mute.set_checked(in_call && muted)?;
        items.deafen.set_enabled(in_call)?;
        items.deafen.set_checked(in_call && deafened)?;
        Ok(())
    };
    update().map_err(|error| error.to_string())
}
