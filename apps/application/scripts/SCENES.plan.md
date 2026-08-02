# Plan — scene handling for `take-feature-screenshots.mjs`

Status: proposed, not started. Written 2026-08-02 as a handover for a later session.
Owner file: [`scripts/take-feature-screenshots.mjs`](./take-feature-screenshots.mjs).

## Why

The docs illustrations in `apps/docs/public/screenshots/` drifted badly before anyone noticed:
a cluster page shown with tabs a redesign had replaced, a test case reading _"last run: over 56
years ago"_, a flaky table with an empty root-cause column, tables clipped mid-row so the very
columns their captions promised were cut off, and one image carrying a cookie banner from the
demo site.

None of that was caught, for three structural reasons this plan addresses:

1. **The images had no producer.** They predated the harness, so there was no command to re-run
   and nothing tying an image on disk to the code that made it.
2. **Targeting was fragile.** Reaching a panel meant `xpath=ancestor::div[4]` and
   `waitForTimeout(1200)`. Both break on the next refactor, silently, into a wrong-looking image
   rather than an error.
3. **Nothing detects drift.** A screenshot can misrepresent the UI for months and the build stays
   green.

Scenes now exist for the docs images (added 2026-08-02), which fixes (1). This plan covers making
them pleasant to use, robust to target, capable of annotation, and self-policing.

## Goals

- Recapture any docs image by **scene name alone** — no `--out`, no remembering paths.
- Target **DOM nodes and regions** semantically, not by DOM shape.
- Support **annotations**: boxes, arrows, numbered steps, callouts, spotlights, redactions.
- Make captures **deterministic** enough that a diff means a real UI change.

## Non-goals

- Replacing the marketing/hero pipeline in [`apps/docs/AGENTS.md`](../../docs/AGENTS.md)
  (live-demo capture, light/dark diagonal split). That stays as is; this is the feature-illustration
  path.
- Annotating `ai-diagnosis.png`, which needs a configured AI provider and remains a live-demo image.

---

## 1. Library survey

Checked against npm on 2026-08-02. **The headline finding is that most of what we would reach for
is already in Playwright 1.61.1**, which is pinned and installed.

### Already available — verified in `node_modules/playwright-core/types/types.d.ts`

| Capability                          | API                                           | Replaces                                            |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| Element-tight capture               | `locator.screenshot()`                        | hand-computed `clip` + `clipFor()` padding math     |
| Freeze animations/transitions       | `page.screenshot({ animations: 'disabled' })` | every `waitForTimeout(1200)` "let the chart settle" |
| Hide text caret                     | `{ caret: 'hide' }`                           | —                                                   |
| Redact regions                      | `{ mask: [locator], maskColor }`              | a hand-rolled redaction overlay                     |
| **Inject CSS for the capture only** | `{ style: '…' }`                              | injecting and then removing a stylesheet            |
| Retina output                       | `{ scale: 'css' \| 'device' }`                | —                                                   |

`style` is the important one: it applies a stylesheet **only** for the duration of the screenshot,
so hiding a banner or dimming a region leaves no residue in the page and no cleanup step.

### Third-party candidates

| Package                                                      | Version | License    | Last published  | Verdict                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ------- | ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`rough-notation`](https://npmjs.com/package/rough-notation) | 0.5.1   | MIT        | 2022-05         | **No.** Hand-drawn highlight/box/circle/underline on DOM elements — a genuinely good fit for the annotation _idea_, but unmaintained for four years, and the sketchy aesthetic fights the product's visual language.                                                                                                                        |
| [`leader-line`](https://npmjs.com/package/leader-line)       | 1.0.8   | MIT        | (metadata 2025) | **No.** Draws arrows between two DOM elements — exactly the arrow feature we want. But it is `anseki/leader-line`, UMD-only, no ESM, no types, and effectively unmaintained upstream. Injecting it into a page is possible via `addScriptTag`, but it becomes ours to maintain the moment it breaks.                                        |
| [`roughjs`](https://npmjs.com/package/roughjs)               | 4.6.6   | MIT        | 2023-11         | No — same aesthetic objection; only relevant as `rough-notation`'s engine.                                                                                                                                                                                                                                                                  |
| [`sharp`](https://npmjs.com/package/sharp)                   | 0.35.3  | Apache-2.0 | 2026-07         | **Maybe, later.** Actively maintained. Not needed for in-page annotation, but the right tool if we ever move the light/dark diagonal composite out of its current throwaway-HTTP-server hack, or want to post-process (borders, rounded corners, drop shadows) after capture. Native binaries — an install-cost worth paying only for that. |

### Recommendation

**Build a small in-repo annotation overlay; add no runtime dependency.**

Rationale:

- Annotations must be positioned from live DOM geometry (`getBoundingClientRect()`), which is a
  handful of lines in-page — the libraries mostly wrap that.
- Both DOM-annotation candidates are unmaintained, and this repo is deliberately careful about
  supply chain (see the zero-telemetry, no-CDN posture in `apps/docs/privacy.md`).
- Plain SVG gives exact control over stroke colour per theme, which matters because these images
  ship into a light/dark docs site.
- It is dev tooling: it never reaches a user's browser, so the usual "don't reinvent it" pressure
  is weaker than the maintenance risk.

Revisit `sharp` only if post-capture compositing becomes a real need.

---

## 2. Phase 1 — scene ergonomics

Make the common action trivial: _"recapture the flaky screenshot"_.

- **Tag scenes.** Add `tags: ['docs']` / `['desktop']`. The list is now mixed, and running the
  whole file writes desktop scenes into the docs directory.
- **Per-scene output.** Add `out: 'docs'` resolving to `apps/docs/public/screenshots`, so
  `node scripts/take-feature-screenshots.mjs flaky-detection` just works. Keep `--out` as an
  override.
- **Group runs.** `--tag docs` to recapture every docs illustration in one pass; add
  `npm run app:screens:docs`.
- **Better `--list`.** Print name, description, tag, and the file each scene writes.
- **Fail on unknown scene** (already does) and **suggest near-matches**.

Acceptance: `npm run app:screens:docs` regenerates every committed docs image and nothing else.

## 3. Phase 2 — robust targeting

This is where the real fragility is. `xpath=ancestor::div[4]` is a bug waiting to happen.

- **Add capture hooks to the app.** Put `data-shot="alternative-locators"` (etc.) on the
  containers docs images actually show. Scenes then target meaning, not structure. This is the
  single highest-value change here; everything else is ergonomics.
  - Candidates seen while capturing: the alternative-locators card, the cluster triage rail, the
    cluster summary, the run-insights panel, the flaky table, the performance trend card.
  - Keep the attribute list small and documented; treat it as an API the harness depends on.
- **Use `locator.screenshot()`** instead of computing clips. It handles scrolling, device pixel
  ratio and elements taller than the viewport — the last of which silently truncated the
  locator-healing image until the viewport was raised to 1300px.
- **Declarative scene shape** for the common case:

  ```js
  {
    name: 'locator-healing',
    tags: ['docs'],
    route: '/test-run-cases/1',
    // open collapsible sections before capturing
    expand: ['[data-shot="alternative-locators"]'],
    // capture just this element, padded
    of: '[data-shot="alternative-locators"]',
    pad: 12,
  }
  ```

  with `run()` still available for anything irregular.

- **A `settle()` helper**: `document.fonts.ready`, no in-flight requests, chart elements present —
  replacing arbitrary timeouts. Combine with `animations: 'disabled'` at capture time.
- **Keep `openTab()`**, but make it assert the panel it opened is visible, so a renamed tab fails
  loudly instead of capturing the wrong screen. (The cluster redesign removed the tabs entirely and
  the old scene simply timed out — that was the _good_ outcome; silently capturing a collapsed
  header, as the first locator-healing attempt did, is the bad one.)

## 4. Phase 3 — annotations

An in-page overlay injected by the harness, drawn from DOM geometry, removed after capture.

### Proposed scene API

```js
{
  name: 'run-insights',
  tags: ['docs'],
  route: '/test-runs/1',
  async run({ page, shoot, annotate }) {
    await openTab(page, 'Insights');
    await annotate([
      { type: 'box',      target: '[data-shot="run-summary"]', label: 'vs last green run' },
      { type: 'step',     target: '[data-shot="new-regressions"]', n: 1 },
      { type: 'arrow',    from: '[data-shot="pass-rate"]', to: '[data-shot="baseline-delta"]' },
      { type: 'callout',  target: '[data-shot="flaky-chip"]', text: 'not your change', side: 'right' },
      { type: 'spotlight', target: '[data-shot="new-regressions"]' },
    ]);
    await shoot();
  },
}
```

### Primitives

| Type        | Draws                                                           | Notes                                                      |
| ----------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| `box`       | rounded outline around an element, optional label chip          | the workhorse                                              |
| `arrow`     | curved path with a marker-end, element→element or element→point | needs a simple bezier; avoid crossing the target           |
| `step`      | numbered circular badge pinned to a corner                      | for "1, 2, 3" tutorial images                              |
| `callout`   | text bubble with a leader line                                  | keep text short; it is baked into a PNG and untranslatable |
| `spotlight` | dims everything except the target                               | implement with an SVG mask, or four dimming rects          |
| `redact`    | solid block                                                     | prefer Playwright's `mask` unless a label is needed        |

### Implementation sketch

- One `<svg>` pinned `position: fixed; inset: 0; pointer-events: none; z-index: 2147483647`, plus a
  sibling `<div>` for HTML labels (crisper text than SVG `<text>`).
- Positions from `getBoundingClientRect()` of each resolved target, computed in-page.
- Colours: a fixed accent that reads on both themes (the product green risks blending into a UI
  full of green). Consider a single strong accent — magenta/amber — used only for annotations, so
  annotation is never confused with UI chrome. Decide once, document it.
- Inject via `page.addStyleTag`/`addScriptTag` from a local module — **no CDN**, consistent with
  the rest of the repo.
- Tear the overlay down after `shoot()` so a scene can take an annotated _and_ a clean capture.
- Respect `prefers-reduced-motion`-style determinism: no animated draw-in.

### Open questions for the implementing session

- Do annotated images belong in `apps/docs/public/screenshots/` beside the plain ones, or in a
  sibling directory? Suggest a `-annotated` filename suffix and keeping both, so a page can choose.
- Are baked-in English labels acceptable long-term? They cannot be translated or copy-edited
  without a recapture. An alternative is annotating in the page's own markup (VitePress figure +
  CSS overlay), which stays editable — heavier to build, but worth weighing before committing to
  baked text.

## 5. Phase 4 — determinism and drift detection

- **Relative timestamps make every capture differ.** The seed rebases to load time, so
  "about 1 hour ago" changes on every run and every recapture produces a diff. Either:
  - accept it (fine while recaptures are manual), or
  - add a `--freeze-now <iso>` that pins the clock for capture runs, making images byte-stable and
    a pixel diff meaningful.
    The second unlocks the next bullet.
- **Drift check in CI.** With a frozen clock, a job can recapture and compare against the committed
  PNGs (`odiff` or `pixelmatch`) and fail when the UI has moved. That is the check that would have
  caught every problem listed at the top of this file.
- **Orphan check.** `--check` that fails when a file in `apps/docs/public/screenshots/` has no
  scene producing it, and when a scene's target file is missing. Cheap, and closes the loop that
  let the old images drift unowned.

## 6. Suggested order

1. Phase 1 (ergonomics) — small, immediately useful.
2. Phase 2 `data-shot` hooks + `locator.screenshot()` — the durability win; do before annotations,
   because annotations target the same hooks.
3. Phase 4 orphan check — cheap, prevents recurrence.
4. Phase 3 annotations — largest piece; resolve the baked-text question first.
5. Phase 4 frozen clock + CI diff — only once recapture is routine.

## 7. Known context the next session will want

- Dev DB: `npm run app:seed:demo && npm run db:migrate && npm run app:seed:dev` from
  `apps/application/`. The seed loader was fixed on 2026-08-02; it now loads 4129 rows with no FK
  violations and rebases timestamps to now. A partial load exits non-zero.
- The harness boots its own dev server unless given `--url`; driving an already-running server is
  much faster while iterating on scenes.
- **`flaky_root_cause` is never populated by using the app** — no frontend code calls
  `POST /api/projects/:id/flaky-classify`, so the Root cause column is empty until something
  triggers it. The current flaky screenshot required calling that endpoint by hand. Fixing this
  properly is a product change, not a harness change, and is still open.
- **The seed models a retry as `retries=1` on a single passed row**, while `concepts.md` and the
  flaky handler both expect retries as separate execution rows. So retry-passes are never detected,
  every flaky row shows "0 min wasted", and a test case with six retry passes never appears in the
  flaky list. Any screenshot of the flaky feature understates it until this is fixed. Also still
  open.
