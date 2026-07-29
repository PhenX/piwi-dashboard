# Publishing Piwi Picker to Chrome, Edge, and Firefox

Not yet published anywhere — see `docs/extension.md`'s own note ("install unpacked until it is"). This is what closes that gap.

Current state this guide assumes: manifest name `"Piwi Picker"`, version tracked by release-please repo-wide (`extension/manifest.json`'s version is already an `extra-files` target in `release-please-config.json` — no manual version bumps needed), MIT-licensed, icons present at 16/32/48/128px, standing permissions limited to `activeTab` + `scripting` + `storage`, plus `optional_host_permissions` (`http://*/*`, `https://*/*`) — declared but granted nothing until the user clicks "Record actions" and approves a single origin. See `docs/extension.md`'s permissions table for the exact wording, and the note in §2 step 3 below on justifying this one to reviewers.

## 0. One-time setup (per store, before your first submission)

| Store | Account | Cost | Notes |
|---|---|---|---|
| **Chrome Web Store** | [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) | $5 one-time | Needs a Google account; verify developer identity |
| **Edge Add-ons** | [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/) | Free | Microsoft account; separate registration from Chrome despite the shared Chromium base |
| **Firefox AMO** | [addons.mozilla.org developer hub](https://addons.mozilla.org/developers/) | Free | Firefox account |

**Trademark note (carried over from the original plan doc):** the store listing name can't lead with "Playwright" — the same reason this project is named Piwi, not something Playwright-branded. "Piwi Picker — locators for Playwright tests" plus a standard non-affiliation line is the pattern already used in this repo's docs; keep using it in each store's listing description.

## 1. Build a clean distributable

```bash
npm run extension:zip --workspace=extension
```

Builds, then zips `dist/`'s contents (manifest at the zip root, not nested — what stores expect) into `extension/piwi-picker-v<version>.zip`, dropping `.map` sourcemaps along the way (`extension/scripts/zip.mjs`, via `archiver` — pure JS, no dependency on a system `zip`/`7z` binary, so this works the same on Windows as it does in CI). The zip is gitignored; regenerate it whenever you need a fresh one rather than keeping an old one around. All three stores want this **same built zip**; the manifest is already store-agnostic MV3, so no store-specific rebuild is needed (Firefox's one extra requirement is a manifest key addition, not a different build — see §4).

## 2. Chrome Web Store

1. Dashboard → **New item** → upload the zip.
2. Store listing requires: description, at least one 1280×800 or 640×400 screenshot, a 128×128 icon (already have it), category (Developer Tools), and a **privacy practices** disclosure. Picking and recording are zero-telemetry/zero-network by default; the one exception is the optional Piwi-instance connection (`options.html`), which — only if the user configures it — sends the API key and a project id (one per configured URL-pattern → project mapping) to fetch that project's function catalog, and nothing else (no recorded data, no browsing history). State both halves plainly rather than only the standalone claim.
3. Permission justification: Chrome's review form asks you to justify each requested permission in plain English. For `activeTab`/`scripting`/`storage`, reuse the exact wording already in `docs/extension.md`'s permissions table — it's already accurate and honest. `optional_host_permissions` needs its own explanation since the two patterns (`http://*/*`, `https://*/*`) look broad on their own: say plainly that this is declared so the extension *can* request a single origin, on demand, only when the user clicks "Record actions" inside that click's own gesture — nothing is granted at install, and the grant is scoped to whichever one site the user is recording, never `<all_urls>` in practice. Reviewers specifically look for this "declared broad, granted narrow, user-gestured" pattern with optional host permissions — state it explicitly rather than assuming the manifest speaks for itself.
4. Submit for review. First review is typically the slowest (hours to a few days); version updates thereafter are usually faster.
5. Once approved, note the **extension ID** Chrome assigns — useful for support links and the docs page.

## 3. Edge Add-ons

Structurally the easiest: Edge is Chromium and accepts the **same zip** unmodified.

1. Partner Center → **Create new extension** → upload the same zip from §1.
2. Edge's review is generally faster than Chrome's and has a lighter privacy-disclosure form — fill it out the same honest way.
3. Edge can auto-import a listing from an existing Chrome Web Store entry if you link accounts — worth doing if Chrome approves first, to avoid re-typing the listing.

## 4. Firefox AMO — the one with real differences

**a) The Firefox-specific manifest key is already in place.** Firefox requires an explicit, stable extension ID (Chrome/Edge derive one from the store upload automatically; Firefox doesn't). `extension/manifest.json` carries it:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "piwi-picker@piwitests.dev",
    "strict_min_version": "116.0"
  }
}
```

Chromium ignores this key entirely, so the single built zip stays valid for all three stores. Two caveats worth knowing:
- **The ID is permanent once published.** AMO binds the listing to it; changing it later creates a *new* add-on rather than updating the existing one, orphaning existing installs. Change it before the first submission or not at all.
- **`116.0` is a floor set by a feature, not a fully verified minimum.** `optional_host_permissions` (used by the recorder — see the top of this doc) needs Firefox 116+; without recording, `109.0` would likely still work. Test against a real Firefox install of the target version and adjust before submitting, rather than trusting the number as-is — this repo's CI doesn't exercise Firefox at all (see the note near the bottom of this section).

**b) Submit source, not just the built zip.** Because `extension/dist` is Vite-bundled/minified output, not hand-written source, Mozilla's reviewers require the **original source** plus build instructions whenever the reviewable code doesn't match human-readable source 1:1. Concretely:
- Upload the same built zip as the actual extension.
- AMO's submission flow asks "does your extension contain minified/bundled/compiled code?" → yes → it prompts for a source zip. Provide a zip of the `extension/` directory (or the whole repo at that tag) plus a short build note: `npm install && npm run extension:build --workspace=extension`, output in `extension/dist`.

Submission steps:
1. AMO developer hub → **Submit a New Add-on** → "On this site" (listed, public) vs "self-distribution" (unlisted) — pick listed unless there's a specific reason not to.
2. Upload the zip, answer the minified-code question, attach source + build notes as above.
3. Fill the listing (same screenshots/description as Chrome/Edge).
4. Firefox review is manual and can take longer than Chrome/Edge for a first submission, especially with source review involved.

**Verify, don't assume, before submitting:** Firefox's `chrome.*` namespace aliasing in MV3 is close to Chrome's but not identical everywhere. Nothing in this repo's CI currently exercises Firefox at all — the E2E harness (`extension/tests/e2e/`) is Chromium-only via `--load-extension`. Run the extension manually in a real Firefox install (or extend the harness) before trusting the store listing's "works in Firefox" claim.

## 5. Ongoing updates

Every store re-review happens on **every version bump**, not just the first. Since release-please already bumps `extension/manifest.json`'s version repo-wide, the practical loop becomes: tag lands → rebuild zip → re-upload to all three dashboards. That's manual today. It's genuinely automatable later — Chrome Web Store, Edge, and AMO all have publish APIs — following the same shape as `.github/workflows/desktop-release.yml`'s already-established pattern (tag-triggered on `v*`, attaches build output to the release release-please created). Not built yet since it wasn't needed until there's a first manual submission to model it after; a natural next step once this has been done by hand a few times.
