# Piwi Picker — Agent Instructions

Browser extension (Chrome/Edge, Manifest V3) that reuses the monorepo's locator engine
(`@piwitests/core`) and shared picker overlay (`@piwitests/picker-dom`) to pick ranked,
stable Playwright locators from the live page. Standalone — talks to no server.

## What it is

- `manifest.json` — MV3 manifest. Permissions stay at `activeTab` + `scripting` + `storage`
  only — no host permissions, no `<all_urls>`, no remote code. Adding a permission here is
  a deliberate, reviewed decision, not a default. `browser_specific_settings.gecko.id` is
  Firefox's required stable add-on ID (Chromium ignores the key); don't change it once the
  add-on is published to AMO — a new ID creates a separate add-on rather than an update,
  orphaning existing installs. See `PUBLISHING.md`.
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

Each standalone content-script feature (locator console, multi-pick, lint overlay, assertion
suggester, pick session, agent context, …) is split into a pure logic file (e.g.
`lint-scan.ts`, `assertion-suggest.ts`, `session-export.ts`) and a separate entry-point/UI
file (e.g. `lint-overlay.ts`, `assertion-panel.ts`, `session-panel.ts`) that wires picking,
DOM, and `chrome.*` calls around it. Keep new features on this split rather than mixing pure
logic into the entry point — it's what makes the logic half plain-unit-testable (or
real-bundle-testable, see below) instead of needing a live browser for everything.

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
  accessibility tree, which contradicts the minimal-permissions goal) and the agent-context
  feature's element summary, which deliberately approximates instead of attempting the same
  real accessibility tree for the same reason.
- Reuse `@piwitests/picker-dom`'s exports (`installPickerOverlay`, `showAnchorPicker`,
  probe, role-resolution, syntax highlighting) rather than re-deriving picker logic here —
  that package exists so this workspace doesn't become a third hand-synced copy.
- **`chrome.storage.session` needs `setAccessLevel` to be reachable from a content script.**
  It defaults to extension-page/service-worker-only access; `src/background/index.ts` widens
  it once at startup (`TRUSTED_AND_UNTRUSTED_CONTEXTS`) specifically so `session-panel.ts` can
  read/write it directly. `chrome.storage.local` has no such restriction.
- **Two different test strategies for content-script logic, pick deliberately.** A function
  built entirely from nested helpers with no imports from `@piwitests/core`'s scoring engine
  (`evaluateLocatorChain`, `derivePattern`) can be re-serialized via
  `Function.prototype.toString()` in tests, installing any genuine cross-module dependency as
  a global first. A function that calls `generateAlternatives` (`scanForLintIssues`,
  `suggestAssertions`, `buildAgentContext`) can't — that function's own private module-level
  helpers don't survive reconstruction and aren't exported individually. Those are tested by
  driving the real built bundle (`page.addScriptTag`) and reading a well-known
  `globalThis.__piwiXxx` the entry-point file bridges the result out to (see
  `lint-overlay.ts`, `assertion-panel.ts`, `agent-context-panel.ts`) — don't reach for
  reconstruction if the feature touches `generateAlternatives`.

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
