# Desktop app — agent guide

Rules for working inside `desktop/` (the Tauri shell that bundles and runs the dashboard locally). Read
[`../AGENTS.md`](../AGENTS.md) first for repo-wide conventions, and [`README.md`](README.md) for how the shell works,
build prerequisites and the release flow.

## What it is

A [Tauri](https://tauri.app) window around **the same Nuxt/Nitro server** shipped as the Docker image and
`@piwitests/server`. On launch the Rust shell picks a free loopback port, resolves a per-user data dir, spawns the
bundled server as a **Node sidecar**, polls `GET /api/health` until the database is migrated, then points the window at
it through a one-time token bootstrap (`/__piwi/session`). Targets for v1 are Windows (`.msi`) and macOS (`.dmg`);
Linux is deferred.

## Rules

- **Never fork the server.** The desktop app must keep running the unmodified built server. Anything the shell needs
  from the backend goes in `application/` behind a desktop-aware guard, not into a desktop-only copy.
- **Everything binds `127.0.0.1`.** Local access is gated by a per-launch token enforced by
  `application/server/middleware/desktop-guard.ts` — so only the app, not other local processes or browser pages, can
  reach the bundled API. Any new desktop-only route must stay behind that guard.
- **The reporter discovery file is a cross-package contract.** The shell publishes `{ url, token }` to
  `~/.piwi/desktop.json` while it runs and deletes it on quit; `@piwitests/reporter` reads it from
  `src/internal/config/desktop.ts`. The two ship separately, so changing the path or the shape means changing both.
- Front-end code that behaves differently inside the shell uses the `useIsDesktop` / `useTauri` composables and the
  `app/components/desktop/` cards — do not sniff user agents.
- The sidecar layout (`src-tauri/binaries/node-<triple>`, `src-tauri/resources/app-server/.output/`) is what the
  packaging scripts and CI (`desktop-release.yml`, `desktop-e2e.yml`) expect; changing it means updating both.
- Commit scope for changes here is `app` unless the change is CI-only (`ci`) — `desktop` is not in the commitlint
  scope list.

## Commands

```bash
npm run fetch-node   # download the Node sidecar binary for this platform
npm run stage        # build the server and stage it into src-tauri/resources
npm run dev          # tauri dev — run the shell against a staged server
npm run build        # produce the platform installer
npm run e2e          # Playwright smoke test of the shell integration
```
