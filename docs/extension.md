---
title: Browser extension
lang: en-US
---

# Browser extension

Piwi Picker is a Chrome/Edge extension (Manifest V3) that picks ranked, stable Playwright
locators directly from the page you're looking at — scored by the same engine the dashboard
uses. It's standalone: this phase talks to no server, sends nothing anywhere, and requests
`activeTab`, `scripting`, and `storage` only.

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

## Permissions, explained

| Permission | Why |
|---|---|
| `activeTab` | Lets the extension act on the tab you're looking at only when you click the toolbar icon or press the keyboard shortcut — not on every page you visit. |
| `scripting` | Injects the picker into the active tab on demand (see above) — there is no background content script running on pages you haven't asked it to. |
| `storage` | Remembers your last-used copy format locally, on your machine. |

Nothing here reaches a network. There is no host permission, no `<all_urls>`, and no remote
code — the entire extension is the code in this repository, bundled as-is.

## Current limits

- **One frame at a time.** Picking inside an iframe, or across shadow DOM boundaries, isn't
  supported yet — the picker sees the top-level document.
- **No aria-snapshot copier yet.** Reproducing Playwright's `toMatchAriaSnapshot()` YAML format
  exactly needs the browser's real computed accessibility tree, which isn't reachable from a
  content script without a much heavier permission (`debugger`) than this extension asks for. An
  approximated version risks copying YAML that looks right but doesn't actually match — worse
  than not offering it.
- **Live re-check covers the common shapes.** `getByTestId`, CSS locators, and a bare
  `getByRole` are re-verified against the page as it is now; text/label/placeholder-based
  matches and anchor-scoped chains keep the count captured at pick time (Playwright's own
  text-matching rules aren't reproduced here).
- **No dashboard connection in this phase.** Nothing is sent to your Piwi instance yet — that's
  planned as an opt-in later phase, kept clearly separate from this standalone path.

## Source

`extension/` in the [monorepo](https://github.com/PiwiTests/platform) — see
[`extension/AGENTS.md`](https://github.com/PiwiTests/platform/blob/main/extension/AGENTS.md)
for how it's built and tested.
