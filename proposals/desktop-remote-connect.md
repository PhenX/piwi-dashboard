# Dual-mode desktop app — connect to a remote instance

A proposal to let the Tauri desktop app do one thing it cannot do today: point at a Piwi instance someone else is
running, instead of only the server it bundles and starts itself. Nothing here has shipped. The document argues that
this is mostly a matter of *connecting pieces the codebase already has* rather than building a new subsystem, stages
the work so each stage stands on its own, and records the security model, the team story, the alternatives and the
open questions.

**Summary.** The desktop app is a **host**: on launch the Rust shell picks a loopback port, spawns the same
Nitro server the Docker image runs as a Node sidecar, waits for `/api/health`, and points its webview at
`http://127.0.0.1:<port>` (`apps/desktop/src-tauri/src/lib.rs`). Everything binds `127.0.0.1`; it is single-user and
runs with auth off. That is a great zero-config onramp and a poor fit for a team, whose runs, clusters, diagnoses and
notifications all live on one shared server. Yet almost everything needed to connect to that shared server already
exists: the server is a full multi-user system the moment `PIWI_AUTH_ENABLED=true` (sealed session cookies, per-user
API keys, three roles, per-project assignments, OAuth SSO — `server/utils/auth.ts`, `server/utils/project-access.ts`),
the reporter's *default* submission path is already remote (`PIWI_DASHBOARD_URL` + `PIWI_API_KEY`), and the browser
extension already has a "connected mode" that talks to a remote instance with a URL and an API key. The proposal keeps
today's local mode as the default and adds a **connect mode** in three stages: (1) the shell can point its webview at a
configured instance and authenticate through that instance's own login page; (2) the genuinely local capabilities —
running Playwright in a linked checkout, importing an archive off disk, the MCP bridge, native notifications — operate
against the remote instance; (3) expansion: multiple saved instances and a hand-off from the hosted web app to the
local one. Each stage is independently shippable and degrades to today's behavior when a user never connects to
anything.

## Problem

The desktop app conflates two things that are actually separate: *where the data lives* and *what the local app can
do*. Because it hosts the server, it can only ever show **its own** local data, and only one person's.

### 1. A team's data is on one server; the desktop app can only see its own

Piwi is self-hosted for teams — the normal deployment is one server (Docker, a one-click template, or `npx
@piwitests/server`) that CI and every engineer's reporter submit to. That server already accumulates the shared
history, failure clusters, AI diagnoses, CODEOWNERS-derived ownership and notification subscriptions that make Piwi
worth running. A teammate who installs the desktop app gets **none of it**: the app starts a *second, empty, private*
server on their laptop. There is no way to say "show me our instance." The one artifact of team identity the desktop
app surfaces — `DesktopReporterCard` — displays the loopback URL and token of the private local server, i.e. the
opposite of the shared one.

### 2. The local superpowers are stranded on the local data

The desktop app's real, browser-impossible value is **local-machine access**, and today it can only be aimed at the
local server:

- Run Playwright in a linked checkout and stream results back — `runner.rs` (`desktop_run_local_tests`).
- Native folder pick and checkout inspection — `runner.rs` (`desktop_pick_folder`), `inspect.rs`
  (`desktop_inspect_folder`).
- Import a trace archive straight off disk by path, drag-drop or "Open with" — `server/api/desktop/import-local.post.ts`,
  fed by the shell's `collect_zip_args` / `PendingOpenFiles` queue in `lib.rs`.
- One-click MCP-client configuration — `mcp_clients.rs`.
- Shell affordances — Downloads (`desktop_save_download`), OS notifications (`desktop_notify`), tray badge, autostart.

An engineer who runs a test locally through the app has the results land in the private local database, not the team's
dashboard where a teammate could see them. The capability is right; its target is wrong.

### 3. Everything else people assume is "local" already runs remotely

Worth stating because it bounds the work. The trace viewer is Playwright's **web build**, served as static assets at
`/trace-viewer/` (`nuxt.config.ts`) and fetching trace zips over `/api/files/...` — it runs in the browser against any
instance. The MCP server is a DB-backed API over `/mcp` (`shared/mcp-tools.ts`); the desktop's `mcp_stdio.rs` is a
stdio↔HTTP *transport bridge*, not a capability, and exists only because Claude Desktop loads stdio servers. The
snapshot locator picker, trace parsing and reporter submission are all API or browser work. None of them need a change
to work remotely. The design therefore does **not** touch them.

## What already works remotely, and what is genuinely local

| Capability | Where | Remote today? |
|---|---|---|
| Reporter submission | `packages/reporter/src/internal/config/env.ts` `resolveOptions` | **Yes** — `PIWI_DASHBOARD_URL` + `PIWI_API_KEY` is the default path; local `~/.piwi/desktop.json` discovery is a last resort |
| Browser-extension picker | `apps/extension/src/shared/piwi-client.ts`, `connection-settings.ts` | **Yes** — "connected mode" with instance URL + API key |
| Dashboard UI + all read/query | Nuxt SPA + `server/api/**` | **Yes** — plain web app; a browser already does this |
| Trace viewer | `/trace-viewer/` (`nuxt.config.ts`) + `/api/files/...` | **Yes** — bundled web build, same-origin |
| MCP server | `/mcp`, `shared/mcp-tools.ts` | **Yes** — DB-backed API; `mcp_stdio.rs` is transport only |
| Snapshot locator picker | `app/components/shared/SnapshotLocatorPicker.vue` | **Yes** — renders a stored snapshot |
| Run Playwright in a checkout | `runner.rs` `desktop_run_local_tests` | **No — inherently local** |
| Native folder pick + inspect | `runner.rs`, `inspect.rs` | **No — inherently local** |
| Import archive by path / drag-drop | `server/api/desktop/import-local.post.ts`, `lib.rs` | **No — inherently local** (reads bytes off disk) |
| Configure local MCP clients | `mcp_clients.rs` | **No — inherently local** |
| Downloads / notifications / tray / autostart | `lib.rs` | **No — inherently local** |

The pattern: the entire dashboard is already portable, and the desktop's differentiator is the bottom five rows. The
design's job is to let those five rows point at a remote instance — not to re-host the dashboard.

## Why this is not a hosted SaaS

The roadmap's non-goal is explicit: *"A hosted SaaS — Piwi is built to be self-hosted; your data stays yours."* This
proposal does not cross it. What the non-goal forbids is **Piwi operating a multi-tenant hosted service**. Connect mode
does the opposite: it points a native client at **the team's own self-hosted instance** — the same server the roadmap
already expects them to run. No Piwi-operated infrastructure, no tenancy, no data leaving the team's server. It is the
native equivalent of opening the team's dashboard in a browser tab, which nobody would call SaaS.

## Design

Keep local mode as the default zero-config onramp. Add connect mode in three independently shippable stages.

### Stage 1 — Connect the webview to a remote instance

Today the shell has one server target, built once and set with a single `window.location.replace(...)` in `lib.rs`,
and its only persisted setting is `runInBackground` in the `tauri_plugin_store` `settings.json`. Stage 1 introduces a
**connections** concept — a saved list of instances plus one active connection — and generalizes the target:

- **Target.** The webview navigates to the configured instance origin (`https://piwi.example.com`) instead of the
  loopback URL. Because the webview then *is* on that origin, the instance's own pages, cookies and same-origin
  `/api` fetches behave exactly as in a browser (see [Auth](#auth-via-the-existing-login-form)).
- **Skip the sidecar.** In connect mode the shell does not pick a port or spawn the Node sidecar — there is no local
  server. The health probe becomes a reachability check against the remote origin.
- **HTTPS, not just HTTP.** Two helpers assume plaintext loopback and must learn TLS: `health_ok` in `lib.rs` (a
  hand-rolled `HTTP/1.0` probe over a raw `TcpStream`) and `split_http_url` in `mcp_stdio.rs` (accepts only an
  `http://` origin). Both gain `https://` with certificate validation.
- **CSP.** The desktop CSP sets `connect-src 'self'` (`server/plugins/desktop-csp.ts`); once `self` *is* the remote
  origin this is satisfied automatically — but it is a server-side header, so it only applies while the webview is on a
  Piwi origin, which is exactly the case.
- **Capability ACL — the sensitive part.** The Tauri capability that lets the webview invoke native commands is scoped
  to `http://localhost:*` / `http://127.0.0.1:*` (`apps/desktop/src-tauri/capabilities/remote.json`). For a remote
  origin webview to drive local commands, that ACL must include the configured origin — pinned to the exact
  origin(s) the user added, **never `*`**, and re-evaluated when the active connection changes. This is the new trust
  boundary; the security section treats it head-on.

### Stage 2 — Aim the local superpowers at the remote instance

With the webview connected, wire the five local capabilities to the remote server:

- **Local test runs.** `runner.rs` already spawns the checkout's own Playwright; it need only inject
  `PIWI_DASHBOARD_URL` + `PIWI_API_KEY` (the active connection's origin and the device key) into the child process.
  The reporter's `resolveOptions` precedence already prefers those over local discovery, so results submit to the team
  instance with **no reporter change**. This is the feature that matters most: an engineer runs a test locally and the
  whole team sees it.
- **Import by path.** `import-local.post.ts` reads bytes *server-side*, which only works when the server and the file
  are the same machine — untrue in connect mode. Instead the shell reads the archive locally and uploads it to the
  existing multipart endpoint `server/api/test-runs/import.post.ts` (the same path the in-browser import page uses).
  Drag-drop and "Open with" still work; the bytes travel over an authenticated upload rather than a path.
- **MCP bridge.** `mcp_stdio.rs` already reads its target from a discovery file and POSTs to `/mcp`; point it at the
  active connection and authenticate with the device key over HTTPS.
- **Notifications.** Native notifications reflect the signed-in user's own subscriptions on the team instance.

### Stage 3 — Expansion (re-argue after 1–2)

Multiple saved instances with fast switching; per-instance identity in the UI; and a **hand-off** from the hosted web
app to the local app via a deep link (open a linked checkout, start a local run) — the genuine "companion" gesture,
worth designing only once connect mode is real.

## Per-machine state, mode selection, and auth

Three questions decide whether this is pleasant to use. Each has a concrete answer the codebase already points at.

### Per-machine state is client-local by design

A folder path is a fact about a machine, not about a project — `runner.rs` says exactly this and already stores
project→folder links in the shell's own `settings.json`, not the server database. Connect mode extends the principle
rather than reworking it:

- **Local mode** uses the per-user data dir (`app_data_dir()/.data`) for the bundled server's database and storage.
  **Connect mode uses none of it** — the remote instance owns every run; the laptop holds only client-local state.
- The only local state in connect mode is the connection list, the per-project folder links and the keychain
  credential — none of it synced to the server. Two teammates linking the same remote project to different checkouts
  (`/Users/alice/repo` vs `/home/bob/work/repo`) are both correct.
- Concretely, the folder-link map grows one level, from `projectId → path` to `instanceId → projectId → path`, so a
  machine can carry links for its local instance and each remote one without collision.

### Mode is chosen after first launch, and is reversible

First launch stays **local, with no decision to make** — the double-click-and-go promise is the reason the desktop app
exists, and a "pick your server" wall on first run would spend it. Connecting is an explicit, reversible action:

- A **Connections** surface lists "This computer (local)" plus any saved team instances, with "Add a team instance"
  taking a URL. The active connection and the saved list live in `settings.json` beside `runInBackground`.
- The choice is per-launch with a remembered default: on start the app reconnects to the last-used instance, falling
  back to local if it is unreachable. Switching re-points the webview and re-scopes the capability ACL to the new
  origin.

### Auth via the existing login form

Yes for the interactive experience — with one API key for the tools that run outside the webview. Two surfaces, two
credentials:

- **Webview → the instance's own `/login` page and its session cookie.** Because the webview is on the remote origin,
  `app/pages/login.vue` (username/password, first-admin setup, and OAuth buttons driven by
  `config.public.oauthProviders`) renders as-is, and the sealed httpOnly `piwi_session` cookie set by
  `server/utils/auth.ts` is stored and sent same-origin — no CORS, no cross-origin cookie handling, **no new login
  UI.** The native app is the browser experience, wrapped.
- **Out-of-webview tools → a per-user API key in the OS keychain.** The spawned Playwright reporter (`runner.rs`) and
  the MCP bridge (`mcp_stdio.rs`) are separate processes that cannot read the webview's cookie, so they authenticate
  with a `pd_` API key — already first-class: `POST /api/users/[id]/api-keys` mints one for any signed-in user (roles
  `administrator`/`reporter`/`user`), returning the plaintext once, and `settings/users.vue` manages them today. The
  intended flow mints a **device-scoped key automatically after sign-in** — the fresh session cookie authorizes the
  POST, the key is named for the device (e.g. `Piwi Desktop — <hostname>`), and the once-returned plaintext goes into
  the OS keychain, revocable per device from the server. Pasting a key created in the dashboard is the fallback. Local
  mode is unchanged: the `pd_`-prefixed desktop token in `~/.piwi/desktop.json` keeps working.

## Security model

The server is already secure enough for a team; the work is on the client, and it is well-scoped.

- **No new server auth.** With `PIWI_AUTH_ENABLED=true` the instance already enforces sealed session cookies (7-day,
  encrypted with `PIWI_AUTH_SECRET`, fail-closed at boot per `server/plugins/auth-config.ts`), per-user API keys
  (sha256-stored, `Authorization: Bearer` or `X-API-Key`), three roles and per-project assignments
  (`server/utils/project-access.ts`), OAuth SSO with domain/org allowlists, auth-endpoint rate limiting, and session
  revocation via `users.sessionEpoch`. A desktop client authenticates exactly like a browser or a reporter.
- **Same-origin cookie, so no cross-origin surface.** Because the webview is on the remote origin, the permissive
  `cors: true` on `/api/**` and the `sameSite=lax` CSRF posture are not stretched by connect mode — the interactive
  path is ordinary same-origin traffic.
- **One stored secret, in the OS keychain.** The device API key is the only credential at rest; it belongs in the
  platform keychain, not a plaintext file, and is revocable per device server-side.
- **TLS end to end.** The `http://`-only probe and URL parser are replaced with `https://` plus certificate
  validation; intranet instances with private CAs are an explicit open question below.
- **The capability grant is the real boundary.** Connecting to an instance means its web app can invoke native
  commands — run local tests, read folders, write downloads, post notifications. This must be stated plainly to the
  user, pinned to the exact configured origin(s), never widened to `*`, and dropped when the connection is removed.
  Connecting to an instance is trusting that instance's web app with local-machine actions, the same way installing its
  reporter is trusting it with your test process.
- **Update trust unchanged.** In-app updates keep their signed-artifact chain (`updates.rs`); connect mode does not
  touch it.

## Team model

A shared instance is the whole point, and the server already models it: users and roles, per-project assignments
(`project_assignments`, with a null row meaning global access), invites, OAuth SSO, notification subscriptions and
CODEOWNERS-derived ownership. Pointing the desktop app at that instance gives every engineer the native experience over
shared data with nothing new server-side.

One honest limit: there are **no organizations or teams tables** — access granularity tops out at per-project
assignment on a single instance. For the self-hosted model (one instance per team or per company) that is the right
grain; multi-tenant org structures are a different product and out of scope, consistent with the no-SaaS non-goal.

## Compatibility and degradation

- **Local mode is untouched and remains the default.** A user who never connects sees today's app exactly.
- **The server/Docker build is untouched.** Connect mode is entirely a desktop-shell capability; no server route
  changes are required for Stage 1, and Stage 2's import reuses the existing multipart endpoint.
- **`desktop-guard` stays local-only.** The `PIWI_DESKTOP_TOKEN` guard (`server/middleware/desktop-guard.ts`) is inert
  on the server build and is **not** the remote-access path — a remote client authenticates as a normal user session or
  API key, never via the desktop token. This must not be confused with a remote credential.
- **Graceful when unreachable.** A saved connection that fails to load falls back to local mode rather than blocking
  startup.

## Alternatives considered

1. **Pure companion — a thin local agent plus the dashboard in a browser.** Keep using the hosted dashboard in a normal
   browser tab and run a small local agent it talks to for the superpowers. Lighter in principle, but it fights the
   browser's wall against a web page reaching `localhost` (mixed content, CORS, or a native-messaging host the user
   must install) and ends up re-implementing what the Tauri shell already is. The browser extension's connected mode
   already occupies the narrow niche where the pure-companion pattern genuinely fits (acting on the live page the user
   is looking at); generalizing it to "run my tests" would rebuild the shell badly.
2. **Remote-only client — drop the bundled server.** Simplest mental model, but it discards the zero-config,
   no-server, double-click-and-go onramp that is the desktop app's main reason to exist, and abandons users who want a
   private local instance. Rejected in favor of keeping both modes.
3. **Browser-extension-style connected mode only.** Add a URL+key connected mode to the desktop app but leave it a
   dashboard viewer, not wiring the local superpowers to the remote instance. This is essentially Stage 1 without Stage
   2 — a valid shipping point, but not the destination, since the superpowers are the whole differentiator.
4. **Do nothing.** The status quo forces a team member either into a browser (losing the native superpowers) or into a
   private empty local instance (losing the team's data). The two halves of the product — shared history and
   local-machine access — never meet.

## Open questions

- **Keychain plumbing.** Which cross-platform keychain integration, and the fallback when a platform keystore is
  unavailable or locked.
- **Device key: auto-mint or paste.** Auto-minting a device-scoped key after login is the better UX, but adds a
  post-login step against `POST /api/users/[id]/api-keys`; pasting is simpler but clumsier. Ship which first?
- **Private-CA / self-signed certs.** Intranet instances are the common self-hosted case and often use a private CA or
  a self-signed cert. How much cert-trust UX to expose (system trust store only, or an explicit "trust this
  certificate" affordance), and how to avoid it becoming a footgun.
- **One active connection or several at once.** A single active connection is simplest; power users may want several
  instances open. Multi-instance is deferred to Stage 3, but the `settings.json` shape should not preclude it.
- **Hosted → local hand-off.** The Stage 3 companion gesture (a dashboard link that opens the local app to a checkout
  or starts a local run) needs its own small design — deep-link scheme, origin verification, and what the web app is
  allowed to ask the local app to do.

## Rollout sketch

1. **Connections model + webview target.** The `settings.json` `connections`/`activeConnection` shape, the Connections
   surface, and the generalized webview target with the sidecar skipped in connect mode. Local mode unchanged.
2. **TLS + capability ACL.** `health_ok` and `split_http_url` gain HTTPS with cert validation; the capability ACL is
   widened to the configured origin(s), pinned and re-scoped on switch. Rust unit tests cover origin pinning.
3. **Auth flow.** Reuse the instance `/login` in the webview; add device-key minting after sign-in and keychain
   storage; surface the trust explanation when a connection is added.
4. **Local runs against remote.** Inject `PIWI_DASHBOARD_URL` + `PIWI_API_KEY` into the spawned Playwright process; the
   reporter already routes on them. E2E: a linked local run lands on the connected instance.
5. **Remote import + MCP bridge.** Read-and-upload import to the multipart endpoint; point the MCP bridge at the active
   connection. Native notifications reflect the signed-in user's subscriptions.
6. **Expansion.** Multiple saved instances, per-instance identity, and the hosted→local hand-off — re-sequenced by what
   Stages 1–5 teach.
