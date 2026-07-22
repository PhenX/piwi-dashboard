# Piwi Dashboard — Desktop app

A [Tauri](https://tauri.app) shell that bundles the **same** Nuxt/Nitro server
shipped as the Docker image and `@piwitests/server`, and runs it locally. No
Docker, no `npx`, no server to set up — double-click and go. Everything binds
`127.0.0.1`; your data lives under the OS app-data directory.

Targets for v1: **Windows (`.msi`)** and **macOS (`.dmg`)**. Linux is deferred.

## How it works

1. On launch the Rust shell picks a free loopback port, resolves a per-user data
   dir (`app_data_dir()/.data`), and spawns the bundled server as a **Node
   sidecar** (`src-tauri/binaries/node-<triple>` running
   `resources/app-server/.output/server/index.mjs`).
2. It polls `GET /api/health` (200 = database migrated) and then points the
   window at the server via a one-time token bootstrap (`/__piwi/session`).
3. The tray offers **Run in background** (keep serving after the window closes),
   **Start on login**, and **Open data folder**.

Local access is gated by a per-launch token (see
`application/server/middleware/desktop-guard.ts`), so only the app — not other
local processes or browser pages — can reach the bundled API.

## Build locally

Prerequisites: Node 24+, the [Rust toolchain](https://rustup.rs), and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
# 1. Build the server bundle (from the repo root)
npm run app:build --workspace=application

# 2. Fetch the Node sidecar for this machine + stage the server (from desktop/)
cd desktop
npm run fetch-node          # downloads the official Node binary for this OS
npm run stage               # copies .output + installs native modules
npx tauri icon ../application/public/logo.svg   # generate icons (once)

# 3. Run in dev, or build an installer
npm run dev                 # launches the app against the staged server
npm run build               # produces the .msi / .dmg under src-tauri/target
```

> The Node sidecar (`src-tauri/binaries/`), the staged server
> (`resources/app-server/`), generated icons, and `src-tauri/target/` are all
> git-ignored build artifacts — CI regenerates them (see
> `.github/workflows/desktop-release.yml`).

## Signing

Installers are **unsigned** unless code-signing secrets are configured, in which
case CI signs (and notarizes on macOS) automatically. Unsigned apps still run —
right-click → Open on macOS, or "More info → Run anyway" on Windows SmartScreen.
