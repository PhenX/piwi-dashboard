// Connections — the saved Piwi instances this shell can point at, and which one
// is active.
//
// The desktop app is a *host* by default: it spawns the bundled Nitro server on
// loopback and shows that private, single-user instance ("local mode"). A team,
// though, keeps its runs, clusters, diagnoses and notifications on one shared
// server. Connect mode lets the shell point its webview at that shared
// instance's own origin instead of the bundled server, so the native app becomes
// the team's dashboard rather than a second empty one.
//
// Which instance a laptop talks to is a fact about the laptop, not about any
// project, so — exactly like the per-project folder links in `runner.rs` — this
// state lives in the shell's own `settings.json`, never the server database. The
// stored shape is a list of remote instances plus the id of the active one; the
// local instance is synthetic (always present, never stored) and is the implicit
// default whenever nothing else is chosen.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt as _;

use crate::STORE_FILE;

/// `settings.json` key holding the saved *remote* instances (`Vec<Connection>`).
const CONNECTIONS_KEY: &str = "connections";
/// `settings.json` key holding the active connection's id.
const ACTIVE_KEY: &str = "activeConnectionId";

/// The stable id of the always-present local (bundled-server) connection.
pub const LOCAL_ID: &str = "local";

/// The capability granted to a remote instance's webview so it can drive this
/// shell's native commands. Distinct identifier from the shipped `remote.json`
/// (which covers the loopback origin) so the two never collide when both are
/// registered.
const REMOTE_CAPABILITY_ID: &str = "connect-mode-remote";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionKind {
    /// The bundled loopback server this app starts itself.
    Local,
    /// A shared Piwi instance reached over the network by its own origin.
    Remote,
}

/// A saved instance. `origin` is the canonical `scheme://host[:port]` for a
/// remote instance and empty for the local one (whose address is chosen per
/// launch by `pick_port`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub label: String,
    pub origin: String,
    pub kind: ConnectionKind,
}

impl Connection {
    /// The synthetic local connection — always offered, never persisted.
    pub fn local() -> Self {
        Connection {
            id: LOCAL_ID.to_string(),
            label: "This computer (local)".to_string(),
            origin: String::new(),
            kind: ConnectionKind::Local,
        }
    }

    pub fn is_remote(&self) -> bool {
        matches!(self.kind, ConnectionKind::Remote)
    }
}

/// A connection plus whether it is the active one, as sent to the webview.
#[derive(Debug, Serialize)]
struct ConnectionView {
    #[serde(flatten)]
    connection: Connection,
    active: bool,
}

// ── Origin parsing ─────────────────────────────────────────────────────────────

/// Split a canonical origin (or any `scheme://host[:port]…`) into its scheme,
/// host and explicit port. Returns `None` for anything without an `http`/`https`
/// scheme and a non-empty host. IPv6 literals are not supported — self-hosted
/// instances are reached by hostname or IPv4.
pub fn split_origin(origin: &str) -> Option<(String, String, Option<u16>)> {
    let (scheme, rest) = origin.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h, Some(p.parse::<u16>().ok()?)),
        None => (authority, None),
    };
    if host.is_empty() {
        return None;
    }
    Some((scheme, host.to_ascii_lowercase(), port))
}

/// The default TCP port for a scheme, used when the origin carries none.
pub fn default_port(scheme: &str) -> u16 {
    if scheme == "http" {
        80
    } else {
        443
    }
}

/// Parse a user-typed instance address into a canonical origin
/// (`scheme://host[:port]`, lowercased scheme and host, no path/query/fragment,
/// no trailing slash). `https` is assumed when the scheme is omitted, so
/// `piwi.example.com` and `https://piwi.example.com/setup` both normalise to
/// `https://piwi.example.com`.
///
/// Rejected — because each would make an unsafe or ambiguous capability grant:
/// an empty address, whitespace, a scheme other than http/https, a missing host,
/// embedded credentials, or a wildcard. The returned origin is what the capability
/// ACL is pinned to, so it must be exact.
pub fn normalize_origin(input: &str) -> Result<String, String> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err("Enter an instance address.".into());
    }
    if raw.chars().any(char::is_whitespace) {
        return Err("The address must not contain spaces.".into());
    }

    let (scheme, rest) = match raw.split_once("://") {
        Some((s, r)) => (s.to_ascii_lowercase(), r),
        None => ("https".to_string(), raw),
    };
    if scheme != "http" && scheme != "https" {
        return Err("The address must start with http:// or https://.".into());
    }

    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Err("The address is missing a host.".into());
    }
    if authority.contains('@') {
        return Err("Remove the username or password from the address.".into());
    }

    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => {
            let port: u16 = p
                .parse()
                .map_err(|_| "The port must be a number between 1 and 65535.".to_string())?;
            if port == 0 {
                return Err("The port must be between 1 and 65535.".into());
            }
            (h, Some(port))
        }
        None => (authority, None),
    };

    let host = host.to_ascii_lowercase();
    if host.is_empty() {
        return Err("The address is missing a host.".into());
    }
    if host.contains('*') {
        return Err("Wildcard hosts are not allowed.".into());
    }
    // A hostname or IPv4 literal: letters, digits, dots and hyphens only. This
    // also rejects `[`/`]` (IPv6) and any stray delimiter.
    if !host
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
    {
        return Err("The host contains invalid characters.".into());
    }

    Ok(match port {
        Some(p) => format!("{scheme}://{host}:{p}"),
        None => format!("{scheme}://{host}"),
    })
}

/// A human default label for an instance whose origin is known — its host and
/// (non-default) port, without the scheme.
fn label_from_origin(origin: &str) -> String {
    match split_origin(origin) {
        Some((scheme, host, Some(port))) if port != default_port(&scheme) => {
            format!("{host}:{port}")
        }
        Some((_, host, _)) => host,
        None => origin.to_string(),
    }
}

/// A short random id for a saved connection.
fn new_connection_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("conn_{hex}")
}

// ── Persisted state ────────────────────────────────────────────────────────────

/// The saved remote instances. Any local entry that somehow reached the store is
/// dropped — the local connection is synthetic and prepended on read.
fn read_connections(app: &AppHandle) -> Vec<Connection> {
    app.store(STORE_FILE)
        .ok()
        .and_then(|s| s.get(CONNECTIONS_KEY))
        .and_then(|v| serde_json::from_value::<Vec<Connection>>(v).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(Connection::is_remote)
        .collect()
}

fn write_connections(app: &AppHandle, conns: &[Connection]) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(CONNECTIONS_KEY, json!(conns));
    store.save().map_err(|e| e.to_string())
}

fn read_active_id(app: &AppHandle) -> String {
    app.store(STORE_FILE)
        .ok()
        .and_then(|s| s.get(ACTIVE_KEY))
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| LOCAL_ID.to_string())
}

fn write_active_id(app: &AppHandle, id: &str) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(ACTIVE_KEY, json!(id));
    store.save().map_err(|e| e.to_string())
}

/// The connection this launch should open: the saved active one, or the local
/// connection when nothing is saved or the saved id no longer resolves (e.g. the
/// instance was removed while it was active). Never fails — a bad or missing id
/// degrades to local, keeping the double-click-and-go promise intact.
pub fn active_connection(app: &AppHandle) -> Connection {
    let id = read_active_id(app);
    if id == LOCAL_ID {
        return Connection::local();
    }
    read_connections(app)
        .into_iter()
        .find(|c| c.id == id)
        .unwrap_or_else(Connection::local)
}

// ── The remote capability ──────────────────────────────────────────────────────

/// Build the runtime capability that lets a *remote* instance's webview call
/// this shell's native commands, pinned to the exact `origin` the user saved.
///
/// The grant is derived from the shipped `remote.json` — same windows, same
/// permission list — with only the identifier and the granted origin swapped, so
/// the connect-mode surface can never drift from the loopback one. Pinning to a
/// single exact origin (never `*`) is the whole security boundary: only the one
/// instance the user added can drive local test runs, folder reads and
/// downloads. `origin` must already be canonical (`normalize_origin`).
pub fn remote_capability_json(origin: &str) -> Result<String, String> {
    // Refuse to build a grant for anything that is not a clean origin — a
    // defence in depth so a wildcard can never reach the ACL even if a caller
    // skipped normalisation.
    let normalized = normalize_origin(origin)?;
    if normalized != origin {
        return Err("the origin must be normalised before it is granted".into());
    }

    let mut cap: Value = serde_json::from_str(include_str!("../capabilities/remote.json"))
        .map_err(|e| format!("remote.json is not valid JSON: {e}"))?;
    cap["identifier"] = json!(REMOTE_CAPABILITY_ID);
    cap["description"] = json!(format!(
        "Connect mode: grant the desktop's native commands to the connected Piwi instance at {origin}, pinned to that exact origin."
    ));
    cap["remote"] = json!({ "urls": [origin] });
    Ok(cap.to_string())
}

// ── Commands (driven by the Connections surface in the webview) ─────────────────

/// The local connection followed by every saved instance, each flagged with
/// whether it is active.
#[tauri::command]
pub fn desktop_list_connections(app: AppHandle) -> Vec<serde_json::Value> {
    let active = read_active_id(&app);
    let mut all = vec![Connection::local()];
    all.extend(read_connections(&app));
    all.into_iter()
        .map(|c| {
            let active = c.id == active;
            serde_json::to_value(ConnectionView {
                active,
                connection: c,
            })
            .unwrap_or(Value::Null)
        })
        .collect()
}

/// Save a remote instance from a user-typed URL and an optional label. Returns
/// the stored connection. Does **not** switch to it — that is an explicit second
/// step (`desktop_set_active_connection`).
#[tauri::command]
pub fn desktop_add_connection(
    app: AppHandle,
    url: String,
    label: Option<String>,
) -> Result<Connection, String> {
    let origin = normalize_origin(&url)?;
    let mut conns = read_connections(&app);
    if conns.iter().any(|c| c.origin == origin) {
        return Err("That instance is already saved.".into());
    }
    let label = label
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .unwrap_or_else(|| label_from_origin(&origin));
    let conn = Connection {
        id: new_connection_id(),
        label,
        origin,
        kind: ConnectionKind::Remote,
    };
    conns.push(conn.clone());
    write_connections(&app, &conns)?;
    Ok(conn)
}

/// Forget a saved instance. The local connection cannot be removed. If the
/// removed instance was active, the next launch falls back to local.
#[tauri::command]
pub fn desktop_remove_connection(app: AppHandle, id: String) -> Result<(), String> {
    if id == LOCAL_ID {
        return Err("The local connection cannot be removed.".into());
    }
    let mut conns = read_connections(&app);
    let before = conns.len();
    conns.retain(|c| c.id != id);
    if conns.len() == before {
        return Err("No such connection.".into());
    }
    write_connections(&app, &conns)?;
    if read_active_id(&app) == id {
        write_active_id(&app, LOCAL_ID)?;
    }
    Ok(())
}

/// Make `id` the active connection and relaunch the app onto it.
///
/// Switching re-points the webview and, in connect mode, re-scopes the native
/// capability ACL to the new origin. Both are resolved cleanly from a fresh
/// process at startup (see `lib.rs`), so a switch relaunches rather than mutating
/// a live window's granted origins — a fresh process grants exactly one origin,
/// which is the safe default for the trust boundary. Does not return on success.
///
/// Shared by the webview command and the tray's "use local" escape hatch, so a
/// user who reaches a remote instance that predates the in-app Connections card
/// can always get back to local.
pub fn activate_and_restart(app: &AppHandle, id: &str) -> Result<(), String> {
    if id != LOCAL_ID && !read_connections(app).iter().any(|c| c.id == id) {
        return Err("No such connection.".into());
    }
    write_active_id(app, id)?;
    app.restart();
}

#[tauri::command]
pub fn desktop_set_active_connection(app: AppHandle, id: String) -> Result<(), String> {
    activate_and_restart(&app, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_a_bare_host_to_https() {
        assert_eq!(
            normalize_origin("piwi.example.com").unwrap(),
            "https://piwi.example.com"
        );
    }

    #[test]
    fn strips_path_query_and_trailing_slash() {
        assert_eq!(
            normalize_origin("https://piwi.example.com/setup?x=1#top").unwrap(),
            "https://piwi.example.com"
        );
        assert_eq!(
            normalize_origin("https://piwi.example.com/").unwrap(),
            "https://piwi.example.com"
        );
    }

    #[test]
    fn keeps_an_explicit_port_and_scheme() {
        assert_eq!(
            normalize_origin("http://10.0.0.5:8080").unwrap(),
            "http://10.0.0.5:8080"
        );
    }

    #[test]
    fn lowercases_scheme_and_host() {
        assert_eq!(
            normalize_origin("HTTPS://Piwi.Example.COM").unwrap(),
            "https://piwi.example.com"
        );
    }

    #[test]
    fn rejects_unsafe_or_ambiguous_addresses() {
        for bad in [
            "",
            "   ",
            "ftp://piwi.example.com",
            "https://",
            "https:// piwi.example.com",
            "https://user:pass@piwi.example.com",
            "https://*.example.com",
            "*",
            "https://piwi.example.com:not-a-port",
            "https://piwi.example.com:0",
        ] {
            assert!(normalize_origin(bad).is_err(), "expected {bad:?} to be rejected");
        }
    }

    #[test]
    fn split_origin_reads_scheme_host_and_port() {
        assert_eq!(
            split_origin("https://piwi.example.com"),
            Some(("https".into(), "piwi.example.com".into(), None))
        );
        assert_eq!(
            split_origin("http://127.0.0.1:3000"),
            Some(("http".into(), "127.0.0.1".into(), Some(3000)))
        );
        assert_eq!(split_origin("ftp://x"), None);
        assert_eq!(split_origin("not-an-origin"), None);
    }

    #[test]
    fn default_port_follows_scheme() {
        assert_eq!(default_port("http"), 80);
        assert_eq!(default_port("https"), 443);
    }

    #[test]
    fn label_defaults_to_host_and_nondefault_port() {
        assert_eq!(label_from_origin("https://piwi.example.com"), "piwi.example.com");
        assert_eq!(label_from_origin("https://piwi.example.com:8443"), "piwi.example.com:8443");
        // The default port for the scheme is not noise worth showing.
        assert_eq!(label_from_origin("https://piwi.example.com:443"), "piwi.example.com");
        assert_eq!(label_from_origin("http://piwi.example.com:80"), "piwi.example.com");
    }

    #[test]
    fn the_local_connection_is_local_and_originless() {
        let local = Connection::local();
        assert_eq!(local.id, LOCAL_ID);
        assert!(!local.is_remote());
        assert!(local.origin.is_empty());
    }

    #[test]
    fn remote_capability_is_pinned_to_the_exact_origin() {
        let origin = "https://piwi.example.com";
        let cap: Value = serde_json::from_str(&remote_capability_json(origin).unwrap()).unwrap();

        // Pinned to exactly the one origin, never a wildcard.
        assert_eq!(cap["remote"]["urls"], json!([origin]));
        assert_eq!(cap["identifier"], json!(REMOTE_CAPABILITY_ID));
        assert!(!cap.to_string().contains('*'), "capability must never contain a wildcard");

        // The permission surface matches the shipped loopback capability, so the
        // two grants stay in lock-step.
        let shipped: Value =
            serde_json::from_str(include_str!("../capabilities/remote.json")).unwrap();
        assert_eq!(cap["permissions"], shipped["permissions"]);
        assert_eq!(cap["windows"], shipped["windows"]);
    }

    #[test]
    fn remote_capability_refuses_a_non_normalised_origin() {
        // Trailing slash / path would have been stripped by normalisation, so an
        // un-normalised origin reaching here is a bug and must not be granted.
        assert!(remote_capability_json("https://piwi.example.com/").is_err());
        assert!(remote_capability_json("piwi.example.com").is_err());
        assert!(remote_capability_json("https://*.example.com").is_err());
    }
}
