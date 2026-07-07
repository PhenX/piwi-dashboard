# Mobile Responsiveness — Audit & Implementation Plan

**Scope:** the Nuxt 4 dashboard app (`application/app/`) — every page, layout and component.
**Goal:** the dashboard is fully usable on phones (~375 px wide), comfortable on tablets (~768 px), and unchanged on desktop.
**Status:** Phase 0 (foundations) is implemented in this branch. Phases 1–5 are specified below with file-level tasks.

---

## 1. Executive summary

The app is built on Nuxt UI v4's dashboard template, which gives it a solid responsive skeleton for free: the sidebar collapses into a slide-over drawer on small screens, `UDashboardPanel`/`UDashboardNavbar` reflow correctly, and Nuxt injects the standard `width=device-width` viewport meta. Several summary grids already stack via `grid-cols-1 lg:grid-cols-12`.

Below that skeleton, however, the page content is desktop-first. A sweep of all ~100 Vue files found only ~50 responsive-prefix utilities (`sm:` / `md:` / `lg:` / `xl:`) in total — most files have none. The recurring problem classes, ordered by user impact:

1. **Wide data tables** (8 UTable usages + 3 raw `<table>`s) that squeeze or overflow on phones.
2. **Navbar action buttons** with text labels that crowd out breadcrumbs on phones.
3. **Summary stat strips hidden on mobile** (`max-sm:hidden`) — data loss rather than reflow.
4. **Filter toolbars** that don't wrap, forcing horizontal page scroll.
5. **Tab bars with up to 7 tabs** squeezed into the viewport width.
6. **Mouse-only interactions** — the workers timeline pans/zooms with `wheel`/`mousedown` only; no touch support.
7. **Small touch targets** — many icon buttons at ~24 px, below the ~44 px comfortable minimum.

Five reusable primitives were created (this branch) to make the fixes mechanical rather than bespoke:

| Component | Purpose |
|---|---|
| `shared/NavbarActions.vue` | Navbar action row; labels collapse to icon-only below `sm` |
| `shared/BreadcrumbNav.vue` | Full breadcrumb from `sm` up; ancestors collapse into a dropdown below `sm` |
| `shared/TableScroller.vue` | Horizontal-scroll wrapper with min-width + mobile edge-bleed |
| `shared/FilterToolbar.vue` | Wrap-friendly filter/search toolbar (stacks below `sm`) |
| `shared/StatTile.vue` | Standard stat tile (label / value / hint, `sm`·`lg` sizes) |
| `shared/StatTileGrid.vue` | Auto-fit grid for stat tiles — no per-page breakpoints needed |

They are already applied in exemplar spots (test-run page navbar, projects page navbar + table, test-case stats grid, test-cases filter toolbar, detail-page tab bar) so each pattern has a working reference.

---

## 2. What already works (keep as-is)

| Area | Why it's fine |
|---|---|
| `layouts/default.vue` — `UDashboardGroup` + `UDashboardSidebar` | Nuxt UI renders the sidebar as a slide-over drawer below `lg`; hamburger toggle is built in |
| Viewport meta | Nuxt default `width=device-width, initial-scale=1` |
| `useDetailGrid` 12-col summary grids (`RunSummary`, `TestCaseSummary`, `ClusterSummary`) | Spans only apply at `lg:`; everything stacks to one column below |
| `ProjectTrendTable.vue` | Already wrapped in `overflow-x-auto -mx-4 px-4 sm:mx-0` with `min-w-[700px]` — this is the pattern `TableScroller` generalizes |
| `ScreenshotLightbox.vue` | `max-h-[90vh] max-w-[90vw] object-contain` is viewport-safe |
| `CodeBlock.vue`, run-summary custom-data `<pre>` | Have `overflow-x-auto` |
| Most `UModal` usage | Nuxt UI modals go near-fullscreen on small viewports |
| `pages/projects/index.vue` search/tag toolbar | Already `flex-wrap` with a growing search input |
| Empty-state feature grid on home (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`) | Correct mobile-first grid |

---

## 3. Audit findings

Severity: 🔴 unusable/data loss on phones · 🟠 degraded but usable · 🟡 polish.

### 3.1 Global chrome

| # | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| G1 | 🟠 | `pages/test-runs/[id].vue:577`, `pages/projects/index.vue:167`, `pages/test-run-cases/[id].vue:316`, `pages/projects/[id]/test-cases.vue:62`, `pages/projects/[id]/index.vue:605`, `pages/projects/[id]/edit.vue`, `pages/failure-clusters/[id].vue` | Navbar `#right` buttons with text labels (`Refresh`, `Delete`, `New project`…) push breadcrumbs off-screen at 375 px | ✅ `NavbarActions` created; applied to the first four. **TODO:** apply to project detail, edit and cluster pages |
| G2 | 🟠 | Breadcrumbs on run/case/cluster pages (`pages/test-runs/[id].vue:535`) | 4-level breadcrumb incl. run label overflows; no truncation | Hide middle items below `sm` (`max-sm:hidden` on `Projects` item) and `truncate max-w-[40vw]` on the leaf label |
| G3 | 🟠 | `shared/DetailPageLayout.vue:23` | Up to 7 `UTabs` triggers squeezed into viewport width on run page | ✅ Fixed — tab list now `overflow-x-auto` with `shrink-0` triggers |
| G4 | 🟡 | `pages/settings.vue:34` (`UDashboardToolbar` + `UNavigationMenu`) | 8+ settings nav items overflow the toolbar on phones | Same treatment: `overflow-x-auto` on the menu list, or collapse into a `USelect` below `sm` |
| G5 | 🟡 | `pages/settings.vue` body `lg:max-w-4xl` | Fine, but `sm` padding comes from `lg:py-12` only | Verify `px-4` at small sizes when doing Phase 1 |

### 3.2 Tables

`UTable`'s root is `overflow-auto`, so nothing breaks the page — but `table-fixed` tables *squish* columns into unreadable slivers instead of scrolling, and 8-column tables are painful either way. Strategy per table:

| # | Sev | Location | Columns | Fix |
|---|---|---|---|---|
| T1 | 🔴 | `pages/projects/index.vue:220` | 8 (grouped) + `table-fixed` | ✅ Wrapped in `TableScroller min-width="60rem"`. **Later (Phase 2):** hide `Branch`/`Duration`/`Reports` columns below `md` instead of scrolling |
| T2 | 🟠 | `pages/settings/users.vue:394` | ~6 | `TableScroller min-width="48rem"`; email column `truncate` |
| T3 | 🟠 | `pages/settings/tags.vue` | 4 | `TableScroller` (short table — may be fine; verify) |
| T4 | 🟠 | `components/project/FlakyTestsList.vue`, `SpecHealthTable.vue`, `FailureClustersList.vue` | 5–7 | `TableScroller`; on `SpecHealthTable` consider hiding trend columns below `sm` |
| T5 | 🟠 | `components/run/SlowEndpoints.vue`, `RunCompare.vue:127+`, `FailureGroups.vue` | 4–6 | `TableScroller`; RunCompare side-by-side grid already stacks (`md:grid-cols-2`) |
| T6 | 🟠 | Raw `<table>` in `settings/AiUsagePanel.vue`, `cluster/RegressionContext.vue` | — | Wrap in `TableScroller` (raw tables have **no** default overflow container) |
| T7 | 🟡 | `cluster/ClusterExtractCasesModal.vue:109` | — | Already hides secondary cells (`hidden sm:table-cell`) — keep as reference pattern |
| T8 | 🟡 | `components/project/ProjectTrendTable.vue:110` | 6 | Works (scrolls). Optionally reduce `min-w-[700px]` by hiding `Tests` column below `sm` |

### 3.3 Summary headers & stat strips

| # | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| S1 | 🔴 | `components/run/RunSummary.vue:189` | The T/P/F/S/DNR/Flaky counts + status bar + duration strip is `max-sm:hidden` — the run's headline numbers are simply **gone** on phones | Replace `max-sm:hidden` with a wrapping layout: `flex flex-wrap gap-x-3 gap-y-1 max-sm:basis-full max-sm:order-last`; keep `TestStatusBar` full-width on its own row below `sm` |
| S2 | 🔴 | `components/test-case/TestCaseSummary.vue:107,124` | Same pattern — timing/worker/shard strip and `BrowserBadge` hidden below `sm` | Same fix as S1 |
| S3 | 🟠 | `components/cluster/ClusterSummary.vue:44-60` | `whitespace-nowrap` metadata row can overflow | Add `flex-wrap` to the row |
| S4 | 🟡 | `pages/index.vue:190` stat strip | Already `flex-wrap` — works; optionally switch to `StatTileGrid` for visual consistency |
| S5 | 🟡 | `pages/test-cases/[id].vue:127` stats | ✅ Migrated to `StatTile`/`StatTileGrid` |
| S6 | 🟡 | `pages/test-run-cases/[id].vue:497` Web-Vitals tiles (`grid-cols-2 md:grid-cols-4`) + `:566` paint tiles (`grid-cols-2`) | Acceptable, but migrate to `StatTileGrid` in Phase 3 to drop the bespoke markup |

### 3.4 Filter toolbars

| # | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| F1 | 🔴 | `components/run/TestCasesList.vue:251` | Right-hand group (search `min-w-48` + 5 status pills + browser `USelect w-36`) did not wrap → horizontal overflow inside the tab | ✅ Fixed — group wraps, search grows to full width below `sm`. **Phase 3:** migrate the whole toolbar to `FilterToolbar` |
| F2 | 🟠 | `components/home/HomeFilters.vue` (navbar `#trailing`) | Env multi-select `min-w-[160px]` + switch in the navbar; tight at 375 px | Move into a `UPopover` "Filters" icon button below `sm` |
| F3 | 🟡 | `pages/projects/[id]/index.vue` tab toolbars, `settings/notifications.vue:` subscription rows (`flex items-center justify-between`) | Rows with several controls | Add `flex-wrap` / stack below `sm` during page passes |

### 3.5 Charts, timeline & visualizations

| # | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| V1 | 🔴 | `components/run/WorkersTimeline.vue:118-127` | Pan/zoom is `@wheel` + `mousedown/mousemove` only — **inert on touch devices**; `@wheel.prevent` also blocks page scroll over the chart on desktop | Add pointer-events (`pointerdown/move/up` with pointer capture) for drag-pan, pinch-zoom via two-pointer distance, and a fallback zoom `+`/`−` button pair in `TimelineHeader` (also helps desktop a11y) |
| V2 | 🟠 | `components/project/TestRunsChart.vue:110`, `PerformanceTrendChart.vue:97` | Tooltips are `position: fixed; max-w-[260px]` placed at cursor — can render off-screen at right edge of a phone | Clamp tooltip x/y to viewport (`Math.min(x, innerWidth - 270)`); trigger on tap |
| V3 | 🟡 | `components/test-case/TestCaseHistoryChart.vue` fixed `:height="200"` etc. | Heights fine; verify SVGs use `viewBox` + `width:100%` during Phase 4 |

### 3.6 Page-specific

| # | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| P1 | 🔴 | `pages/failure-clusters/[id].vue:219` | Body is `grid-cols-1 xl:grid-cols-[3fr_2fr]` inside `overflow-hidden` with per-column scroll areas — below `xl` both columns share one clipped container; content below the fold can become unreachable | Below `xl`, drop the inner scroll containers: make the page body the scroller (`xl:overflow-hidden` on the wrapper, `overflow-visible` columns below `xl`) |
| P2 | 🟠 | `pages/test-run-cases/[id].vue` step tree / network requests (`TestCaseNetworkRequests.vue`) | Deep indentation + monospace URLs on 375 px | Reduce indent per level below `sm`; URLs `break-all`; secondary columns already `hidden md:inline` — extend the pattern |
| P3 | 🟠 | `pages/settings/notifications.vue`, `settings/ai.vue` (`grid` forms) | Two-column form grids | Ensure `grid-cols-1 md:grid-cols-2` (spot-check each) |
| P4 | 🟡 | `pages/mcp.vue`, `pages/docs.vue` | Marketing/docs content — long code samples | `CodeBlock` scrolls already; verify padding |
| P5 | 🟡 | `error.vue`, `login.vue`, `forgot/reset-password` | Centered cards — already narrow | Verify only |
| P6 | 🟡 | `cluster/CommitBrowserModal.vue`, `DiagnosisContextModal.vue` | Wide modals with diffs | `DiffPatch`/`DiffFile` need `overflow-x-auto` on the patch body |

### 3.7 Touch ergonomics (cross-cutting)

- Icon-only buttons at `size-3.5`–`size-4` (tree toggles, status pills, `HelpHint`) have hit areas well under 44 px. Fix pattern: add padding, not icon size — e.g. `p-2 -m-2` so layout is unchanged.
- Hover-only affordances (`UTooltip` on truncated text, hover-reveal buttons like run-label editing in `RunSummary`) need a visible-on-mobile equivalent — either always-visible at `max-sm` or tap-to-toggle.
- `@wheel.prevent` regions (timeline) must not trap touch scroll: apply `touch-action: pan-y pinch-zoom` once pointer handlers land.

---

## 4. Conventions (adopt for all new/edited code)

1. **Mobile-first**: write the stacked/narrow layout as the default; add `sm:` / `md:` / `lg:` for wider screens. Avoid `max-sm:hidden` for *data* — hide only decorations.
2. **Breakpoints**: phone < `sm` (640) ≤ large-phone/small-tablet < `md` (768) ≤ tablet < `lg` (1024) ≤ desktop < `xl` (1280). The sidebar drawer switches at `lg` (Nuxt UI default) — align "desktop layout" decisions to `lg`, table column-hiding to `md`.
3. **No fixed pixel widths** on content containers; `min-w-*` only inside a `TableScroller`/`overflow-x-auto` ancestor.
4. **Every wide artifact scrolls in place** (table, diff, code, timeline) — the page body must never scroll horizontally.
5. **Use the primitives**: `NavbarActions`, `TableScroller`, `FilterToolbar`, `StatTile(+Grid)` instead of re-implementing the pattern per page.
6. **Touch targets ≥ 40 px** via padding (`p-2 -m-2` trick when layout must not change).

---

## 5. Phased implementation plan

Phases are independent and PR-sized. Each lists concrete files; estimates assume familiarity with the codebase.

### ✅ Phase 0 — Foundations (this branch)
- [x] Audit (this document).
- [x] `NavbarActions`, `TableScroller`, `FilterToolbar`, `StatTile`, `StatTileGrid` in `app/components/shared/`.
- [x] Exemplar applications: run/projects/test-run-cases/project-test-cases navbars (G1), projects table (T1), detail tab bar (G3), test-cases toolbar wrap (F1), test-case stat tiles (S5).

### ✅ Phase 0b — Follow-up fixes from mobile review (this branch)
- [x] `BreadcrumbNav` (new): ancestors collapse into a dropdown below `sm`; applied to all detail pages (test-runs, test-run-cases, test-cases, projects/[id], projects/[id]/test-cases, projects/[id]/edit, failure-clusters). Covers **G2**.
- [x] `ProjectTrendTable`: `md:hidden` card list per project replaces the horizontally-scrolling table on the home page (issue: home "project health" table scroll). Advances **T1**.
- [x] `DetailPageLayout`: mobile now scrolls as one document (was `overflow-hidden`, clipping a tall summary), tabs sticky, summary collapsible via "Hide summary", and a full-width `USelect` replaces the tab strip below `sm`. Covers **G3** + the "summary not scrollable" complaint.
- [x] `projects/[id]/index.vue`: navbar actions → `NavbarActions` (icon-only on mobile, so the breadcrumb is no longer crowded out); `UTabs` gets the mobile `USelect` treatment. Completes **G1**.

### Phase 1 — Global chrome (~½ day)
- [x] G1: run/projects/test-run-cases/project-test-cases/project-detail navbars → `NavbarActions`.
- [x] G2: breadcrumb collapse on run / run-case / project / cluster pages (via `BreadcrumbNav`).
- [x] G4: settings toolbar (`UNavigationMenu`) scrolls horizontally below its width instead of overflowing.
- [ ] G1 remainder: `pages/failure-clusters/[id].vue` single copy button (fine as-is); `edit.vue` has no navbar actions.
- [ ] F2: `HomeFilters` compact/popover below `sm` (currently stacks acceptably).

### Phase 2 — Tables (~1 day)
- [x] T1: home project-health table → mobile card list (`ProjectTrendTable`).
- [x] T2–T6: wrapped the wide tables — `FlakyTestsList`, `SpecHealthTable`, `FailureClustersList`, `FailureGroups`, `SlowEndpoints` (min-w on sticky table), `projects/[id]/test-cases`, `settings/users`, `RunCompare`, and the raw `<table>` in `RegressionContext` (`AiUsagePanel` already had `overflow-x-auto`). `projects/index` wrapped earlier.
- [ ] Remaining tables: `settings/tags`, and the `test-run-cases` history/steps tables.
- [ ] T4 column pruning below `md` (spec health: trend cells) — optional polish.
- [ ] P6: `overflow-x-auto` on `DiffPatch` bodies.

### Phase 3 — Summaries, stat grids & toolbars (~1 day)
- [x] G3: detail-page tab bar → mobile `USelect` (`DetailPageLayout`, `projects/[id]`).
- [ ] S1/S2: replace `max-sm:hidden` strips in `RunSummary` / `TestCaseSummary` with wrapping rows (headline numbers must be visible on phones). **Still outstanding** — the summary is now reachable/collapsible, but its inner T/P/F/S strip is still hidden below `sm`.
- [ ] S3: `ClusterSummary` wrap.
- [ ] S6: migrate Web-Vitals + paint tiles to `StatTileGrid`.
- [ ] F1 remainder: migrate `TestCasesList` toolbar (and `SlowEndpoints` filter row) to `FilterToolbar`.
- [ ] F3: notifications/subscription row stacking.

### Phase 4 — Charts & timeline (~1–1.5 days)
- [x] V1: `WorkersTimeline` now uses pointer events — one-finger pan, two-finger pinch-zoom — with `touch-action: pan-y` so vertical page scroll still passes through. (Dedicated zoom `+`/`−` buttons not added; pinch covers touch zoom.)
- [x] V2: chart tooltips (`useChartMarkers`) clamp to the viewport on all axes. (Tap-to-show on touch not added — hover/tap still triggers.)
- [ ] V3: verify all SVG charts are `viewBox`-based and fluid.

### Phase 5 — Page passes & touch polish (~1 day)
- [x] P1: failure-cluster page scroll model below `xl` (scrolls as one document below `xl`).
- [ ] P2: step tree / network request density below `sm`.
- [ ] P3–P5 spot checks (settings forms, auth pages, mcp/docs).
- [ ] Touch-target sweep (§3.7): tree toggles, status pills, `HelpHint`, hover-only affordances.

### Phase 6 — Regression safety net (~½ day)
- [ ] Add a Playwright project with `viewport: { width: 375, height: 812 }` (and one at 768) to `application/tests/`.
- [ ] Smoke spec asserting `document.documentElement.scrollWidth <= window.innerWidth` (no horizontal page scroll) on: home, projects, project detail, run detail (each tab), test-case detail, cluster detail, settings pages.
- [ ] Screenshot tests at both viewports for the run-detail and home pages.

**Total estimated effort for Phases 1–6: ~5 developer-days.**

---

## 6. Verification checklist (run per phase)

1. `npm run app:typecheck && npm run app:lint` — clean.
2. Dev server in demo mode (`PIWI_DEMO_MODE=true npm run app:dev`) → check at 375×812, 768×1024, 1440×900:
   - no horizontal page scroll anywhere;
   - navbar: breadcrumb readable, actions reachable;
   - all headline stats visible (not hidden) on phone;
   - tables swipeable in place; tabs scrollable;
   - timeline pannable by touch (Phase 4+).
3. Existing Playwright suite (`npm run app:test`) still green.
