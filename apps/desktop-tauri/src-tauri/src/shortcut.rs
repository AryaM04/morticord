// The global push-to-talk shortcut. The web app sends the shortcut, such
// as "Control+Shift+KeyT", when a call starts in push-to-talk mode, and
// null when the call ends. The app then sends "push-to-talk" events (true
// for Pressed, false for Released) to the window, also while the window
// has no focus. The web app feeds them to its push-to-talk controller.
use std::sync::Mutex;

use tauri::{Emitter, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// The shortcut that is registered now, if any.
#[derive(Default)]
pub struct PushToTalk(Mutex<Option<String>>);

#[tauri::command]
pub fn set_push_to_talk(
    app: tauri::AppHandle<Wry>,
    state: tauri::State<'_, PushToTalk>,
    shortcut: Option<String>,
) -> Result<(), String> {
    let mut current = state.0.lock().map_err(|_| "The shortcut state is not available.".to_owned())?;
    if let Some(old) = current.take() {
        let _ = app.global_shortcut().unregister(old.as_str());
    }
    if let Some(new) = shortcut {
        app.global_shortcut()
            .on_shortcut(new.as_str(), |app, _shortcut, event| {
                let pressed = event.state() == ShortcutState::Pressed;
                let _ = app.emit_to("main", "push-to-talk", pressed);
            })
            .map_err(|error| format!("The system did not accept the shortcut: {error}"))?;
        *current = Some(new);
    }
    Ok(())
}
