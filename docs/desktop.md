---
title: Desktop app
lang: en-US
---

# Desktop app

The Piwi Dashboard desktop app runs the **entire dashboard on your machine** — no
Docker, no `npx`, no server to set up. It bundles the same server that ships as
the Docker image, wraps it in a native window, and keeps your data in a local
folder. It's ideal for a single developer who runs Playwright locally and wants
permanent history, flaky scoring, failure clustering, and locator healing without
standing up a server.

> Everything binds to `127.0.0.1` — the app is local-only and nothing is exposed
> to the network.

## Download

Grab the installer for your OS from the [latest release](https://github.com/PiwiTests/platform/releases/latest):

| OS | Installer |
|----|-----------|
| **Windows** | `.msi` |
| **macOS** (Apple silicon) | `.dmg` |

Linux is not packaged yet — use [Docker or `npx`](/deployment) there.

### Unsigned builds

Until code-signing certificates are in place the installers are **unsigned**, so
your OS shows a first-run warning:

- **macOS:** right-click the app → **Open** → **Open** (once).
- **Windows:** SmartScreen → **More info** → **Run anyway**.

## Where your data lives

Open **Settings → Storage → Data location** to see the exact paths, or use the
tray menu's **Open data folder**. By default everything sits under the OS
app-data directory:

| OS | Location |
|----|----------|
| **Windows** | `%APPDATA%\io.piwitests.dashboard\.data` |
| **macOS** | `~/Library/Application Support/io.piwitests.dashboard/.data` |

That folder holds `piwi.db` (SQLite) and `storage/` (reports, traces,
attachments). Back it up by copying the folder while the app is closed.

## Running in the background

By default, closing the window quits the app. From the tray icon you can enable:

- **Run in background** — closing the window keeps the server running in the
  tray, so submitting more results is instant and reopening is immediate.
- **Start on login** — launch the app (hidden, into the tray) when you log in.

## Sending results to it

While the app is running, the reporter finds it by itself — no URL and no token
in your config:

```typescript
['@piwitests/reporter', { projectName: 'my-project' }]
```

The app publishes its address and access token to `~/.piwi/desktop.json`
(`%USERPROFILE%\.piwi\desktop.json` on Windows) while it runs, rewriting the file
on each launch and deleting it on quit. The reporter reads it **only** when your
config and environment set no `serverUrl` and no `apiKey`, so a project already
pointed at a shared dashboard — or a CI job with `PIWI_API_KEY` set — is never
redirected here. See [Finding the desktop app automatically](/reporter#finding-the-desktop-app-automatically).

### Configuring it by hand

Discovery needs the tests and the app to run as the same user on the same
machine. When they don't — a container, a different account, or a config that
already sets `serverUrl` — open **Settings → Storage → Send results to this app**
to copy the token and a ready-made snippet:

```typescript
['@piwitests/reporter', {
  serverUrl: 'http://localhost:3000',
  projectName: 'my-project',
  apiKey: 'pd_…', // from Settings → Storage (or the PIWI_API_KEY env var)
}]
```

The token is a **local secret** — prefer the `PIWI_API_KEY` env var over
committing it. The app uses port **3000** by default (falling back to another
local port only if 3000 is already taken — the window's address bar shows the
actual one).

> **Why a token?** The server binds `127.0.0.1`, which blocks other machines —
> but loopback alone doesn't stop *other local processes* or *web pages open in
> your browser* from reaching it. The token means only the app itself and tools
> you've handed it to (your reporter) can submit or read. Accepting results from
> *other machines* over the network is intentionally not supported in the desktop
> build — run the [Docker image](/deployment) for a shared, always-on server.

## Running tests from the app

A failing run is one click from a local retry. On a run page (or a single
execution page), **Run locally** re-runs the failed tests on this machine:

1. **Link the Piwi project to its checkout** — the folder that contains the
   tests. The app asks on first use, or link it any time on the project page
   under **Local folder**. The link stays on this machine; it is never sent
   anywhere.
2. **Pick what to re-run and how** — by `file:line`, title or file; headless,
   headed, the Playwright inspector or UI mode; optional trace recording; and
   `--repeat-each` up to 1000× for flake reproduction.
3. **Run.** The app executes the folder's *own* Playwright with the app's
   bundled Node — nothing extra to install — and streams the output into the
   dialog. The exact command is shown before anything runs, and **Stop** (or
   closing the dialog) kills the process.

Results flow back automatically: the run executes your project's regular
Playwright config, so the Piwi reporter in it reports to this app through the
[discovery file](#sending-results-to-it), exactly like a run started from your
terminal.

Two prerequisites, both usually already true for a project that reports to
Piwi: the linked folder has `@playwright/test` installed (`node_modules`
present — monorepos with a hoisted root install work too), and its Playwright
config includes the Piwi reporter.

The linked folder also completes [Open in IDE](/ide-integration): when no
workspace root is configured there, source links resolve against the linked
folder automatically.

## Importing local files

Drop a Playwright **blob report** or **trace** (`.zip`) anywhere on the app
window and an import dialog opens: pick the project, and each archive is
imported straight from its path on disk — nothing is uploaded anywhere.
Several traces dropped together can be gathered into a single run.

The same dialog opens when the OS hands files to the app: **Open with →
Piwi Dashboard** in your file manager, dropping archives on the dock icon
(macOS), or launching the app with file arguments. The app registers as an
*optional* opener for `.zip` files — it never takes over your system's default
archive handler.

Semantics match the [import page](/importing-runs): idempotent by content
hash, and imports never trigger notifications, AI diagnosis or regression
signals.

## Connecting AI assistants

The app exposes the same [MCP server](/mcp) as every Piwi deployment — and on
this machine it can also do the wiring. The **MCP server** page detects
installed clients — Claude Code, Claude Desktop, Cursor, VS Code, Windsurf and
Gemini CLI — and connects each with one click:

- The `piwi` entry is written into the client's **own config file**, with the
  app's URL and access token filled in; a backup copy is kept next to the file,
  and only that one entry is ever added, updated or removed.
- A config that is not plain JSON (comments, trailing commas) is never
  rewritten — the page says so and shows the copy-paste snippet instead.
- Written entries embed this app's address, which can change when port 3000 is
  taken — on every launch the app checks the clients it configured and
  rewrites any entry that drifted.

Restart the client after connecting; most MCP clients read their config at
startup.

## Updates

**Settings → About → Updates** checks GitHub releases for a newer version,
downloads it in the background, and applies it when you restart the app.

Update support exists only in releases built with the project's update
signing key — the app verifies every download against the matching public key
before installing anything. A build without that key (a dev build, or a
release made before the key existed) says so on the card; update it by
downloading the [latest release](https://github.com/PiwiTests/platform/releases/latest)
installer, which keeps your data (the data folder lives outside the app).

## Building from source

See [`desktop/README.md`](https://github.com/PiwiTests/platform/blob/main/desktop/README.md)
for the local build steps (Node 24+, the Rust toolchain, and the Tauri system
dependencies).
