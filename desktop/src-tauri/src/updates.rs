// In-app updates via the Tauri updater.
//
// Only release builds made with the signing key support updates: CI applies
// `tauri.updater.conf.json` (updater artifacts + pubkey + endpoint) when the
// key secret is configured, and that config is what compiles the updater
// plugin config into the app. Everything here degrades to `unsupported` when
// the config is absent — dev builds and unsigned releases keep working with
// the whole update surface hidden.
//
// Flow: `desktop_check_update` asks the endpoint and parks the found update in
// state; `desktop_install_update` downloads + installs it, streaming progress
// as `piwi:update-progress` events; the dashboard then calls
// `desktop_restart_app` to relaunch into the new version.
//
// Windows is the exception to that last step: its installers cannot replace
// files of a running program, so the updater quits the app as soon as the
// install starts and `desktop_install_update` never returns. The status
// carries `exits_on_install` so the dashboard can say so up front instead of
// offering a restart button that can never be reached.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter as _, Manager as _};
use tauri_plugin_updater::UpdaterExt as _;

/// Whether this build carries updater config (set at startup from the
/// compiled Tauri config).
pub struct UpdaterSupport(pub bool);

/// The update found by the last successful check, awaiting installation.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Clone, serde::Serialize)]
pub struct UpdateStatus {
    /// `unsupported` | `uptodate` | `available`
    state: &'static str,
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
    /// Whether installing quits the app instead of leaving it running until
    /// the user restarts it (true on Windows — see the module comment).
    exits_on_install: bool,
}

/// Windows installers replace files the running app holds open, so the updater
/// terminates the process to install.
const EXITS_ON_INSTALL: bool = cfg!(target_os = "windows");

impl UpdateStatus {
    fn bare(state: &'static str) -> Self {
        Self {
            state,
            version: None,
            notes: None,
            date: None,
            exits_on_install: EXITS_ON_INSTALL,
        }
    }
}

#[tauri::command]
pub async fn desktop_check_update(app: AppHandle) -> Result<UpdateStatus, String> {
    let supported = app
        .try_state::<UpdaterSupport>()
        .map(|s| s.0)
        .unwrap_or(false);
    if !supported {
        return Ok(UpdateStatus::bare("unsupported"));
    }

    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let status = UpdateStatus {
                state: "available",
                version: Some(update.version.clone()),
                notes: update.body.clone(),
                date: update.date.map(|d| d.to_string()),
                exits_on_install: EXITS_ON_INSTALL,
            };
            app.state::<PendingUpdate>()
                .0
                .lock()
                .unwrap()
                .replace(update);
            Ok(status)
        }
        None => Ok(UpdateStatus::bare("uptodate")),
    }
}

/// Download and install the update found by the last check. Progress streams
/// as `piwi:update-progress` events.
///
/// On macOS the app keeps running afterwards until the dashboard asks for the
/// restart. On Windows the installer takes over and the process is killed
/// during the install step, so this never returns there — the sidecar has to
/// be stopped first, both to release its lock on the staged server files the
/// installer overwrites and so it does not outlive the app that owns it.
#[tauri::command]
pub async fn desktop_install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .state::<PendingUpdate>()
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("no update pending — run a check first")?;

    let progress_app = app.clone();
    let finished_app = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(
                    "piwi:update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            move || {
                // The download is done and the installer is about to run. Where
                // that kills us, take the sidecar down with us; elsewhere the
                // app stays usable until the user restarts it.
                if EXITS_ON_INSTALL {
                    crate::stop_background_work(&finished_app);
                }
            },
        )
        .await
        .map_err(|e| e.to_string())
}

/// Relaunch into the installed update. `restart` replaces the process without
/// raising `ExitRequested`, so the sidecar is stopped explicitly first.
#[tauri::command]
pub fn desktop_restart_app(app: AppHandle) {
    crate::stop_background_work(&app);
    app.restart();
}
