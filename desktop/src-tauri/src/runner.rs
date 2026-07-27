// Local test execution for linked project folders.
//
// A Piwi project can be linked to a folder on this machine — the checkout that
// produces its test runs. The link is what makes "run these tests locally"
// possible: the shell resolves that folder's own Playwright installation and
// executes it with the bundled Node sidecar, streaming output back to the
// dashboard webview as events. Results reach the dashboard the same way any
// local run does: the project's Playwright config already reports to Piwi, and
// the reporter discovers this app via `~/.piwi/desktop.json`.
//
// Links live in the shell's own store (`settings.json`), not the server
// database — a folder path is a fact about this machine, not about the project.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use serde_json::json;
use tauri::{AppHandle, Emitter as _, Manager as _};
use tauri_plugin_dialog::DialogExt as _;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt as _;
use tauri_plugin_store::StoreExt as _;

use crate::{node_path, STORE_FILE};

/// Store key holding the `{ project id → absolute folder path }` map.
const PROJECT_LINKS_KEY: &str = "projectLinks";

/// Event channel every local run reports on; the payload carries the run id so
/// the webview can tell concurrent runs apart.
const RUN_EVENT: &str = "piwi:local-run";

/// How many ancestors of the linked folder to search for a `node_modules`
/// containing Playwright — covers monorepos with hoisted installs.
const MAX_NODE_MODULES_WALK: usize = 12;

/// `playwright test` flags the dashboard may pass. Anything else dash-like is
/// rejected, so the webview cannot redirect config, output or reporters.
const ALLOWED_FLAGS: [&str; 12] = [
    "--headed",
    "--debug",
    "--ui",
    "--trace",
    "--repeat-each",
    "--project",
    "--grep",
    "--workers",
    "--retries",
    "--max-failures",
    "--timeout",
    "--last-failed",
];

/// Running local test processes, keyed by run id so the webview can stop one.
#[derive(Default)]
pub struct LocalRuns {
    next_id: AtomicU32,
    children: Mutex<HashMap<u32, CommandChild>>,
}

impl LocalRuns {
    /// Kill every process still tracked — called when the app exits so no
    /// orphaned test run outlives the shell.
    pub fn kill_all(&self) {
        for (_, child) in self.children.lock().unwrap().drain() {
            let _ = child.kill();
        }
    }
}

fn read_links(app: &AppHandle) -> HashMap<String, String> {
    app.store(STORE_FILE)
        .ok()
        .and_then(|s| s.get(PROJECT_LINKS_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

#[derive(serde::Serialize)]
pub struct ProjectLink {
    path: String,
    exists: bool,
}

/// Native folder picker. Returns `None` when the user cancels.
#[tauri::command]
pub async fn desktop_pick_folder(app: AppHandle) -> Option<String> {
    let dialog = app.dialog().file();
    // The blocking picker must not run on the IPC/async worker it was called
    // from — park it on a blocking thread and await the result.
    tauri::async_runtime::spawn_blocking(move || {
        dialog
            .blocking_pick_folder()
            .and_then(|f| f.into_path().ok())
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub fn desktop_get_project_link(app: AppHandle, project_id: String) -> Option<ProjectLink> {
    read_links(&app).get(&project_id).map(|p| ProjectLink {
        exists: Path::new(p).is_dir(),
        path: p.clone(),
    })
}

/// Set (`path: Some`) or clear (`path: None`) the folder linked to a project.
#[tauri::command]
pub fn desktop_set_project_link(
    app: AppHandle,
    project_id: String,
    path: Option<String>,
) -> Result<(), String> {
    if project_id.trim().is_empty() {
        return Err("missing project id".into());
    }
    let mut links = read_links(&app);
    match path {
        Some(p) => {
            let folder = PathBuf::from(&p);
            if !folder.is_absolute() {
                return Err("the folder path must be absolute".into());
            }
            if !folder.is_dir() {
                return Err("the folder does not exist".into());
            }
            links.insert(project_id, p);
        }
        None => {
            links.remove(&project_id);
        }
    }
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(PROJECT_LINKS_KEY, json!(links));
    store.save().map_err(|e| e.to_string())
}

/// Find the linked folder's own Playwright CLI entry, walking up so a package
/// inside a monorepo with a hoisted root `node_modules` still resolves.
fn resolve_playwright_cli(start: &Path) -> Option<PathBuf> {
    let candidates = ["@playwright/test/cli.js", "playwright/cli.js"];
    let mut dir = Some(start);
    for _ in 0..MAX_NODE_MODULES_WALK {
        let d = dir?;
        for candidate in candidates {
            let p = d.join("node_modules").join(candidate);
            if p.is_file() {
                return Some(p);
            }
        }
        dir = d.parent();
    }
    None
}

fn validate_args(args: &[String]) -> Result<(), String> {
    for arg in args {
        if arg.contains('\0') {
            return Err("invalid argument".into());
        }
        if arg.starts_with('-') {
            let flag = arg.split('=').next().unwrap_or(arg);
            if !ALLOWED_FLAGS.contains(&flag) {
                return Err(format!("flag not allowed: {flag}"));
            }
        }
    }
    Ok(())
}

#[derive(Clone, serde::Serialize)]
struct RunEventPayload {
    id: u32,
    kind: &'static str,
    line: Option<String>,
    code: Option<i32>,
}

/// Run `playwright test <args>` in the folder linked to `project_id`, using the
/// bundled Node sidecar and the folder's own Playwright package. Returns a run
/// id; progress arrives as `piwi:local-run` events carrying that id.
#[tauri::command]
pub async fn desktop_run_local_tests(
    app: AppHandle,
    project_id: String,
    args: Vec<String>,
) -> Result<u32, String> {
    validate_args(&args)?;

    let folder = read_links(&app)
        .get(&project_id)
        .map(PathBuf::from)
        .ok_or("no folder is linked to this project")?;
    if !folder.is_dir() {
        return Err("the linked folder no longer exists — pick it again".into());
    }
    let cli = resolve_playwright_cli(&folder).ok_or(
        "no Playwright installation found in the linked folder (or its parents) — run your package manager's install first",
    )?;

    let mut cmd_args: Vec<String> = vec![node_path(&cli), "test".into()];
    cmd_args.extend(args);

    let command = app
        .shell()
        .sidecar("node")
        .map_err(|e| e.to_string())?
        .args(cmd_args)
        .current_dir(folder)
        // Plain text for the in-app output pane.
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0");

    let (mut rx, child) = command.spawn().map_err(|e| e.to_string())?;

    let state = app.state::<LocalRuns>();
    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    state.children.lock().unwrap().insert(id, child);

    let emit_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let payload = match event {
                CommandEvent::Stdout(line) => RunEventPayload {
                    id,
                    kind: "stdout",
                    line: Some(String::from_utf8_lossy(&line).trim_end().to_string()),
                    code: None,
                },
                CommandEvent::Stderr(line) => RunEventPayload {
                    id,
                    kind: "stderr",
                    line: Some(String::from_utf8_lossy(&line).trim_end().to_string()),
                    code: None,
                },
                CommandEvent::Error(err) => RunEventPayload {
                    id,
                    kind: "error",
                    line: Some(err),
                    code: None,
                },
                CommandEvent::Terminated(status) => {
                    if let Some(runs) = emit_app.try_state::<LocalRuns>() {
                        runs.children.lock().unwrap().remove(&id);
                    }
                    RunEventPayload {
                        id,
                        kind: "exit",
                        line: None,
                        code: status.code,
                    }
                }
                _ => continue,
            };
            let _ = emit_app.emit(RUN_EVENT, &payload);
        }
    });

    Ok(id)
}

/// Stop a running local test process. A run that already exited is a no-op.
#[tauri::command]
pub fn desktop_stop_local_tests(app: AppHandle, run_id: u32) -> Result<(), String> {
    let child = app
        .state::<LocalRuns>()
        .children
        .lock()
        .unwrap()
        .remove(&run_id);
    match child {
        Some(c) => c.kill().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}
