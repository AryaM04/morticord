// App updates from GitHub Releases (the `latest.json` file of the latest
// release). The updater plugin checks the signature of the download with
// the public key in tauri.conf.json. The web app asks for a check, shows a
// prompt, and calls `install_update` only after the user agrees.
use std::sync::Mutex;

use serde::Serialize;
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update that the last check found.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

#[tauri::command]
pub async fn check_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let info = update.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
    });
    *pending.0.lock().map_err(|_| "The update state is not available.".to_owned())? = update;
    Ok(info)
}

#[tauri::command]
pub async fn install_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|_| "The update state is not available.".to_owned())?
        .take()
        .ok_or_else(|| "No update is ready. Check for updates again.".to_owned())?;
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    app.restart()
}
