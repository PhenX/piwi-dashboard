---
title: Browser extension
lang: en-US
---

# Browser extension

Piwi Picker is a Chrome/Edge extension (Manifest V3) that picks ranked, stable Playwright
locators directly from the page you're looking at — scored by the same engine the dashboard
uses, and can record a multi-page flow into a runnable TypeScript spec. Picking and recording
are fully standalone — nothing is sent anywhere by default. Connecting to a Piwi instance is
optional and adds exactly one thing: matching a recording against your project's own
page-object methods and helpers, ranked live as you record.

> Not yet published to the Chrome Web Store or Edge Add-ons. Install it unpacked from a local
> build until it is.

## Install

```bash
git clone https://github.com/PiwiTests/platform.git
cd platform
npm install
npm run extension:build --workspace=extension
```

Then, in Chrome or Edge:

1. Open `chrome://extensions` (`edge://extensions` on Edge).
2. Turn on **Developer mode**.
3. **Load unpacked** → select `extension/dist`.

## What it does

- **Pick an element** — click the toolbar icon → **Pick an element**, or press
  `Ctrl+Shift+E` (`Cmd+Shift+E` on macOS) on any page. Hover highlights, a click picks — the
  pick snaps to the nearest actionable ancestor (a click on the text inside a button picks the
  button), and ↑/↓ walk the DOM tree before it commits. When the element has a role, an
  **anchors** step follows: bless one or more stable parent elements to scope the locator to,
  with a live "matches N" count.
- **Ranked locators, re-checked live** — every candidate is scored the way the dashboard scores
  captured locators, then re-counted against the page as it is right now (a page can re-render
  between the pick and reviewing the results). A candidate that's become ambiguous is shown with
  its current match count and a suggestion to add `.first()` or `.filter({ hasText: … })` —
  never silently dropped.
- **Copy in three forms** — the bare locator, a full action line
  (`await page.getByRole(…).click();`), or a visibility assertion
  (`await expect(page.getByRole(…)).toBeVisible();`). Your last-used form is remembered for next
  time.
- **Hover-inspect** — toggle from the popup: hover any element to see its best-ranked locator in
  a tooltip, no click needed.
- **Locator console** — type or paste a locator expression (a safe subset — `getBy*` chains,
  `locator(css)`, `filter({ hasText })`, `.first()`/`.last()`/`.nth()` — parsed, never
  `eval`'d) and see every match highlighted on the page live, with a strict-mode verdict and
  count.
- **Multi-pick pattern derivation** — pick 2–3 similar items (table rows, cards) and derive the
  shared list pattern (e.g. `getByRole('row').filter({ hasText: … })`), with a warning when only
  index-based (`.nth()`) discrimination was possible.
- **Lint overlay** — one click outlines every interactive element on the page that would score
  badly as a locator target right now (no test id, no accessible name, no stable structural
  anchor), with a suggested `data-testid` per element and a one-click Markdown checklist export.
- **Assertion suggester** — pick an element and get ranked `expect(...)` candidates built against
  its top-ranked locator — whichever of `toHaveValue`, `toHaveText`, `toHaveAccessibleName`, and
  `toBeVisible` actually apply to it — with a one-click copy per candidate.
- **Session** — pick and name elements as you browse, even across different pages, then export
  the whole named list as a Playwright POM-style fixture class, a Markdown table (paste into a
  PR description or issue), or JSON. The session lives for as long as the browser stays open —
  see [Permissions](#permissions-explained).
- **Copy context for agent** — pick an element and copy one paste-able block for an AI coding
  agent: the page URL, a compact element summary (tag, role, accessible name, key attributes,
  text), and every ranked locator alternative.
- **Record actions across pages** — click **Record actions** and Piwi Picker grants itself
  access to the one site you're on, then captures clicks, fills, checks/unchecks, select
  changes, and Enter-to-submit as you browse — across as many pages on that site as you like.
  A small HUD tracks the step count and shows the top-ranked locator for whatever you just
  interacted with. Click **Stop** to open the review panel: reorder or drop steps, then **Copy
  as TypeScript** for a runnable Playwright spec (`page.goto`, then one line per step). Password
  fields are never captured — their value is replaced with a `process.env.*` placeholder in the
  generated code.
- **Matching functions, ranked live** *(needs a Piwi connection)* — connect to a Piwi instance
  from the toolbar popup's config (gear) button, map one or more URL patterns to a project
  (wildcards allowed, e.g. `https://shop.example.com/**`), and the recorder fetches each mapped
  project's function catalog — page-object methods and helpers it already knows about. Which
  project applies on a given page is resolved automatically from that mapping (first match wins),
  or you can override it for the current tab from the popup's **Active project** select. While
  recording, the HUD ranks which catalog function the steps so far look like, live, with a
  progress indicator (`2/3`) until a full match is found. On export, any complete match collapses
  into a call to your own function instead of raw locator lines; anything unmatched still comes
  out as plain locators. The matcher only ever *selects among* the catalog you've registered — it
  never invents a function. Manage the catalog from a project's **Test functions** page in the
  dashboard.
- **Test functions against this page** *(needs a Piwi connection)* — click **Test functions** in
  the popup for a checklist of every function in the active project's catalog, scored against the
  page you're on right now: which pattern steps resolve to exactly one element (**ready to use
  here**), which are ambiguous or missing (**partial match**), and which don't apply here at all
  (**not found on this page**) — no recording or replay needed, just a live read of the current
  DOM against each function's stored pattern.

## Permissions, explained

| Permission | Why |
|---|---|
| `activeTab` | Lets the extension act on the tab you're looking at only when you click the toolbar icon or press the keyboard shortcut — not on every page you visit. |
| `scripting` | Injects the picker (and the recorder) into the active tab on demand — there is no background content script running on pages you haven't asked it to. |
| `storage` | Remembers your last-used copy format, a named pick session, the running recording, and (only if you connect) the instance URL/API key, the URL-pattern → project mappings, and each mapped project's cached function catalog — all locally on your machine. Pick sessions, the recording, and a manual **Active project** override specifically use `chrome.storage.session`, which the browser clears when you close it — a working session, not a saved file. |
| `optional_host_permissions` (`http://*/*`, `https://*/*`, granted nothing by default) | Recording across pages needs to keep working after you navigate, which `activeTab` alone can't do (it's revoked on navigation). Clicking **Record actions** requests access to *the one site you're on* — never `<all_urls>`, never granted in advance — so the recorder can re-attach itself as you move between that site's pages. Nothing else in the extension asks for this. |

No picking, hover-inspect, locator console, multi-pick, lint overlay, assertion suggester,
session export, agent-context copy, or standalone recording ever reaches a network. Connecting
to a Piwi instance is the one opt-in exception — see below.

## Connecting to a Piwi instance

Entirely optional, and off by default. From the toolbar popup, the config (gear) button opens a
settings page for your instance's URL and an API key (`pd_…`, from your account's API key
settings). Below that is a **Project mappings** table: rows of a URL pattern (wildcards allowed —
`*` matches within one path segment, `**` crosses segments, e.g. `https://shop.example.com/**`)
and the project it maps to. Saving fetches every mapped project's function catalog once and
caches it on your machine — nothing about your browsing is sent in that request beyond each
project's id.

Which mapping applies on a given page is resolved automatically (patterns are checked in order,
first match wins). The popup's **Active project** select shows the auto-resolved project for the
current tab and lets you override it for that tab only — useful when two mappings could apply, or
none do. The override is session-only (`chrome.storage.session`) and resets to automatic
resolution when you pick **Auto** again or close the browser.

**A recording itself is never sent to your instance.** Connecting only changes what the
**Copy as TypeScript** export looks like (it can now use your own functions) and what the HUD
shows while recording (ranked matches). Sending a recording to a server for anything beyond
that — saving it, running codegen server-side — isn't implemented; if it is later, it will be
opt-in per recording with a payload preview before the first send, matching the standard this
extension already holds itself to for the API key.

The function catalog itself is managed from a project's **Test functions** page in the
dashboard — add entries by hand, or paste a page-object method/helper's source code and let AI
propose the name, parameters, and DOM pattern (a review form you edit before saving; requires
[AI](./ai-diagnosis) to be configured on that instance — the section only appears when it is).
Once a function is registered, use **Test functions** in the extension popup to check whether
its pattern actually matches whatever page you're looking at.

## Current limits

- **One frame at a time.** Picking inside an iframe, or across shadow DOM boundaries, isn't
  supported yet — the picker sees the top-level document. The same limit applies to recording.
- **Recording covers one origin.** The host permission recording requests is scoped to the
  site you started on; navigating to a different origin mid-recording stops capturing new steps
  there (nothing is lost — stop and review what was captured, or start a fresh recording on the
  new site). Expanding a running recording to a second origin isn't implemented yet.
- **No aria-snapshot copier yet.** Reproducing Playwright's `toMatchAriaSnapshot()` YAML format
  exactly needs the browser's real computed accessibility tree, which isn't reachable from a
  content script without a much heavier permission (`debugger`) than this extension asks for. An
  approximated version risks copying YAML that looks right but doesn't actually match — worse
  than not offering it. The copy-context-for-agent element summary is deliberately a simpler,
  non-recursive approximation instead (tag/role/name/attributes/text) rather than the same
  aria-snapshot format — fine for giving an AI agent context, not meant for a `toMatchAriaSnapshot()`
  assertion.
- **Live re-check covers the common shapes.** `getByTestId`, CSS locators, and a bare
  `getByRole` are re-verified against the page as it is now; text/label/placeholder-based
  matches and anchor-scoped chains keep the count captured at pick time (Playwright's own
  text-matching rules aren't reproduced here).
- **Function matching is deterministic, not AI-assisted, in this phase.** The catalog matcher
  scores DOM patterns against recorded steps; there's no optional AI pass yet to name things or
  break ties beyond the scoring itself.

## Source

`extension/` in the [monorepo](https://github.com/PiwiTests/platform) — see
[`extension/AGENTS.md`](https://github.com/PiwiTests/platform/blob/main/extension/AGENTS.md)
for how it's built and tested.
