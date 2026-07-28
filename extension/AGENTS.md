# Piwi Picker — Agent Instructions

Browser extension (Chrome/Edge, Manifest V3) that reuses the monorepo's locator engine
(`@piwitests/core`) and shared picker overlay (`@piwitests/picker-dom`) to pick ranked,
stable Playwright locators from the live page. Standalone — talks to no server.

## What it is

- `manifest.json` — MV3 manifest. Permissions stay at `activeTab` + `scripting` + `storage`
  only — no host permissions, no `<all_urls>`, no remote code. Adding a permission here is
  a deliberate, reviewed decision, not a default.
- `src/content/` — content scripts, each a standalone entry injected on demand via
  `chrome.scripting.executeScript({ files: [...] })` (never `<all_urls>` static injection,
  never the `func:` stringify-and-inject form — a normal file injection can import
  `@piwitests/core`/`@piwitests/picker-dom` directly, since nothing needs to survive
  `Function.prototype.toString()` here, unlike the reporter/dashboard pickers).
- `src/background/` — the service worker. Only handles the `chrome.commands` keyboard
  shortcut; the toolbar icon opens the popup directly (`action.default_popup`), which
  injects content scripts itself without going through the background.
- `src/popup/` — the toolbar popup. Plain TypeScript + DOM, no UI framework — keep it that
  way unless the popup's own complexity genuinely outgrows it.
- `src/shared/` — code shared between content scripts, background, and popup.

## Rules

- **Zero network calls, zero telemetry.** This workspace talks to no server in this phase.
  If a future phase adds a connected mode, it must be opt-in and clearly separated from the
  standalone path.
- **Content scripts are separately-bundled IIFEs, not ES modules.** `scripts/build.mjs`
  builds each one with Vite's library mode specifically so `chrome.scripting.executeScript`
  can inject it as a plain script. Don't add a shared runtime chunk between them — each
  must stay self-contained at the bundle level (imports are fine at the *source* level;
  Vite inlines them per entry).
- **Never widen permissions casually.** `activeTab`/`scripting`/`storage` cover everything
  in this phase. A feature that seems to need more (host permissions, `debugger`,
  `contextMenus`, `sidePanel`) needs a deliberate call, not a silent addition — see the
  aria-snapshot feature (deferred; would need `debugger` to get the browser's real
  accessibility tree, which contradicts the minimal-permissions goal).
- Reuse `@piwitests/picker-dom`'s exports (`installPickerOverlay`, `showAnchorPicker`,
  probe, role-resolution, syntax highlighting) rather than re-deriving picker logic here —
  that package exists so this workspace doesn't become a third hand-synced copy.

## Commands

| Command | Purpose |
|---|---|
| `npm run extension:build` | Build `dist/` (content scripts, background, popup, manifest, icons) |
| `npm run extension:typecheck` | TypeScript check |
| `npm run extension:lint` / `extension:lint:fix` | oxlint |
| `npm run extension:format` / `extension:format:check` | oxfmt |
| `npm run extension:test` | Unit tests (Vitest) — pure logic only |
| `npm run extension:test:e2e` | Builds, then drives the real built extension with Playwright (`--load-extension`) |

## Loading it locally

`npm run extension:build`, then in Chrome/Edge: `chrome://extensions` → enable Developer
mode → Load unpacked → select `extension/dist`.
