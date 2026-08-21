# UX audit — the execution page (`/test-run-cases/[id]`)

**Date:** 2026-08-21 · **Scope:** `apps/application/app/pages/test-run-cases/[id].vue` and its cards · **Question:** "I'm feeling like the user may get lost in this page."

## Method

The audit is grounded in the page as it actually renders, not just the source. A dev server was seeded with the demo dataset and **10 ARIA snapshots** (Playwright `ariaSnapshot()`, the tree assistive tech sees and a faithful linearization of the page) were captured from live pages:

| State | Snapshots |
|---|---|
| Failed execution #37 (cluster, trace, screenshots, visual diff, console, network, page state) | Diagnosis (collapsed + fully expanded), Steps, Performance, History, and Diagnosis at 375×812 |
| Passed execution #809 | default (Steps), Artifacts |
| Passed-on-retry #768 (flaky) | default |
| Did-not-run #748 (max-failures cutoff) | default |

Eight parallel specialist reviews were run over the snapshots + source, one per dimension: orientation, tab IA, the Diagnosis funnel, accessibility semantics, status communication, terminology, interaction cost, and cross-state/responsive consistency. Findings below are deduplicated across the eight and **every headline claim was re-verified** against the live app (the traces bug against the live API; the breadcrumb collision visually at 1440×900).

## Verdict

**The concern is confirmed — but the landing moment is not the problem.** A failing execution opens on the error text at 0 clicks and 0 scrolls, with genuinely good folded-card peek lines below it. Users get lost in five specific ways, one layer down:

1. **The page never names itself.** The `<h1>` is empty in all 10 states, and the stand-in identity (the breadcrumb leaf) paints *over* the "Evolution" link at 1440px on long titles and truncates to nothing at 375px. Arriving from a Slack link on a phone, there is no page name, run number, or project visible.
2. **The page contradicts itself.** The Steps tab shows all-green "Step passed" rows on failed *and* never-ran executions; a green "resolved" cluster badge sits beside the red "failed" chip; "AI verdict … high confidence" renders directly above "AI diagnosis is not configured"; three cards cite three different "last pass" baselines (runs #5, #6, #20) in identical words; and a did-not-run execution reports Duration 0ms, Attempts 1, and two mutually exclusive "slowest step" claims.
3. **The IA branches on the wrong variable.** Tab membership derives from `hasError` (a string check), not status. So the same three cards live under **Diagnosis** on a failing execution and under **Artifacts** on a passing one — in inverted order; a flaky pass-on-retry gets the "nothing to see" layout with *no route to attempt 1's failure*; and a live run inserts/removes tabs under the user mid-view.
4. **The funnel is unmapped.** The Diagnosis tab stacks 14 sections into a ~440px scroll area with no jump navigation — while an 18-entry reveal-and-scroll engine for exactly those sections already exists in the page, wired only to AI citations (dead when no AI is configured). Below 1280px the Verdict card's 20 run-dots, the cluster card, and the AI setup promo all sit between the error and the first piece of evidence.
5. **A functional bug hides the deepest evidence.** Traces never render anywhere on the page (details below), while two cards tell the user to go record traces they already recorded.

Accessibility multiplies all of this: 22 of 78 focusable controls on the default failing view have no accessible name (the 20 recent-run dots, the Copy-failure button), tab content renders outside the `tabpanel`, there is no `main` landmark, and on mobile the whole tab bar is one unnamed combobox.

---

## P0 — Functional bug (fix first)

### F1. Traces never render: the `{items}` envelope is not unwrapped — **verified**

`/api/test-run-cases/:id/traces` returns `{ "items": [ { "id": 18, "filePath": "demo/traces/checkout-pay-timeout.zip", … } ] }` (verified live), but `[id].vue:36-38` does `useFetch<TraceInfo[]>(…)` with no `transform`. Consequences, all confirmed in the rendered ARIA tree:

- `hasTrace` (`[id].vue:41`, `.length` on an object) is **always false**.
- `TestCaseEvidenceCard` (`Array.isArray` guard) drops the trace: the peek says "1 screenshot · 1 video" — no trace — and the expanded card has no Traces section.
- The Artifacts tab renders **no Traces card** on passing executions (`TestCaseTracesCard.vue:11`).
- `TestSourceCard.vue:98-104` and `TestCaseNetworkRequests.vue:467-473` print "Want to go deeper? Record traces (`trace: 'retain-on-failure'`)" to users who already record traces, and every trace-powered deep view (full call stack, trace network) stays locked.
- The only working route to the trace is `link "Pick from trace"` inside the *Alternative locators* card — which unwraps `.items` correctly (`LocatorHealingPanel.vue:170-181`).

**Fix (one line):** `{ transform: (r: { items: TraceInfo[] }) => r.items }` on the fetch. Then rename "Pick from trace" is no longer the only door. This single change restores the trace in Failure evidence, the Artifacts Traces card, `hasTrace`-gated views, and silences both false upsells.

---

## P1 — Users get lost here

### F2. The page has no name; its stand-in collides or vanishes

- `- heading [level=1]` is **empty in all 10 snapshots** — `[id].vue:468` passes no `title` to `UDashboardNavbar` (only `mcp.vue` does, app-wide).
- The breadcrumb leaf has no truncation (`BreadcrumbNav.vue:29`), so at 1440×900 "should complete checkout with credit card" **renders on top of the "Evolution" link** — both illegible (verified visually; short-titled states look fine, so it reads as a random glitch, but 41-char Playwright titles are the norm).
- At 375px the leaf truncates to zero: the header is icons only — no title, no run, no project.
- The word **"execution" appears nowhere on the rendered page** (only inside a help button's name), even though `useHead` (`[id].vue:43-53`) explicitly chose it and `docs/concepts.md` defines it.

**Fix:** Pass `:title="testCase?.title ?? `Execution #${id}`"` to `UDashboardNavbar` (the slot already truncates); add `truncate min-w-0` to the breadcrumb leaf and `shrink-0` to the navbar right group. This closes the empty h1, the collision, and the mobile identity gap in two small edits.

### F3. The Steps tab contradicts the page's own status

`[id].vue:723-735` renders each step binary: `✗` if `step.failed`, else `✓ "Step passed"`. Verified: the **failed** execution's Steps tab shows 5/5 green rows and no error anywhere on the tab; the **did-not-run** execution shows 4/4 green "Step passed" rows at 0ms — directly under a card explaining the test never started. `didnotrun` also lands on Steps by default (`defaultTab()` keys on `hasError`).

**Fix:** A third neutral state — render `–` "Not run" when the execution is `didnotrun` (and suppress the "slowest" badge and bars); when the execution failed with no step marked failed, annotate the tab ("failure not captured at step level") instead of asserting 5/5 passed.

### F4. A did-not-run execution reports fabricated metrics

`TestCaseSummary.vue:153-189` renders Duration/Attempts/Steps/Worker and "Slowest step" ungated: the didnotrun state shows **"Duration 0ms", "Attempts 1"**, and "Slowest step: Assert table state" with no duration (label gated separately from its number), while the steps table independently tags row 1 "slowest" (`slowestStepIndex` starts at `max = -1`, so all-zero durations select index 0). Two contradicting "slowest step" claims, and "Attempts 1" asserts an attempt that never happened. Only `wastedTimeMs` is gated correctly.

**Fix:** Gate the tiles + slowest-step row on `status !== 'didnotrun'` (or `duration > 0`), guard `slowestStepIndex` with `max > 0`.

### F5. Tab membership branches on `hasError`, so content relocates and flaky failures become unreachable

- The same three cards (App state, Console, Network) live under **Diagnosis** when failing and **Artifacts** when passing, **in inverted order** (Diagnosis: console → network → page state, `[id].vue:640-660`; Artifacts: page state → console → network, `:808-817`). Nothing is unique to Artifacts — it is Diagnosis minus the diagnosis. The media bundle also renames ("Failure evidence" ↔ "Traces" + "Attachments") and loses fidelity on the failing side (non-media attachments render as bare links instead of markdown previews).
- **Flaky (passed-on-retry) executions** — the product's headline feature — get the passing layout: no Diagnosis tab, no Verdict card (it renders only inside `#tab-diagnosis`), and the attempt badges `1/2 ✗ 2/2 ✓` are static `UBadge`s, not links (`TestCaseSummary.vue:157-176`). **There is no route from this page to why attempt 1 failed.** The nearest flakiness guidance lives in… the Performance tab (`performance-hints.ts:52-58`).
- A **live run** flipping `error` mid-view inserts Diagnosis at position 1 (shifting every tab) or teleports a user off a disappearing Artifacts tab (`[id].vue:167-171`).

**Fix:** Branch on status, not the error string. Keep one always-present Artifacts tab with a fixed card order; give any execution whose attempts include a failure the Diagnosis tab; make attempt badges links to sibling attempts; when a live run adds Diagnosis, reserve the slot (disabled) instead of reflowing the strip, and never relocate the user's active tab.

### F6. Fourteen sections, no map — while a jump-to-section engine sits unused

On the failing view the pinned summary + tab strip consume ~460px of a 900px viewport; the whole Diagnosis funnel (Error + Verdict + Cluster + AI + 10 evidence cards) scrolls inside the remaining ~440px with no jump links, no sticky headers, no section index. Yet `[id].vue:431-462` defines an 18-entry `sectionToAction` map that can already unfold-and-scroll to every section — its only consumer is the AI citation renderer (`DiagnosisResult.vue`), which is dead on unconfigured-AI instances. Console and Network are also the only two uncollapsible cards, sitting mid-funnel (`SectionCard`, not `CollapsibleSectionCard`), which breaks the scan rhythm exactly where users skim.

**Fix:** Render a chip row under the Error card driven by the existing `sectionToAction` keys (label + peek count, click = the existing reveal), ~15 lines. Make Console/Network collapsible with peeks ("1 warning", "4 requests · 1 slow") so the default funnel is ten one-line rows.

### F7. Three cards cite three different "last pass" baselines in identical words

Verified in one expanded snapshot: Verdict — "Last passed in **run #5**"; Environment diff — "vs last pass in **run #6** · 2 days ago"; Visual diff — "vs last pass in **run #20**". Each resolves its own baseline (test history vs env-diff endpoint vs visual-diff endpoint). On a card that just declared "New regression", the funnel's whole job is "what changed since it last worked" — and it answers with three different pasts. This is the finding most likely to produce a *wrong* diagnosis, not just a slow one.

**Fix:** Qualify each label ("vs last passing run of this test (#6)", "vs visual baseline (run #20)") or thread one canonical baseline (the Verdict's `lastPass`) into both diff endpoints.

### F8. The right rail + AI promo sit between the error and the evidence below 1280px

The rail (`xl:order-2`) linearizes DOM-first on **every viewport below `xl`**, not just phones — and `DetailPageLayout` switches its scroll model at `lg` (1024), so 1024–1279px gets the worst of both: pinned summary, short panel, phone ordering, and no Hide-summary button. Reading order after the error: Verdict → **20 unnamed run-dot links** → Failure cluster → **AI-not-configured setup promo** (4 paragraphs, 2 links) → and only then Test source. On the default self-hosted install (no AI provider), a promo occupies the last rail slot on every failure.

**Fix:** Align the order swap to `lg`; when AI is unconfigured, collapse the AI card to a one-line footer ("AI diagnosis not configured · Configure") and/or move it below the funnel on narrow viewports.

### F9. Status signals contradict each other at the top of the page

- Cluster card: `New resolved unknown 6 occurrences` — four unlabelled chips reading as one phrase; **"resolved" is a green badge beside the red "failed" chip**, and the past-tense triage note ("Mitigated… monitoring for recurrence") tells the triager to stop while the failure recurs in front of them. "unknown" is the errorType's null value styled as a status.
- AI: the cluster card renders "**AI verdict** infrastructure **high confidence**" three lines above the AI card's "**AI diagnosis is not configured**" — and the disclaimer "AI-generated — verify before applying." renders **outside** the configured branch (`TestCaseAiCard.vue:155-158`, verified), warning about output that doesn't exist.
- Nothing marks whether the viewed execution is the test's **latest** result (the history shows newer runs, one of them green), and while a run streams, the only "in progress" cue is buried in an Artifacts empty state that failing executions never see (`[id].vue:834-839`).

**Fix:** Prefix scope onto badges ("Cluster: resolved", neutral color when the execution is failing; suppress `unknown`); move the disclaimer inside `v-if="aiStatus?.configured"` (one line); label AI provenance ("diagnosed on the cluster"); add a "Latest result" / "N newer runs" badge from already-loaded history; surface `runIsActive` next to the status chip.

### F10. Assistive-tech structure is broken at page level

- **Tab content renders outside the `tabpanel`**: `DetailPageLayout.vue:55-68` gives `UTabs` no content slots, so every tab `aria-controls` an empty element and the real panels are sibling divs; `v-if` switching drops focus to `<body>` with nothing announced. Same pattern in the Network card's sub-tabs.
- **No `main` landmark anywhere in the app**; the skip link targets an sr-only `<span>`; the two sidebar navigations are unnamed.
- **20 recent-run dots are links with no accessible name** and color-only status, no `aria-current` (`TestCaseVerdictCard.vue:156-162`); the mobile tab switcher is an **unnamed combobox** (`DetailPageLayout.vue:54`) and the only real `tablist` on mobile belongs to the Network card's filter.
- Unnamed buttons: Copy failure (`[id].vue:556-563`), DOM-snapshot copy (`DomSnapshotCard.vue:73-81`); `CodeBlock`'s copy button is *named by the code it copies* (120 chars of CSS). Tooltips are being used as names — they aren't.
- Every card heading absorbs its help button's label ("Test source (2) **Help: Test source** …"); 8 of 13 headings sit inside `role="button"` wrappers (spec-presentational children — heading nav loses them in conforming AT); Enter on a Help button both opens the popover *and* folds the card (keydown not stopped).
- The summary fold is a one-way door: the folded state is a bare `<div @click>` with no role/tabindex (`FoldableSummary.vue:13-17`), persisted by a 1-year, path-`/` cookie shared across **all** executions — a keyboard user who collapses it cannot restore it, on any page, for a year. Mobile shows a second near-duplicate control ("Hide summary") with different scope and persistence.

**Fix:** Real tabpanels (UTabs slots or `role="tabpanel"` + `aria-labelledby` wrappers); `<main id="main-content">`; `aria-label` + `aria-current` on the dots; `aria-label`s on the three unnamed controls and the USelect; move `HelpHint` out of headings/fold-buttons; make the folded summary a real `<button aria-expanded>`; drop one of the two mobile fold controls.

---

## P2 — Friction and vocabulary

### F11. "run #N" names two different entities on one screen

The breadcrumb's `Run #4` → `/test-runs/4` (a run), but the Verdict card's `run #5` → `/test-run-cases/49` (an **execution**), and its "Recent runs" strip links 20 executions (`TestCaseVerdictCard.vue:138-141,154`). `FailureClusterCard` uses the same token correctly two cards away. Clicking "run #5" lands on a near-identical page with no cue you moved sideways, not up. **Fix:** reserve "run #N" for `/test-runs/*`; say "execution in run #5" / "Recent executions of this test".

### F12. One history, five names, three destinations

"Evolution" (navbar → `/test-cases/1`), "View full test history" (History tab → same URL, different label), tab "History (20)" (table rows → `/test-runs/*`), "Recent runs" strip (→ `/test-run-cases/*`), chart "Duration trend". "Evolution" is a coined word used exactly once in the product, styled as 12px grey text while "Refresh" is a solid primary button; its accessible name changes per viewport ("Evolution" vs "View test case evolution and history"). **Fix:** one label — "Test case" (the documented word, and the destination's own title) — for both controls; make History rows link the sibling execution; add an `aria-label` so the name is viewport-stable.

### F13. "Diagnosis" carries three meanings; the explainer exists but is dead code

Tab "Diagnosis" (manual evidence workspace) vs card "AI diagnosis" (LLM output) vs "Verdict"/"AI verdict" (computed status / cluster LLM output). On unconfigured instances the tab name reads as a broken AI feature. `help-content.ts` defines `case.diagnosis-tab`, `case.steps`, `case.artifacts`, `case.backend-logs` — **zero components reference any of them** (verified) — while the tab strip is the only major surface with no help affordance. **Fix:** wire the existing topics onto the tabs; rename "Verdict" → "Regression status", cluster "AI verdict" → "AI analysis".

### F14. `(n)` means six different units; one count contradicts its own label

"Steps (5)" = steps, "Test source (2)" = stack frames, "Failure evidence (2)" = artifacts, "Alternative locators (4)" = candidates (but the list shows 3 + "Show all 4"), "Console output (1)" = lines, "**Network & backend logs (4)**" = requests only — while the card itself reports zero backend logs. Counts also appear on two of five tabs and behave oppositely at zero ("Steps (0)" vs bare "History"). **Fix:** one rule for tab counts; "Network requests (4)" with backend logs as an inner section; peek lines state units (most already do).

### F15. Status spellings and dates diverge in the History table

`didnotrun` renders as "didn't run" (chip), "Did not run" (card), "Didn't run" (filters) — and the History table prints raw **"Didnotrun"** / **"Timedout"** (`{{ row.original.status }}` + CSS capitalize, bypassing `formatStatusLabel`, `[id].vue:1087-1091`), with hard-coded `en-US` absolute dates, no hover timestamp (against the app's own convention), and a concatenated a11y name ("Aug 2103:49 AM"). **Fix:** `formatStatusLabel`; one spelling ("Didn't run"); relative date + full-on-hover.

### F16. "Retry command" looks like "run it again"

The loudest control on the page: solid primary, `i-lucide-play` icon, labelled "Retry command" — and it *copies a string* (`[id].vue:312-317`), previewing it nowhere. Next to the desktop "Run locally" button (which really runs), the confusion is guaranteed. **Fix:** "Copy retry command", clipboard icon, `variant: 'outline'`, command preview in `title`; let Run-locally keep the play treatment.

### F17. Fold state is global, permanent, and bulk-irreversible

Every card fold writes a 1-year, path-`/` cookie keyed per card *type* (`case-test-source`, …), never per execution — collapsing Console once changes every future execution page, and there's no Expand-all (pattern exists in `TestCasesTree.vue:203-207`). The expanded default also hides the failing answer: Test source's peek says "The failing line and 1 caller" (structure) where Alternative locators' peek shows the actual locator code (content). **Fix:** Expand/Collapse-all toggle in the tab header; make Test source's peek the failing source line itself.

### F18. The 0-click IDE button opens the wrong line

The summary's `Open tests/checkout/checkout.spec.ts:9 in IDE` points at the `test()` declaration; the real failing frame (`tests/helpers/payment.ts:16`) is inside the collapsed, below-fold Test source card. **Fix:** point the summary button at the failing frame when `testSourceFrames` has one; keep the spec as secondary.

### F19. Duplicate evidence: ARIA snapshot vs DOM snapshot

When the trace has no DOM (the `aria-fallback` path), the DOM card renders the ARIA snapshot as styled HTML — the same six nodes as the ARIA card above it — while its *collapsed* peek claims "Failure-time HTML extracted from the trace" (the honest "(aria-fallback)" subtitle only shows when expanded; the help copy repeats the false claim). The API already returns `availableSources` for a toggle the UI never built. **Fix:** one "Page at failure" card with an ARIA/DOM source toggle; peek reflects `snapshotName`.

### F20. Back never returns to the previous tab

Tab changes use `router.replace` only (`[id].vue:177-184`), so visiting four tabs leaves one history entry — Back ejects the user from the page (for notification arrivals, out of the app). There is also no inbound `route.query.tab` watcher. **Fix:** `replace` for the initial default, `push` for user switches, plus an inbound watcher through `normalizeTab`.

### Smaller polish (P3)

- Performance tiles: "DOM Interactive"/"Load Complete" break sentence case; two hints repeat their own label ("DOMContentLoaded" hint: "DOMContentLoaded"); two opposite acronym conventions in one grid (`[id].vue:902-1009`).
- `MetaStripGroup` labels ("Source", "CI & environment"…) never reach AT (`:title` on a div — the docblock claims otherwise), so the strip linearizes as "Alice Chen feat: add new payment provider integration development GitHub Actions ·".
- Network rows: `button "GET 200 /api/cart json 59ms 59ms"` (server vs total duration indistinguishable); rows without detail are marked `disabled` (announced unavailable, skipped by keyboard); resource-type token hidden on mobile.
- Visual diff prints "6.85%" twice (peek + badge); ARIA card's peek is a definition, not data ("6 nodes · Pay now [disabled]" would answer "worth opening?").
- "6 occurrences" — of what, over what window? No help topic; unlabelled beside "New/resolved/unknown".

---

## Quick wins (each ≤ ~5 lines, no design work)

| # | Change | Where |
|---|---|---|
| 1 | `transform: r => r.items` on the traces fetch — restores traces everywhere | `[id].vue:36` |
| 2 | Pass `:title` to `UDashboardNavbar` — fills the empty h1 | `[id].vue:468` |
| 3 | `truncate min-w-0` on breadcrumb leaf + `shrink-0` right group | `BreadcrumbNav.vue:29` |
| 4 | Move the AI disclaimer inside the configured branch | `TestCaseAiCard.vue:155` |
| 5 | `aria-label` + `aria-current` on the 20 recent-run dots | `TestCaseVerdictCard.vue:157` |
| 6 | `aria-label`s: Copy failure, DOM copy, mobile tab USelect | `[id].vue:557`, `DomSnapshotCard.vue:74`, `DetailPageLayout.vue:54` |
| 7 | Wire `help="case.diagnosis-tab"` (+ steps/artifacts) onto the tabs | `DetailPageLayout.vue` |
| 8 | `formatStatusLabel` in the History status cell | `[id].vue:1088` |
| 9 | Third steps glyph for `didnotrun`; no "Step passed" on non-passed executions | `[id].vue:723-735` |
| 10 | Gate didnotrun summary tiles; `max > 0` guard in `slowestStepIndex` | `TestCaseSummary.vue:153`, `[id].vue:233` |
| 11 | "Copy retry command" + clipboard icon + outline variant | `[id].vue:312-317` |
| 12 | `role="group" aria-label` on `MetaStripGroup` | `MetaStripGroup.vue:18` |
| 13 | "execution in run #5" / "Recent executions of this test" | `TestCaseVerdictCard.vue:140,154` |
| 14 | "Cluster: resolved" prefix; hide `unknown` type badge | `FailureClusterCard.vue:48-70` |

## What already works — don't lose it

- **0-click error on landing.** The failing frame is readable without any interaction; diagnosis-first is the right default.
- **The folded peek lines are model microcopy** ("1 change: Environment label", "6.85% of pixels changed vs last pass", "2 localStorage · 1 sessionStorage · 2 cookies") — the collapsed funnel stays scannable because of them.
- **Deep-link durability**: `normalizeTab` heals legacy `?tab=error`/`?tab=traces` links and re-normalizes when a live run changes the tab set — shared URLs never land on a blank panel.
- **`aria-expanded` on fold headers is correctly implemented** (an early hypothesis to the contrary was refuted in code), and Console/Network being force-open puts the smoking gun (28.4s `/api/checkout/quote` + the console warning) on screen with zero clicks.
- The did-not-run *cause* is explained above the tabs; the verdict sentence is anchored to the viewed execution (not the newest) with a link to the last green run; `NavbarActions`/`BreadcrumbNav` handle responsive collapse with stable names.

## Suggested sequencing

1. **Now:** the quick-wins table (half of the audit's pain for ~50 changed lines), led by the traces bug.
2. **Next:** status-driven tabs (F5) + the section chip row from `sectionToAction` (F6) — these two remove the "lost" feeling structurally.
3. **Then:** baseline unification (F7), rail behavior below `xl` (F8), tabpanel/landmark semantics (F10), terminology pass (F11–F13).

## Appendix — regenerating the evidence

Seed + run: `npm run app:seed:demo && mkdir -p .data && npm run db:migrate && npm run app:seed:dev`, then `NUXT_IGNORE_LOCK=1 npx nuxt dev --port 3002`. Capture `page.locator('body').ariaSnapshot()` for: `/test-run-cases/37` (`?tab=diagnosis|steps|performance|history`, plus 375×812), `/test-run-cases/809` (`?tab=artifacts`), `/test-run-cases/768`, `/test-run-cases/748`. Execution ids are stable in the deterministic demo seed: #37 failed-rich, #809 passed, #768 passed-on-retry, #748 didnotrun.
