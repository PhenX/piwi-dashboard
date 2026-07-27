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
   `src-tauri/resources/app-server/.output/server/index.mjs`).
2. It polls `GET /api/health` (200 = database migrated) and then points the
   window at the server via a one-time token bootstrap (`/__piwi/session`).
3. The tray offers **Run in background** (keep serving after the window closes),
   **Start on login**, and **Open data folder**.
4. The dashboard can link a Piwi project to a folder on this machine and run
   `playwright test` there (`src-tauri/src/runner.rs`): the shell resolves the
   folder's own Playwright package, executes it with the bundled Node sidecar,
   and streams output back to the webview as `piwi:local-run` events.
5. Archives the OS hands to the app (drag & drop, "Open with", second-launch
   file arguments, macOS open events) are queued shell-side and drained by the
   dashboard over IPC (`desktop_take_pending_open_files` + a `piwi:open-files`
   poke), which imports them by path through the desktop-only
   `/api/desktop/import-local` route.
6. The dashboard's /mcp page can write the `piwi` MCP entry into detected
   clients' config files (`src-tauri/src/mcp_clients.rs`): strict-JSON merge
   of one key with a backup next to the file, and a startup pass that rewrites
   entries whose URL/token drifted after a port change.

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
> (`src-tauri/resources/app-server/`), generated icons, and `src-tauri/target/` are all
> git-ignored build artifacts — CI regenerates them (see
> `.github/workflows/desktop-release.yml`).

## End-to-end tests

`desktop/e2e/` drives the **real** shell webview with Playwright, via
[`tauri-plugin-playwright`](https://crates.io/crates/tauri-plugin-playwright).
This is the only layer that catches runtime issues the compiler can't — most
importantly that the dashboard (served at a loopback origin) may actually call
the shell's native commands, which Tauri gates per-origin via the capabilities.

The plugin is compiled in **only** under the `e2e-testing` cargo feature (never
in shipped installers), and the capability it needs is added at runtime, also
behind that feature. Run it after building + staging the server:

```bash
# from the repo root: build the server the shell will bundle
npm run app:build --workspace=application

# from desktop/: stage the sidecar + server, then run the tests
cd desktop
npm install
npm run fetch-node
npm run stage
npx tauri icon ../application/public/logo.svg   # once
npm run e2e                                      # launches `tauri dev --features e2e-testing`
```

CI runs this on macOS (real webview, no display server needed) on desktop
changes — see `.github/workflows/desktop-e2e.yml`.

## Signing

Installers are **unsigned** unless code-signing secrets are configured, in which
case CI signs automatically. Unsigned apps still run — right-click → Open on
macOS, or "More info → Run anyway" on Windows SmartScreen.

macOS signing and notarization are not wired up (see the comment in
`desktop-release.yml`). Windows is, in two flavours — pick the one your
certificate allows:

### Cloud or token-held key (the usual case)

Certificates issued since June 2023 keep their private key in hardware, so
there is no file to install and Tauri shells out to the vendor's CLI instead.
[Azure Trusted Signing][azure] is the cheapest route and needs no certificate
purchase. Set these as repository **variables** (they are not secret):

```
WINDOWS_SIGN_SETUP     cargo install artifact-signing-cli
WINDOWS_SIGN_COMMAND   artifact-signing-cli -e https://weu.codesigning.azure.net \
                         -a <account> -c <profile> -d "Piwi Dashboard" %1
```

…and the credentials the CLI reads as repository **secrets** — for Azure that
is `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_TENANT_ID`. `%1` is
substituted with each file being signed. Other vendors (DigiCert KeyLocker,
SSL.com eSigner) work the same way with their own CLI and variables; add those
to the job `env` in `desktop-release.yml`.

### Exportable `.pfx` (OV certificates issued before June 2023)

Two repository **secrets**: `WINDOWS_CERTIFICATE`, holding the output of
`certutil -encode certificate.pfx base64cert.txt`, and
`WINDOWS_CERTIFICATE_PASSWORD`, the PFX export password.

CI imports the certificate into the runner's store and reads the thumbprint
off the import, so there is no third secret to keep in sync. Override the
timestamp server with the `WINDOWS_TIMESTAMP_URL` variable if your issuer runs
its own; it defaults to DigiCert's.

### Either way

The workflow writes `src-tauri/tauri.windows.conf.json` from those values, which
Tauri merges into `tauri.conf.json` on Windows only — the thumbprint stays out
of the repository and `npm run build` on a developer machine keeps producing an
unsigned installer with no extra setup. The Node sidecar is signed in a separate
step, because Tauri signs the app binary and the `.msi` but never `externalBin`
entries, and an unsigned UPX-packed `node.exe` inside a signed installer is a
reliable way to attract antivirus false positives.

Verify a build with `signtool verify /pa /v <installer>.msi`, or look for
`info: signing app` in the workflow log.

[azure]: https://learn.microsoft.com/en-us/azure/trusted-signing/quickstart
