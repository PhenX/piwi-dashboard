# UX audit — the test run page (`/test-runs/[id]`)

**Date:** 2026-08-21 · **Scope:** `apps/application/app/pages/test-runs/[id].vue` + `app/components/run/` · Second audit in the series — the first covered `/test-run-cases/[id]` (`UX_AUDIT_TEST_RUN_CASE.md`). Same method: ARIA snapshots from the live seeded app, eight parallel specialist reviews, every headline claim re-verified, per-finding screenshots captured and reviewed.

## Method

10 ARIA snapshots + full-page screenshots from a demo-seeded dev server: failed run #63 (10 tests, 2 failures, HTML report) across all 7 tabs; interrupted run #4 (12 tests, 3 did-not-run, traces/visual-diff); passed run #73 (failure tabs disabled); failed #63 at 375×812. Reviewers were briefed with the two product decisions from the first audit's review — `router.replace`-only tab sync is by design (refresh keeps the tab; Back leaves the page), and empty states are judged against the shared `EmptyState`/`FeatureUnavailable` primitives — plus the first report for cross-page comparison. 17 per-finding screenshots were then captured and individually reviewed.

## Verdict

**The run page is structurally stronger than the execution page — and still loses the user in four ways.** The tab strip never reflows (failure tabs disable instead of disappearing — exactly what the first audit asked for), counts reconcile in every state including interrupted (12 = 6+3+0+3), statuses go through `formatStatusLabel`, help topics are actually wired (9 of 10), and only 2 of 67 page controls lack an accessible name (vs 22 of 78 on the execution page). But:

1. **Three things are broken outright.** Regression — the "what changed since green" tab — renders a completely blank panel on refresh or any shared `?tab=regression` link (hydration mismatch, verified); the Slow endpoints "Max" column renders unitless numbers; and the saved-event markers on the trend/bar charts are buried under the bar-hover overlay, so their hover tooltip never appears and a click opens the run instead of the marker (verified, R23 — a shared chart bug, not a run-page tab).
2. **The landing tab can't answer the landing question.** Test cases shows no error text, doesn't sort failures first (they sit at rows 3 and 7 of 10), and never says which failure group a red row belongs to — while the tab that shows both error messages inline sits two positions away under the jargon label "Failure groups".
3. **Status evaporates off desktop.** In the tree view and on mobile, pass/fail is an icon whose author-written `aria-label` is silently discarded (`@iconify/vue` forces `aria-hidden`), so a phone user — and every screen-reader user — cannot tell the failed test from the passed ones. The mobile summary also fills the entire first viewport: zero test rows above the fold.
4. **The words fight the rest of the product.** The "Test cases" tab lists executions; "Failure groups" is a this-page-only rename of failure clusters that the page itself contradicts twice; "Regression" carries four meanings and its help topic describes a different tab; and the summary's amber play-icon "Retry" button copies a command — on the same page where Failure groups labels the identical action honestly ("Copy retry command").

---

## P0 — Broken, fix first (all verified)

### R1. The Regression tab is blank on refresh and on every shared link — ✅ shipped 2026-08-21

Direct-load `?tab=regression` → an empty panel (ARIA tree ends at `tabpanel "Regression"` with zero children; screenshot confirms ~450px of white). Click the tab in-session → full content renders ("Last passing run: Run #71 · 2 new failures · Commits introduced since last passing run" + copyable `git log` range). The API returns complete data either way (verified live). Cause: `RegressionContext.vue:16` fetches with `{ lazy: true, server: false }` — SSR renders the `EmptyState` branch (`loading` false, `context` null), the client's first paint expects the `LoadingState` branch, and Vue reports `Hydration class mismatch` naming this component, then discards the subtree. Its two working siblings (`FailureGroups.vue:22`, `SlowEndpoints.vue:19`) use the same pattern without `server: false`.

**Fix:** drop `server: false` (lazy alone keeps it off the critical path), or gate the template behind a mounted flag so SSR and first client paint agree. Also give the panel a layout-level fallback so no tab can ever render nothing.

### R2. Slow endpoints' "Max" column has no unit — ✅ shipped 2026-08-21

`Avg 202ms · P90 240ms · Max 258` — the `maxDuration` column is declared (`SlowEndpoints.vue:59-61`) but has no cell template, so the raw millisecond number prints beside a "Calls 10" column and reads as a count. **Fix:** a `#maxDuration-cell` with `DurationValue` (3 lines).

### R3. Tree view + zero cases renders nothing at all — ✅ shipped 2026-08-21

`TestCasesList.vue:364` requires `treeView && testCases.length > 0` and `:377` requires `!treeView` — with tree view on (a 1-year cookie) and an empty/filtered-to-zero run, neither branch renders. Blank panel, no empty state. **Fix:** `v-if="treeView"` and let the tree own its empty case.

### R23. Saved event markers on the charts: hover shows nothing — the flag is buried under the bar-hover overlay (verified)

The user-saved event markers (deploys, config changes, incidents — the dashed vertical flags on the trend/bar charts) have a fully wired hover tooltip that never appears in practice. `ChartMarkerLines.vue:41-53` draws one flag `<circle>` per marker at plot-y 0 with `@click="marker-click"` **and** `@mouseenter="show"` / `@mousemove` / `@mouseleave` → `ChartMarkerTooltip` (label, date, environment, description). So hover is wired — but every chart that embeds markers renders `<ChartMarkerLines>` **before** its transparent full-height "hover column" `<rect>`s, and SVG paints in document order, so those columns sit on top of the flags and swallow the pointer:

- `TestRunsChart.vue:120` (markers) then `:127-140` (hover rects, `@mouseenter="show(run)"` + `@click="navigateTo('/test-runs/…')"`)
- `PerformanceTrendChart.vue:128` then `:135-145`
- `TestCaseHistoryChart.vue:115` then `:122-132` (the History tab on the execution page audited first)

**Verified in the browser** (project #1, three seeded markers): `document.elementFromPoint` at a flag's center returns `rect.cursor-pointer` — the overlay, not the flag — and hovering the center shows no tooltip. Hovering the ~1px sliver of the flag that pokes *above* plot-y 0 (the only part the overlay doesn't cover) returns `circle.cursor-pointer` and the marker tooltip appears ("Enabled strict CSP in production · Aug 16, 04:19 AM · production"). So the marker's entire hover target is a ~4px sliver at the very top edge of the plot; everywhere else on the flag and its dashed line, the run/point hover column is on top. The same overlay also steals the click: a click at the flag center hits the overlay `<rect>`, whose handler navigates to the run — so clicking a marker opens a run, not the marker, except on that top sliver.

**Fix (shared, one component's consumers):** render `<ChartMarkerLines>` **after** the hover-column rects in each chart so the flags sit on top, and add `pointer-events-none` to the decorative dashed `<line>` in `ChartMarkerLines.vue:31` so only the flag circle is interactive (the line shouldn't intercept the bar hover). A taller/rounded flag hit-area helps too, but paint order is the root cause. Affects the project page's run and performance charts and the execution page's History chart — not the run-page tabs themselves (there markers appear only as `MarkerBadge` chips).

### R4. Status and browser labels are written — and silently discarded — ✅ shipped 2026-08-21

`TestCasesList.vue:471-477` and `TestCasesTree.vue:286-293` set `role="img"` + `aria-label="Status: …"` on a `UIcon`; `BrowserBadge` names the browser only in a tooltip. None of it reaches the accessibility tree: `@iconify/vue` defaults rendered icons to `aria-hidden: true`, which `role`/`aria-label` do not clear. Verified: zero "Status:" strings across all ten snapshots; the Browser column is an empty cell in every desktop row. In the tree and mobile card views the icon is the row's **only** status encoding (the tree's own comment says so), so pass/fail is absent for AT and color-only for everyone else (WCAG 1.1.1, 1.4.1). **Fix:** wrap the icon — `<span role="img" :aria-label="…"><UIcon/></span>` — or an `sr-only` span; three files, three lines. On mobile also render the status word visibly (the desktop badge already exists).

---

## P1 — Where users get lost

### R5. The landing tab cannot answer "why did it fail" — ✅ shipped 2026-08-21

No row renders error text (the `error` field is on the record but unused in the template); failures don't sort first (`sortKey` defaults to null → insertion order — the two red rows sit at positions 3 and 7); no row names its failure cluster (`failureClusterId` is used only as a filter predicate). Reading both failures' messages costs 1 filter click + **2 full page navigations** — while Failure groups shows both messages inline at 1 click, two tabs away. Sorting by Status doesn't help: `sortValue` uses the raw status, so `timedOut` sorts away from `failed` even though the filter and badge normalize them together. **Fix:** one-line truncated error under failed titles (the sub-line slot exists), failure-first default sort when `failedTests > 0`, a small cluster badge (`G1`/`G2`) linking to the cluster, and `timedOut` normalized in `sortValue`.

### R6. Mobile: the summary is the whole first viewport, and the list stops being a table

At 375×812 the unreflowed summary (all five tiles including two zeros, full metrics strip, CI/git/storage chips) pushes the tab select to y≈763 — **zero test rows visible on landing**. Two different collapse controls coexist ("Collapse summary" — cookie, 1 year, all runs; "Hide summary" — resets on reload). Below `md` the cards keep `role="table"`/`row` + `aria-rowcount` but have no cells, no headers, no `aria-rowindex` — malformed for AT — and (per R4) no status. The list wrapper's `max-lg:h-[70dvh]` also reintroduces exactly the nested scroller `DetailPageLayout`'s own comment promises not to have, so below 1024 the page and the list compete for flicks. Three breakpoints (`sm` tabs, `md` table, `lg` scroll model) create bands where half of each world applies. **Fix:** default the summary to its folded one-line form below `lg` on finished runs; keep one fold control; drop the `70dvh` box; align card/table flip to the tab-select breakpoint; drop table roles below `md`.

### R7. Identity gaps: empty `h1` everywhere, no project on mobile, two names for one project

`heading [level=1]` is empty in 10/10 snapshots (`UDashboardNavbar` gets no title — same app-wide F2 from the first audit). At 375px the project name appears **nowhere on the page** (breadcrumb ancestors collapse; the summary never renders it) — "Run #63" is a global id, and the demo has five projects. The browser-tab title uses the slug (`web-dashboard`) while the crumb uses the label ("Web Dashboard"). **Fix:** `:title="Run #63 · Web Dashboard"` on the navbar (closes all three), `project.label ?? project.name` in `useHead`.

### R8. "Am I on the latest run?" is a nameless icon that exists only when the answer is no

The pulse affordance (`[id].vue:609-624`) renders only when you're stale, is a `link` with no accessible name nested inside the project-crumb link, is hover-explained only, and is dropped entirely on mobile. On the latest run there is no positive signal — absence is the message. **Fix:** a labeled state beside the status chip ("Latest run" / "Newer run → #73", pulsing when live), `aria-label` on the link, rendered at all widths.

### R9. Live runs: tabs lag, and nothing announces

`hasFailures` reads the **persisted** run (refreshed only on `run-finished`), so during a live run the summary can show "Failed 2" (live SSE) while Failure groups/Regression sit disabled beneath it. There is no `aria-live`, `role="status"` or `progressbar` anywhere in the run surface — a streaming page that is completely silent to AT; "N completed" also counts rows still `running`. **Fix:** derive `hasFailures` from `displayProgress`; one polite throttled live region; `role="progressbar"` + values on `TestStatusBar`; count only finished rows and show the denominator.

### R10. The interrupted run never explains itself — the prose exists, unwired

Run #4: chip "Interrupted", tiles 12/6/3/0/3 — and no banner, help, or chip says what interruption means or why 3 tests vanished. The only explanation is a hover `title` on the "Didn't run" tile that names two causes (maxFailures, serial-group) and omits the actual ones. The registry's `run.partial` topic ("This run covered only part of the suite … totals aren't a full picture") is wired only to the project page; `DidNotRunCard`'s sentences exist only on the execution page; `getStatusIcon` has no `interrupted` case (falls back to the skipped glyph). Also state-blind: "Wasted 3.7s" renders on an all-green run with no explanation anywhere on desktop, and the leading "3.4m" duration has no label. **Fix:** `HelpHint topic="run.partial"` beside the chip when interrupted/sharded; per-row reason via the R4 sr-only span; wasted-time help on the chip and column; label the duration.

### R11. "Flaky" is counted one way and filtered another — and a flaky-only run hides its failure tabs

The badge counts `flakyTests` and its tooltip promises "passed only after a retry (a subset of passed)"; clicking filters `retries > 0` — any retried test, including ones that failed every attempt (`TestCasesList.vue:71`). And since flaky ⊂ passed, a run whose only problem is flakiness has `failedTests = 0` → Failure groups and Regression disabled, though clusters track passed-on-retry cases. **Fix:** filter `status === 'passed' && retries > 0`; gate the tabs on `failedTests > 0 || flakyTests > 0`.

### R12. Disabled tabs never say why — and keyboard users can't reach them

The right pattern (stable strip), incompletely delivered: `tab … [disabled]` carries no reason, the count drops instead of showing `(0)`, the native `disabled` removes the tab from roving focus (keyboard users can't even land on it to get a tooltip), and visually it's a slightly lighter grey among six grey tabs. **Fix:** `disabledReason` on `DetailTabItem` rendered as `title` + `aria-description`; `aria-disabled` instead of native so it stays focusable.

### R13. Twelve filter controls expose no state, and two filter models contradict each other — ✅ shipped 2026-08-21

The five summary tiles (single-select, replaces the set), the five list chips (multi-select), and the two view toggles all carry state as background color only — no `aria-pressed` anywhere, no group labels. Select a tile then add a chip: the list shows a multi-filter while the **Total** tile lights up claiming "no filter"; clicking any tile silently discards the multi-selection. The browser `USelect` has no accessible name; Compare's baseline select is announced as "Show popup" (orphaned label); the storage chip is named by its value ("236.27 KB · 3 files"). Zero-count tiles ("Skipped 0") are live buttons filtering to an empty list. **Fix:** `aria-pressed` across all twelve; make the tiles toggle into the same set the chips use; label the two selects; disable zero tiles.

### R14. The cluster-filter flow drops you into an unnamed mode — ✅ shipped 2026-08-21

"Filter" (a one-word button on a cluster row) switches tabs and shows "Filtered by failure group" — naming no group, no count (with 2+ clusters, two consecutive filters are indistinguishable), living outside the toolbar that owns every other filter, absent from the URL (a shared link or refresh silently shows all 10 rows), and force-expanding the tree while disabling Collapse-all. **Fix:** name the cluster + matched count in the chip; `?cluster=` in the query restored like `?tab=`; relabel the button "Show failing tests"; keep collapse enabled.

### R15. The Timeline is one unnamed graphic with mouse-only interactions

The whole tab is a single `img` node — a ~1,300-character blob of tick labels and worker names containing **no test names** — with no `role`/`aria-label` on the SVG; click-to-jump lives on bare `<rect>`s (no tabindex/role/keys), pan/zoom is pointer-only, tooltips are hover-only. Clicking a span also silently calls `setTreeView(false)`, overwriting the user's persisted view preference for a year across all runs. **Fix:** `role="img"` + summary label; make spans focusable links; have `scrollToCase` respect tree mode (or switch view non-persistently).

### R16. "Retry" doesn't retry — and the same page proves the right label

The summary's amber play-icon button `aria-label="Retry"` copies a command to the clipboard; the click that opens its format-mode popover has *already copied* with the previous mode, so changing mode costs 3 clicks and one wrong clipboard overwrite. Two tabs away, Failure groups labels the identical function "Copy retry command". The execution page's F16 already ruled on this. **Fix:** rename + clipboard icon; apply-on-select in the mode menu. Related inversion: **Delete** is one of only two always-visible navbar actions (the destructive one, beside ever-used Refresh), while Share/Export don't exist at run level and the report button loses its label on mobile. Move Delete to an overflow menu; promote "Copy run summary" to the navbar.

---

## P2 — Vocabulary and consistency

### R17. "Test cases (N)" is a list of executions

Rows are keyed `executionId`, link to `/test-run-cases/:id`, carry a Browser column and fold retries — the documented definition of *executions*, not browser-independent test cases (`concepts.md`). The same ten objects are called "Test cases", "cases", "tests" and "Total" on one screen, and "execution" appears nowhere in run-page copy. **Fix:** "Executions (10)" (or "Results"), align the toolbar/timeline nouns.

### R18. "Failure groups" exists only on this page — which contradicts itself twice

Everywhere else the entity is a **failure cluster** (docs, URL, the execution page's card, the destination page's own title). This page's tab help popover is titled "Failure clusters" and its Insights section says "New failure clusters" — while the tab, chip, count line and empty state say "groups". The cluster table also prints the raw triage enum (`cell "open"`) under a header ("Status") that means test-outcome on the neighboring tab, and green "resolved" can render inside a red run (the first audit's F9 pattern). **Fix:** rename the four strings to "Failure clusters"; header → "Triage"; label-format the value.

### R19. "Regression" ×4, "baseline" ×2, and Compare arrives unset

The Regression tab shows a commit range; Insights' "New regressions" means newly-failing tests; "Most regressed"/"N regressed" mean *slower*; `@regression` is a test tag rendered beside the `NEW` badge. The tab's own help topic describes the Insights list, not the tab. "Baseline" is the documented auto-selected last-green in Insights but a manual pick in Compare — which lands on "Select a baseline run…" (empty) with a "previous run" shortcut that may be red, disagreeing with the baseline the tile above just used. **Fix:** rename the tab "Since last pass"; retitle the help topic; "Slower" for duration; preselect and name the documented baseline in Compare.

### R20. Count units ×4, and one count appears only after you visit

`Test cases (10)` = executions, `Failure groups (2)` = clusters, `Timeline (4)` = **workers**, `Slow endpoints (n)` = routes — where n is emitted by the child, which mounts only when the tab opens: six of seven snapshots show a bare label, the seventh shows "(3)", and it persists after one visit, so the strip mutates mid-session and a bare label falsely reads as "empty". Zero-handling differs three ways. The first audit's F14, recurring at run level. **Fix:** compute the endpoint count with the run payload; "Workers timeline" if the count stays; one zero rule.

### R21. Empty states: 5 correct, 7 hand-rolled, 1 celebration on a failing run

Inventory (owner decision #2): correct — Insights ×3 (`EmptyState`), Slow endpoints (`FeatureUnavailable` + doc), Regression's coded branches (blocked by R1). Hand-rolled — the list's no-cases and no-match divs (`TestCasesList.vue:643-651`, no clear-filters action despite `hasFilter` existing), Compare ×3 (`RunCompare.vue:295-309`), Timeline (`WorkersTimeline.vue:169-171`), and Failure groups' empty state pairing a **party-popper icon** with a failing run (`FailureGroups.vue:262-264`). Plus the R3 no-render hole. **Fix:** swap all seven for `EmptyState` (clear-filters button in its slot); neutral icon.

### R22. Convention breaks

Date idiom inverted ("Started 8/20/2026, 7:18:32 PM · about 12 hours ago" — the rule is relative first, timestamp on hover); Title Case survivors ("HTML Report", "AI Diagnosis", "Test Run #63" in the delete modal); the worker index rendered four ways (`0`, `w0`, `W0`, `Worker 0`); "Slow endpoints" is sorted, not filtered (a 58ms endpoint lists under it); the `UTable`s in Failure groups and Slow endpoints are unnamed with a stray empty header row; ten identical "Choose how to open in IDE" button names in one table.

---

## What the run page does better (protect these — and port them)

- **The stable tab strip with disabled failure tabs** is the model the execution page should adopt (its F5).
- **`formatStatusLabel` everywhere** — "didn't run", never "Didnotrun" (fixes the execution page's F15 pattern).
- **Help topics are wired** — 9 of 10 `run.*` topics render, vs four dead `case.*` topics on the sibling page.
- **Only 2 unnamed controls of 67** (vs 22 of 78) — the naming discipline exists; the gaps are state (`aria-pressed`) and value exposure, not labels.
- **"run #N" always means a run**; filter state is lifted to the page and survives tab switches; the desktop table is a properly-built ARIA grid; 375px has no horizontal scroll; Compare's "previous run" shortcut is a genuinely one-click delta; the interrupted run links its preceding timeline marker.

## Shared root causes — one fix, both pages

| Fix once in | Closes |
|---|---|
| `UDashboardNavbar :title` (both pages) | empty `h1`, mobile identity (F2 + R7) |
| `DetailPageLayout` — real tabpanels, labeled `USelect`, one fold control, `disabledReason` | F10/F5 + R6/R12 + both unnamed comboboxes |
| `BreadcrumbNav` leaf truncation + `shrink-0` actions | F2 collision + R7's waiting label overflow |
| `MetaStripGroup role="group"` | F-polish + R10's run-on strip |
| "Copy retry command" naming + icon | F16 + R16 |
| One `(n)` count rule | F14 + R20 |
| `EmptyState` sweep | F21 + R21 |
| Scoped/per-entity fold & view cookies, bulk toggles | F17 + R15's silent rewrite |

## Quick wins (≤ ~5 lines each)

| # | Change | Where |
|---|---|---|
| 1 | Drop `server: false` — un-blanks the Regression tab | `RegressionContext.vue:16` |
| 2 | `#maxDuration-cell` with `DurationValue` | `SlowEndpoints.vue:59` |
| 3 | `v-if="treeView"` + tree-owned empty state | `TestCasesList.vue:364` |
| 4 | Wrap status/browser icons so labels reach AT | `TestCasesList.vue:471` · `TestCasesTree.vue:286` · `BrowserBadge.vue:48` |
| 5 | Navbar `:title="Run #N · Project"` | `[id].vue:583` |
| 6 | `aria-label` + visible "Latest/Newer run" pill | `[id].vue:609-624` |
| 7 | `aria-pressed` on tiles/chips/toggles; label the two selects | `RunSummary.vue` · `TestCasesList.vue:344` · `RunCompare.vue:154` |
| 8 | `hasFailures` from `displayProgress` | `[id].vue:476` |
| 9 | "Copy retry command" + clipboard icon | `RunSummary.vue:334-345` |
| 10 | Name the cluster in the filter chip; `?cluster=` in URL | `[id].vue:574-577,665-675` |
| 11 | Failure-first default sort; inline error line on failed rows | `TestCasesList.vue:102,536` |
| 12 | `run.partial` hint on interrupted; wasted-time hint; label "3.4m" | `RunSummary.vue:253,495,515` |
| 13 | Endpoint count from run payload; one count rule | `[id].vue:470,534` |
| 14 | "Failure groups" → "Failure clusters" (4 strings) | `[id].vue:513,666` · `FailureGroups.vue:84,264` |
| 15 | `EmptyState` sweep ×7 + neutral icon + clear-filters slot | see R21 |
| 16 | Relative date first, timestamp on hover; sentence-case 3 strings | `RunSummary.vue:314` etc. |
| 17 | Chart markers: render `<ChartMarkerLines>` after the hover-column rects + `pointer-events-none` on the flag line, so marker hover/click work | `TestRunsChart.vue:120` · `PerformanceTrendChart.vue:128` · `TestCaseHistoryChart.vue:115` · `ChartMarkerLines.vue:31` |

## Suggested sequencing

1. ~~**Now:** R1 (blank tab), then quick wins 2–9 — two real bugs and the status-visibility fix cost ~30 lines total.~~ ✅ shipped 2026-08-21 (`fix(ui): fix run page audit findings, aria labels and regression tab`): R1, QW2–9, plus R23's warning fix (`refactor(app)` git-url dedup).
2. ~~**Next:** R5 (make the landing tab answer the landing question) + R13/R14 (one filter model, named cluster mode) — the structural "lost" fixes.~~ ✅ shipped 2026-08-21 (`fix(ui): sort failures first, unify filters, deep-link cluster mode`): R5 (failure-first default sort, inline error line, cluster badge), R13 (tiles toggle into the chip set, zero tiles disabled), R14 (named/counted cluster chip, `?cluster=` deep link, "Show failing tests", collapse stays enabled). Covered by `tests/run-page-filters.spec.ts`.
3. **Then:** the shared-root-cause table — each row pays off on both pages at once.
4. **With the execution page's plan:** the terminology pass (R17–R19 + F11–F13) as one vocabulary change, so both pages shift together.

## Appendix — regenerating the evidence

Same setup as the first audit (seed + `NUXT_IGNORE_LOCK=1 npx nuxt dev --port 3002`). Capture `ariaSnapshot()` for `/test-runs/63` (`?tab=insights|failure-groups|regression|workers|compare|endpoints`), `/test-runs/4`, `/test-runs/73`, and `/test-runs/63` at 375×812. Stable seed ids: #63 failed+report, #4 interrupted, #73 passed. The Regression bug reproduces only on direct load/refresh of `?tab=regression` — in-session tab clicks render correctly.
