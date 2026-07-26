// One-click MCP client configuration.
//
// The dashboard's /mcp page shows copy-paste snippets for connecting MCP
// clients; on this machine the shell can do better and write the client's own
// config file. Every client is configured the same way: a `piwi` entry inside
// the client's server map, pointing at this app's /mcp endpoint with the local
// access token as the Bearer header.
//
// Editing another app's config is done conservatively:
//   - only strict JSON is ever rewritten — a file that does not parse (JSONC
//     with comments, trailing commas) is reported as `manual` and left alone;
//   - the previous content is copied to `<file>.piwi-backup` before a write;
//   - only the `piwi` key is added, updated or removed — everything else in
//     the file is preserved as parsed.
//
// The written URL embeds the port picked at launch, which is not guaranteed
// across launches — so `heal_configured_clients` runs at startup and rewrites
// any entry that no longer matches the live URL/token.

use std::path::PathBuf;

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager as _};
use tauri_plugin_opener::OpenerExt as _;

/// The live connection details every written entry must match.
pub struct ServerInfo {
    pub port: u16,
    pub token: String,
}

impl ServerInfo {
    fn mcp_url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }
    fn bearer(&self) -> String {
        format!("Bearer {}", self.token)
    }
}

const CLIENT_IDS: [&str; 6] = [
    "claude-code",
    "claude-desktop",
    "cursor",
    "vscode",
    "windsurf",
    "gemini-cli",
];

/// The key under which clients keep their MCP server map.
fn container_key(id: &str) -> &'static str {
    match id {
        "vscode" => "servers",
        _ => "mcpServers",
    }
}

fn label_of(id: &str) -> &'static str {
    match id {
        "claude-code" => "Claude Code",
        "claude-desktop" => "Claude Desktop",
        "cursor" => "Cursor",
        "vscode" => "VS Code",
        "windsurf" => "Windsurf",
        "gemini-cli" => "Gemini CLI",
        _ => "Unknown",
    }
}

/// The `piwi` entry in each client's native shape.
fn entry_for(id: &str, info: &ServerInfo) -> Value {
    let url = info.mcp_url();
    let bearer = info.bearer();
    match id {
        "cursor" => json!({ "url": url, "headers": { "Authorization": bearer } }),
        "windsurf" => json!({ "serverUrl": url, "headers": { "Authorization": bearer } }),
        "gemini-cli" => json!({ "httpUrl": url, "headers": { "Authorization": bearer } }),
        // Claude Code, Claude Desktop and VS Code share the `type: http` shape.
        _ => json!({ "type": "http", "url": url, "headers": { "Authorization": bearer } }),
    }
}

/// Where the client keeps the config to edit, and the directory whose presence
/// means "this client is installed on this machine".
fn paths_of(app: &AppHandle, id: &str) -> Option<(PathBuf, PathBuf)> {
    let home = app.path().home_dir().ok()?;
    // ~/Library/Application Support (macOS), %APPDATA% (Windows), ~/.config (Linux).
    let config = app.path().config_dir().ok()?;
    match id {
        "claude-code" => Some((home.join(".claude.json"), home.join(".claude"))),
        "claude-desktop" => Some((
            config.join("Claude").join("claude_desktop_config.json"),
            config.join("Claude"),
        )),
        "cursor" => Some((home.join(".cursor").join("mcp.json"), home.join(".cursor"))),
        "vscode" => Some((
            config.join("Code").join("User").join("mcp.json"),
            config.join("Code").join("User"),
        )),
        "windsurf" => Some((
            home.join(".codeium")
                .join("windsurf")
                .join("mcp_config.json"),
            home.join(".codeium").join("windsurf"),
        )),
        "gemini-cli" => Some((
            home.join(".gemini").join("settings.json"),
            home.join(".gemini"),
        )),
        _ => None,
    }
}

#[derive(Clone, serde::Serialize)]
pub struct McpClientStatus {
    id: String,
    label: String,
    /// The config file the shell would edit; shown so the user can verify.
    config_path: String,
    /// `not_installed` | `not_connected` | `connected` | `stale` | `manual`
    status: &'static str,
    /// For `manual`: why the file cannot be edited safely.
    detail: Option<String>,
}

/// Pure classification of a client's parsed config against the live entry.
fn classify(existing: Option<&Value>, container: &str, expected: &Value) -> &'static str {
    match existing
        .and_then(|v| v.get(container))
        .and_then(|c| c.get("piwi"))
    {
        None => "not_connected",
        Some(current) if current == expected => "connected",
        Some(_) => "stale",
    }
}

/// Set or remove the `piwi` entry, preserving everything else. `entry: None`
/// removes. Returns the new document.
fn merge_piwi_entry(existing: Value, container: &str, entry: Option<Value>) -> Value {
    let mut root = match existing {
        Value::Object(map) => map,
        // A non-object root would be a broken config; start over rather than
        // producing invalid nesting. (Reached only for empty/new files.)
        _ => Map::new(),
    };
    let servers = root
        .entry(container.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !servers.is_object() {
        *servers = Value::Object(Map::new());
    }
    let map = servers.as_object_mut().expect("container is an object");
    match entry {
        Some(value) => {
            map.insert("piwi".to_string(), value);
        }
        None => {
            map.remove("piwi");
        }
    }
    Value::Object(root)
}

fn read_config(path: &PathBuf) -> Result<Option<Value>, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str::<Value>(&raw).map(Some).map_err(|_| {
        "the file is not plain JSON (comments or trailing commas?) — add the entry manually"
            .to_string()
    })
}

fn status_of(app: &AppHandle, id: &str, info: &ServerInfo) -> McpClientStatus {
    let (config_path, detect_dir) = match paths_of(app, id) {
        Some(paths) => paths,
        None => {
            return McpClientStatus {
                id: id.to_string(),
                label: label_of(id).to_string(),
                config_path: String::new(),
                status: "not_installed",
                detail: None,
            };
        }
    };
    let installed = detect_dir.exists() || config_path.is_file();
    let status = if !installed {
        "not_installed"
    } else {
        match read_config(&config_path) {
            Err(_) => "manual",
            Ok(existing) => classify(existing.as_ref(), container_key(id), &entry_for(id, info)),
        }
    };
    McpClientStatus {
        id: id.to_string(),
        label: label_of(id).to_string(),
        config_path: config_path.to_string_lossy().to_string(),
        status,
        detail: if status == "manual" {
            read_config(&config_path).err()
        } else {
            None
        },
    }
}

fn write_config(path: &PathBuf, doc: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Keep the previous content recoverable — this is another app's file.
    if path.is_file() {
        let _ = std::fs::copy(path, path.with_extension("piwi-backup.json"));
    }
    let body = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())? + "\n";
    std::fs::write(path, body).map_err(|e| e.to_string())
}

fn set_entry(app: &AppHandle, id: &str, connect: bool) -> Result<McpClientStatus, String> {
    let info = app
        .try_state::<ServerInfo>()
        .ok_or("server details unavailable")?;
    let (config_path, detect_dir) = paths_of(app, id).ok_or("unknown client")?;
    if !detect_dir.exists() && !config_path.is_file() {
        return Err(format!("{} does not appear to be installed", label_of(id)));
    }
    let existing = read_config(&config_path)?.unwrap_or_else(|| json!({}));
    let entry = if connect {
        Some(entry_for(id, &info))
    } else {
        None
    };
    let doc = merge_piwi_entry(existing, container_key(id), entry);
    write_config(&config_path, &doc)?;
    Ok(status_of(app, id, &info))
}

/// Rewrite the entry of every already-configured client whose URL or token no
/// longer matches — the port is not guaranteed across launches. Quietly skips
/// anything unreadable or manual.
pub fn heal_configured_clients(app: &AppHandle) {
    let Some(info) = app.try_state::<ServerInfo>() else {
        return;
    };
    for id in CLIENT_IDS {
        let status = status_of(app, id, &info);
        if status.status == "stale" {
            let _ = set_entry(app, id, true);
        }
    }
}

#[tauri::command]
pub fn desktop_mcp_clients(app: AppHandle) -> Result<Vec<McpClientStatus>, String> {
    let info = app
        .try_state::<ServerInfo>()
        .ok_or("server details unavailable")?;
    Ok(CLIENT_IDS
        .iter()
        .map(|id| status_of(&app, id, &info))
        .collect())
}

#[tauri::command]
pub fn desktop_mcp_connect(app: AppHandle, client_id: String) -> Result<McpClientStatus, String> {
    set_entry(&app, &client_id, true)
}

#[tauri::command]
pub fn desktop_mcp_disconnect(
    app: AppHandle,
    client_id: String,
) -> Result<McpClientStatus, String> {
    set_entry(&app, &client_id, false)
}

/// Reveal a client's config file in the OS file manager. The path is resolved
/// from the client id — never taken from the caller — so the webview cannot
/// reveal arbitrary paths.
#[tauri::command]
pub fn desktop_mcp_reveal(app: AppHandle, client_id: String) -> Result<(), String> {
    let (config_path, _) = paths_of(&app, &client_id).ok_or("unknown client")?;
    if !config_path.is_file() {
        return Err("the config file does not exist yet".into());
    }
    app.opener()
        .reveal_item_in_dir(&config_path)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info() -> ServerInfo {
        ServerInfo {
            port: 3000,
            token: "pd_test".into(),
        }
    }

    #[test]
    fn entry_shapes_match_each_client() {
        let i = info();
        assert_eq!(
            entry_for("cursor", &i),
            json!({ "url": "http://127.0.0.1:3000/mcp", "headers": { "Authorization": "Bearer pd_test" } })
        );
        assert_eq!(
            entry_for("windsurf", &i)["serverUrl"],
            "http://127.0.0.1:3000/mcp"
        );
        assert_eq!(
            entry_for("gemini-cli", &i)["httpUrl"],
            "http://127.0.0.1:3000/mcp"
        );
        for id in ["claude-code", "claude-desktop", "vscode"] {
            assert_eq!(entry_for(id, &i)["type"], "http");
        }
    }

    #[test]
    fn classify_distinguishes_missing_current_and_stale() {
        let i = info();
        let expected = entry_for("cursor", &i);
        assert_eq!(classify(None, "mcpServers", &expected), "not_connected");
        let empty = json!({});
        assert_eq!(
            classify(Some(&empty), "mcpServers", &expected),
            "not_connected"
        );
        let connected = json!({ "mcpServers": { "piwi": expected } });
        assert_eq!(
            classify(Some(&connected), "mcpServers", &expected),
            "connected"
        );
        let stale = json!({ "mcpServers": { "piwi": { "url": "http://127.0.0.1:9999/mcp" } } });
        assert_eq!(classify(Some(&stale), "mcpServers", &expected), "stale");
    }

    #[test]
    fn merge_preserves_unrelated_keys_and_servers() {
        let existing = json!({
            "theme": "dark",
            "mcpServers": { "other": { "command": "npx", "args": ["other-mcp"] } }
        });
        let merged = merge_piwi_entry(existing, "mcpServers", Some(json!({ "url": "u" })));
        assert_eq!(merged["theme"], "dark");
        assert_eq!(merged["mcpServers"]["other"]["command"], "npx");
        assert_eq!(merged["mcpServers"]["piwi"]["url"], "u");
    }

    #[test]
    fn merge_removes_only_the_piwi_entry() {
        let existing = json!({
            "mcpServers": { "piwi": { "url": "u" }, "other": { "command": "npx" } }
        });
        let merged = merge_piwi_entry(existing, "mcpServers", None);
        assert!(merged["mcpServers"].get("piwi").is_none());
        assert_eq!(merged["mcpServers"]["other"]["command"], "npx");
    }

    #[test]
    fn merge_creates_the_container_on_a_fresh_file() {
        let merged = merge_piwi_entry(json!({}), "servers", Some(json!({ "type": "http" })));
        assert_eq!(merged["servers"]["piwi"]["type"], "http");
    }
}
