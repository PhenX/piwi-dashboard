// Piwi Dashboard desktop shell.
//
// This wraps the *same* Nuxt/Nitro server that ships as the Docker image and the
// `@piwitests/server` npm package. On launch it:
//   1. resolves a per-user data directory (OS app-data dir, survives updates),
//   2. spawns the bundled server as a Node sidecar on a private loopback port,
//   3. waits for `GET /api/health` to return 200 (i.e. the DB has migrated),
//   4. points the window at the local server via a one-time token bootstrap.
// A tray icon offers "run in background" (keep serving after the window closes)
// and "start on login". Everything binds 127.0.0.1 — nothing is exposed to the
// network.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent, WindowEvent};

use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt as _;
use tauri_plugin_store::StoreExt as _;

const STORE_FILE: &str = "settings.json";
const RUN_BG_KEY: &str = "runInBackground";
const READY_TIMEOUT_SECS: u64 = 60;
/// Preferred loopback port — stable so the reporter can target it; falls back to
/// a free port if it's already in use (see `pick_port`).
const PREFERRED_PORT: u16 = 3000;

/// Holds the running Node sidecar so it can be stopped cleanly on quit.
#[derive(Default)]
struct ServerProcess(Mutex<Option<CommandChild>>);

/// Shared "keep serving after the window closes" flag (tray toggle + close handler).
struct RunInBackground(Arc<AtomicBool>);

/// The user's data directory — used by the "Open data folder" tray item.
struct DataDir(PathBuf);

fn random_hex_32() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Prefer a stable port (so the address is bookmarkable and the reporter can
/// target it) and fall back to any free loopback port if it's taken. A small
/// TOCTOU window remains between picking and the server binding; if the port is
/// lost in between the server fails to boot, surfacing as a readiness timeout.
fn pick_port() -> u16 {
    if std::net::TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).is_ok() {
        return PREFERRED_PORT;
    }
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .expect("failed to acquire a free loopback port")
}

/// Dependency-free readiness probe. `/api/health` returns 200 only after the
/// database has migrated, so a 200 means the app is ready to load.
fn health_ok(port: u16) -> bool {
    use std::io::{Read, Write};
    let Ok(mut stream) = std::net::TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let req =
        format!("GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 128];
    match stream.read(&mut buf) {
        Ok(n) => String::from_utf8_lossy(&buf[..n]).contains(" 200 "),
        Err(_) => false,
    }
}

/// Read the persisted master encryption key, or generate + persist one on first
/// run. Kept stable so secrets stored in the DB (AI keys, SCM tokens) stay
/// readable across launches. Lives in the user-scoped app-data dir.
fn load_or_create_secret(app_data_dir: &PathBuf) -> String {
    let key_path = app_data_dir.join("secret.key");
    if let Ok(existing) = std::fs::read_to_string(&key_path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    let secret = random_hex_32();
    let _ = std::fs::write(&key_path, &secret);
    secret
}

/// Read the persisted access token, or generate one on first run. Stable (not
/// per-launch) so the Playwright reporter can be configured once, and prefixed
/// `pd_` so the reporter's existing API-key path sends it as `Authorization:
/// Bearer`. Both the window (via cookie) and the reporter (via bearer) present
/// this same token; only someone who can open this app can read it.
fn load_or_create_token(app_data_dir: &PathBuf) -> String {
    let path = app_data_dir.join("reporter-token");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    let token = format!("pd_{}", random_hex_32());
    let _ = std::fs::write(&path, &token);
    token
}

/// Append a line to the server log. A release build is a windowed app with no
/// console, so the sidecar's output and any startup errors would otherwise be
/// invisible — this makes them readable via the data folder's `logs/server.log`.
fn append_log(path: &std::path::Path, line: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

pub fn run() {
    let launched_hidden = std::env::args().any(|a| a == "--hidden");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch just focuses the running window (never a 2nd server).
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(ServerProcess::default())
        .setup(move |app| {
            // --- data locations (survive app updates; outside the read-only bundle) ---
            let app_data_dir = app.path().app_data_dir()?;
            let data_dir = app_data_dir.join(".data");
            let storage_dir = data_dir.join("storage");
            // Setting PIWI_DATABASE_PATH disables the server's own auto-mkdir, and
            // libSQL will not create the DB's parent dir — so create it here.
            std::fs::create_dir_all(&storage_dir)?;
            let db_path = data_dir.join("piwi.db");

            // Server logs go to a file so failures are visible in a windowed
            // (console-less) release build — read it via the "Open data folder"
            // tray item, under logs/server.log.
            let log_dir = app_data_dir.join("logs");
            let _ = std::fs::create_dir_all(&log_dir);
            let log_path = log_dir.join("server.log");
            append_log(&log_path, "----- launch -----");

            let secret = load_or_create_secret(&app_data_dir);
            let token = load_or_create_token(&app_data_dir);
            let port = pick_port();

            app.manage(DataDir(data_dir.clone()));

            // --- run-in-background flag (persisted across launches) ---
            let run_bg_initial = app
                .store(STORE_FILE)
                .ok()
                .and_then(|s| s.get(RUN_BG_KEY))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let run_bg = Arc::new(AtomicBool::new(run_bg_initial));
            app.manage(RunInBackground(run_bg.clone()));

            // --- resolve the bundled server entry (shipped unpacked via resources) ---
            // Tauri may place the resource at <res>/resources/app-server (preserving
            // the config-relative path) or <res>/app-server — accept either.
            let resource_dir = app.path().resource_dir()?;
            let candidates = [
                resource_dir
                    .join("resources")
                    .join("app-server")
                    .join(".output")
                    .join("server")
                    .join("index.mjs"),
                resource_dir
                    .join("app-server")
                    .join(".output")
                    .join("server")
                    .join("index.mjs"),
            ];
            let server_entry = candidates
                .iter()
                .find(|p| p.exists())
                .cloned()
                .unwrap_or_else(|| candidates[0].clone());
            append_log(
                &log_path,
                &format!(
                    "server entry: {} (exists: {}), port: {}",
                    server_entry.display(),
                    server_entry.exists(),
                    port
                ),
            );

            // --- spawn the Node sidecar running the Nitro server ---
            // Best-effort: a spawn failure is logged and surfaces as a readiness
            // timeout (the splash shows an error) instead of a silent panic.
            match app.shell().sidecar("node") {
                Err(e) => append_log(&log_path, &format!("sidecar 'node' not found: {e}")),
                Ok(cmd) => {
                    let cmd = cmd
                        .args([server_entry.to_string_lossy().to_string()])
                        .env("NODE_ENV", "production")
                        .env("NITRO_HOST", "127.0.0.1")
                        .env("NITRO_PORT", port.to_string())
                        .env("PIWI_DATABASE_PATH", db_path.to_string_lossy().to_string())
                        .env("PIWI_STORAGE_PATH", storage_dir.to_string_lossy().to_string())
                        .env("PIWI_SECRET_KEY", secret)
                        .env("PIWI_DESKTOP_TOKEN", token.clone());

                    match cmd.spawn() {
                        Err(e) => append_log(&log_path, &format!("failed to spawn server: {e}")),
                        Ok((mut rx, child)) => {
                            app.state::<ServerProcess>().0.lock().unwrap().replace(child);

                            // Tee the sidecar's output to the log file (no console in release).
                            let drain_log = log_path.clone();
                            tauri::async_runtime::spawn(async move {
                                use tauri_plugin_shell::process::CommandEvent;
                                while let Some(event) = rx.recv().await {
                                    match event {
                                        CommandEvent::Stdout(line) => append_log(
                                            &drain_log,
                                            &format!("[server] {}", String::from_utf8_lossy(&line).trim_end()),
                                        ),
                                        CommandEvent::Stderr(line) => append_log(
                                            &drain_log,
                                            &format!("[server:err] {}", String::from_utf8_lossy(&line).trim_end()),
                                        ),
                                        CommandEvent::Error(err) => {
                                            append_log(&drain_log, &format!("[server:proc] {err}"))
                                        }
                                        CommandEvent::Terminated(p) => append_log(
                                            &drain_log,
                                            &format!("[server] exited: code={:?} signal={:?}", p.code, p.signal),
                                        ),
                                        _ => {}
                                    }
                                }
                            });
                        }
                    }
                }
            }

            // --- when the server is ready, navigate the window to it ---
            let nav_handle = app.handle().clone();
            let ready_log = log_path.clone();
            let bootstrap_url = format!("http://127.0.0.1:{port}/__piwi/session?token={token}");
            std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(READY_TIMEOUT_SECS);
                let mut ready = false;
                while Instant::now() < deadline {
                    if health_ok(port) {
                        ready = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
                append_log(
                    &ready_log,
                    if ready { "server ready" } else { "server NOT ready within timeout" },
                );
                let inner = nav_handle.clone();
                let _ = nav_handle.run_on_main_thread(move || {
                    if let Some(w) = inner.get_webview_window("main") {
                        if ready {
                            let _ =
                                w.eval(&format!("window.location.replace('{bootstrap_url}')"));
                        } else {
                            let _ = w.eval(
                                "var s=document.querySelector('.status');if(s){s.textContent='The server did not start in time. Quit and relaunch, or check the logs.';}",
                            );
                            let _ = w.show();
                        }
                    }
                });
            });

            // --- tray ---
            let open_i = MenuItemBuilder::with_id("open", "Open Piwi Dashboard").build(app)?;
            let folder_i = MenuItemBuilder::with_id("open_folder", "Open data folder").build(app)?;
            let bg_i = CheckMenuItemBuilder::with_id("run_bg", "Run in background")
                .checked(run_bg_initial)
                .build(app)?;
            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let login_i = CheckMenuItemBuilder::with_id("autostart", "Start on login")
                .checked(autostart_enabled)
                .build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quit Piwi Dashboard").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&open_i)
                .item(&folder_i)
                .separator()
                .item(&bg_i)
                .item(&login_i)
                .separator()
                .item(&quit_i)
                .build()?;

            let menu_run_bg = run_bg.clone();
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Piwi Dashboard")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "open_folder" => {
                        let dir = app.state::<DataDir>().0.clone();
                        let _ = app
                            .opener()
                            .open_path(dir.to_string_lossy().to_string(), None::<&str>);
                    }
                    "run_bg" => {
                        let next = !menu_run_bg.load(Ordering::SeqCst);
                        menu_run_bg.store(next, Ordering::SeqCst);
                        let _ = bg_i.set_checked(next);
                        if let Ok(store) = app.store(STORE_FILE) {
                            store.set(RUN_BG_KEY, json!(next));
                            let _ = store.save();
                        }
                    }
                    "autostart" => {
                        let mgr = app.autolaunch();
                        let enabled = mgr.is_enabled().unwrap_or(false);
                        let _ = if enabled { mgr.disable() } else { mgr.enable() };
                        let _ = login_i.set_checked(!enabled);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // If autostarted with --hidden, stay in the tray instead of popping up.
            if launched_hidden {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let keep = window
                    .try_state::<RunInBackground>()
                    .map(|s| s.0.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if keep {
                    // Hide to tray and keep the server running.
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the Piwi Dashboard app")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Best-effort: stop the bundled server so no orphan process lingers.
                if let Some(child) = app_handle.state::<ServerProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
