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

Point the [reporter](/reporter) at the local server while the app is running:

```typescript
['@piwitests/reporter', { serverUrl: 'http://localhost:3000', projectName: 'my-project' }]
```

The desktop app uses port **3000** by default (falling back to another local
port only if 3000 is already taken — the window's address bar shows the actual
one). Accepting results from *other* machines over the network is intentionally
not supported in the desktop build — run the [Docker image](/deployment) for a
shared, always-on server.

## Building from source

See [`desktop/README.md`](https://github.com/PiwiTests/platform/blob/main/desktop/README.md)
for the local build steps (Node 24+, the Rust toolchain, and the Tauri system
dependencies).
