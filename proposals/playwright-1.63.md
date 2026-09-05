# Playwright 1.63 — what it brings to Piwi

**Status:** projection, no code changes · **Scope:** the features of [Playwright 1.63.0](https://github.com/microsoft/playwright/releases/tag/v1.63.0) (released 2026-09-04) that change what the reporter can capture and what the dashboard can show — test locks, step subtitles and params, aria and screen snapshots in traces, the locator API additions and the smaller runner changes · **Date:** 2026-09-05

This is a projection, not an implementation plan: it says what is worth taking, why, roughly where it lands in the rebuilt screens ([`ui-simplification.md`](ui-simplification.md)) and in what order, so the work can be cut into sessions once the features in flight on other branches have landed. Every claim about Playwright was checked against the published 1.63.0 packages (Appendix A) and every "today" claim against the code on `main` (Appendix B). Nothing here restarts the audit's open big bets (**D**, **J**, **K**, **M** in [`failure-experience-audit.md`](failure-experience-audit.md)); where 1.63 makes one of them cheaper, it says so.

---

## 0. The four things that matter

1. **One of the 1.63 changes is a regression for Piwi as it stands, not a feature.** Playwright moved the target of every API step out of the step *title* and into a new *subtitle* field: on 1.61 a step is titled `Click getByRole('button', { name: 'Pay' })`, on 1.63 it is titled `Click` with the subtitle `getByRole('button', { name: 'Pay' })`, and `Navigate to "https://…"` became `Navigate` with the URL as its subtitle. The reporter keeps `title` only, so on a project that upgrades, the step table, the failure timeline, the live step on the run page and the AI context all degrade to `Click · Click · Click`, and the step categorizer stops recognizing navigations. Reading `subtitle` is the first thing to ship, before any of the new features.
2. **Step params turn the failing step into structured data.** Playwright now hands reporters a curated `params` object per step — the rendered locator whenever the call has one, plus the method's own arguments (URL, value, button…), strings capped at 200 characters. Piwi derives the failing locator by parsing the error text today; params give it a second, exact source, and give `test.step` authors a way to attach data (`{ user: 'admin' }`) that shows up in the step table and the AI context.
3. **Locks are visible only from inside the run, and Piwi can show what Playwright never will.** A test declares `{ lock: 'database' }` and the dispatcher never runs two holders at once. The lock names reach the reporter only through a private field (`TestCase._locks`), never through the public API, the blob report or `merge-reports`. Read defensively, they make three things possible that no Playwright surface offers: lock lanes on the workers timeline, a *the previous holder of this lock failed* clue, and a check that locks were actually honored across shards — they are not, since shards are separate processes.
4. **Traces can now carry an aria snapshot and a screenshot around every action.** `trace: { snapshots: { dom, aria, screen } }` writes `aria/<callId>-<phase>.json` (the JSON aria tree with bounding boxes) and `screenshots/<callId>-<phase>.png` per action. Piwi already parses traces for evidence; these two event kinds give it per-step page structure and a filmstrip without the capture fixtures, and make the audit's **J** (structural page diff) and the shipped **E** (attempt diff) cheaper and more precise.

---

## 1. Feature by feature

| 1.63 feature | Piwi today | What changes | Size |
|---|---|---|---|
| Step `subtitle` (API steps: locator or URL; a `test.step` option) | `FlatStep { title, duration, category, error?, failed?, location?, startTime? }`; every consumer reads `title` | Capture `subtitle`; one shared label helper; fix the categorizer | Small, **first** |
| Step `params` (curated, 200-char strings) | The failing locator is parsed from the error text; `test.step` carries nothing but its title | Capture and cap `params`; show them; feed the headline, the clues, the AI context and the attempt diff | Small to medium |
| Test locks (`lock` on `test` / `test.describe`) | No notion of a shared resource; serial mode is the only scheduling fact stored | Capture `_locks`; store like tags; timeline lanes, chips, filters, a clue, a cross-shard check, lock-aware sharding | Medium |
| Trace `snapshots: { aria, screen }` | `wrapConfig` defaults `trace: 'retain-on-failure'`; the parser reads `before` / `after` / `frame-snapshot` / `console` / `resource-snapshot` | Default `aria` on; parse the two new events; per-step page structure, a filmstrip, a page diff | Medium |
| `locator.visible()`, `frameLocator()` without a selector | Healing never suggests narrowing; frame locators are unwrapped | Pass the new methods through the capture proxy; suggest `.visible()` on strict-mode violations with one visible match | Small |
| `page.ariaSnapshotJSON()` / `locator.ariaSnapshotJSON()` | The fixtures capture the YAML snapshot; healing parses YAML lines for names | Capture the JSON form when available; healing and the page diff work on nodes | Small to medium |
| `dialogclosed` events | Dialogs are not captured | A dialog lane on the failure timeline and a clue | Small |
| `testOptions.contrast` (with `reducedMotion` and `forcedColors` now standalone options) | `getBrowserConfig` reads `reducedMotion` and `forcedColors`, not `contrast` | One field in the browser config and the environment diff | Trivial |
| `--add-reporter` | The docs and `init` edit the config; `piwi run` relies on the config | A no-edit trial path; the desktop shell and `piwi run` can add the reporter themselves | Small |
| `perfetto` reporter | — | Export a run or an execution in Trace Event Format | Small, later |
| `install --no-remove` | — | A note for **M**'s per-commit browser installs | Trivial |
| HTML report step waterfall | `TestStepsTable` already draws a waterfall from `startTime` | Nothing — parity holds; subtitles keep it ahead | — |
| `omitTags`, `httpCredentials` arrays, `opfs`, typed `apiRequestContext.get`, `codegen --http-credentials`, component testing retired, Ubuntu 20.04 dropped | — | Nothing to do (§7) | — |

---

## 2. Step subtitles and params

### 2.1 What Playwright does now

- `test.step(title, body, { subtitle, params })` — both optional; reporters read `step.subtitle` and `step.params` (`types/testReporter.d.ts`).
- For `pw:api` and `expect` steps Playwright fills both itself, and the per-method title format dropped the target: `Frame.click` is `{ title: "Click", subtitle: "{selector}", renderParams: ["button", "clickCount", "modifiers", "position"] }`, `Frame.goto` is `{ title: "Navigate", subtitle: "{url}" }`, `Frame.fill` is `{ title: 'Fill "{value}"', subtitle: "{selector}" }`, `Frame.expect` is `{ title: 'Expect "{expression}"', subtitle: "{selector}" }`. On 1.61 the runner appended the rendered locator to the title (`renderTitle` = the format plus `asLocatorDescription(selector)`); on 1.63 it does not.
- `params` is curated by `renderParamsForCall`: `locator` (the selector rendered as `getByRole('button', { name: 'Pay' })` in the config's language) when the call has one, then each `renderParams` entry; strings longer than 200 characters are truncated with an ellipsis; page content, expressions and request bodies are never included. `test.step` params are passed through as given.
- The tele protocol serializes `subtitle` and `params` on `onStepBegin` (`_serializeStepStart`), so blob reports (still version 2) and `merge-reports` carry them.

### 2.2 What breaks on 1.63 without a change

Once a project runs 1.63 with today's reporter:

- Every API step reads as its bare verb in `TestStepsTable.vue`, in the failure timeline (`shared/failure-timeline.ts` builds its labels from `step.title`), in the live step under a running test (`TestRowLiveStep.vue`, fed by the `step-begin` stream event) and in the AI context's step sections (`ai-context.ts`, `failingStepsSection` and `steps`). The docs promise `t+0 · click getByRole('button', { name: 'Pay' }) failed`; the page would show `t+0 · Click failed`.
- `categorizeStep` (`packages/core/src/step-analysis.ts`) matches `navigate to`; the new title is `Navigate`, so navigations fall to `other` and `navigationCount` / `navigationTotalDuration` in `collectStepMetrics` read zero. `Click`, `Fill "…"` and the `expect` category still match.
- The attempt diff (**E**) aligns steps by title; on 1.63 every click has the same title, so the alignment degrades to position.

### 2.3 What Piwi does with them

- **Capture.** `FlatStep` gains `subtitle?: string` and `params?: Record<string, string | number | boolean>` (Playwright already truncates strings; Piwi caps the keys at ~20 and the values at 200 characters, and runs the values through the token-shaped-string masking the trace views use, since `test.step` params are user data). `TestStepEvent` and `StepBeginStreamEvent` gain `subtitle`. Both live in the existing `steps` JSON column — no migration; the ingest limits get a per-step params cap. `blob-report.ts` reads them from the blob events; `trace-import.ts` can render a subtitle from the trace's `params.selector` with the locator formatter that already prints the failing locator as `getByRole('row')`.
- **One label helper.** `stepLabel(step)` = `title` + `subtitle` when the subtitle is present, else `title` — the one place where the 1.61 / 1.63 difference disappears. Every consumer above uses it; the categorizer gains `navigate` as a prefix and prefers `params.locator` / `params.url` over title parsing when they exist.
- **Display.** The step table (Timeline tab › *Whole test*) prints the title and a muted subtitle on the same row, with a disclosure for the params (a two-column key/value list); the failure timeline's step labels and its *grouped under* label use the subtitle; the live row shows `Click · getByRole(…)`.
- **Analysis.** The failing step's `params.locator` becomes the second source for the headline's locator (`error-parse.ts` reads the error text only) and the first source when the error carries none (custom `expect.extend` matchers, `test.step` failures). The last navigation's `params.url` feeds the *the page ended on `/login`* clue directly. `test.step` params appear as a *Parameters* line in the AI context and in `get_test_run_case` / `get_test_case_context` over MCP.

### 2.4 Caveats

- The `Navigate` subtitle is Playwright's rendered form of the URL, not necessarily the full URL; the full one is in `params.url`.
- Secrets: `test.step(…, { params: { password } })` is the author's choice, but the reporter is where it would leak into the dashboard — mask, cap, and document it in `reporter.md` next to the console and network caps.

---

## 3. Test locks

### 3.1 What Playwright does

- Declared on a test (`{ lock: 'user-settings' }` or `{ lock: ['database', 'external-api'] }`) or on a `test.describe` (inherited by every test inside; `TestCase._locks` already contains the suite's locks when the file is collected).
- The dispatcher (`_findFirstJobToRun`) skips any job whose locks are currently held and runs the next runnable one. A *job* is what one worker runs in one go: the whole file in default and serial mode, one test in fully-parallel mode. A job's lock set is the union of its tests' locks, so in a non-parallel file a lock declared on one test is held for the entire file.
- Locks are acquired before the test starts and released after it ends; the wait is never charged to the test timeout. It shows up as holders of the same lock being pushed later in the run and, at the tail of a run, as workers idling while the last holders run one at a time.
- Scope: one `npx playwright test` process. The held-lock set lives in that process's dispatcher; `--shard` runs are separate processes with no coordination, so two shards can hold the same lock at the same time.

### 3.2 How the reporter gets them

Not through the public API: `TestCase` in `types/testReporter.d.ts` has no lock property, the tele protocol's `_serializeTest` carries `testId, title, location, retries, tags, repeatEachIndex, annotations` and nothing else, and the perfetto reporter's documented slice arguments list tags and annotations but not locks. The only source is the private `TestCase._locks: string[]`, populated in the runner process for in-process reporters (`test._locks = data.locks` when the loaded suite is parsed).

So: read `(test as any)._locks`, keep it only when it is an array of strings, treat anything else as *no locks*; say in the docs that blob-imported and merged runs carry none; and ask upstream for a public `testCase.locks` — the same request the `parallelMode` read in `metadata-collector.ts` (`(s as any)._parallelMode`) would benefit from.

### 3.3 Where they show

- **Run › Timeline tab** (`WorkersTimeline.vue`, `useTimelineModel.ts`). A *Show locks* toggle beside *Show hooks and waits*. Each lock is a thin lane above the worker lanes; a held interval is the union of the consecutive bars in one worker lane whose executions carry the lock (that is the job), colored per lock; hovering a test bar lists its locks. `RunTimelineExtras.vue` gains a *Locks* table under *Slowest tests*: per lock, its tests, the held time, its share of the run's wall time, and the estimated serialization (a holder that starts within a few hundred milliseconds of the previous holder's end was waiting; the sum of those gaps is the lock's cost — a heuristic, labeled as one). A lock on the critical path at the run's tail is the performance hint worth printing: *`database` was held back-to-back for 4.2 of the last 6 minutes; 3 workers idle.*
- **Executions and tests.** Locks follow the tag treatment from the UI rules (badges are for exceptions): in the `DetailHeader` facts line and the Details popover on the execution page, in the `BadgeGroup` overflow and hover details of every `TestRow`, as a filter in the run's Tests tab and the project's Tests tab, and as a fourth *Group by* option (*Cluster / File / Lock / None*) where it explains a slow run. Denormalized onto `test_cases` like `tags`, so the project catalog answers *which tests touch `database`* and the test history page shows the lock chips.
- **Clues** (the rules list in `evidence.md`). *The previous holder of lock `X` in this run failed / timed out* — the named-resource version of the existing same-worker pollution rule, and stronger, because the resource is named. *Lock `X` was held on shards 1 and 3 at the same time* — computed from the overlap of `[startedAt, startedAt + duration]` across executions with different `shardIndex` values carrying the same lock; Playwright cannot see this, and it is exactly the flaky *works on one machine* story.
- **Selections and sharding.** `piwi run --shard i/n` balances shards by duration (`cli/select.ts`); making it lock-aware — every test sharing a lock lands in one shard — restores the guarantee Playwright loses across shards. `analyze_selections`, `suggest_selections` and the PR feedback line can say when a selection splits a lock.
- **Wire, storage, mirrors.** `WireTestCase.locks?: string[]`; `test_runs_cases.locks` (JSON, capped at ~20 names × 100 chars) and `test_cases.locks`; `persist-run-cases.ts`, the demo ingest mirror (`app/demo/api/reporter.ts`) and the simulator (two locks across a handful of seeded tests, so the timeline overlay has something to draw); the MCP tools that return executions and tests; `importing-runs.md` says that blob imports carry no locks.

---

## 4. Aria and screen snapshots in traces

### 4.1 What Playwright does

`trace.snapshots` accepts `{ dom, aria, screen }`. A boolean `snapshots: true` still means `{ dom: true }` only, so the new kinds are opt-in even at `trace: 'on'`. With `aria: true` the recorder writes `aria/<callId>-<phase>.json` — `ariaSnapshotJSONForFrame(page.mainFrame(), { mode: 'default', boxes: true })`, the JSON aria tree with bounding boxes — and appends `{ type: 'aria-snapshot', callId, phase, pageId, timestamp, file }`; with `screen: true` it writes `screenshots/<callId>-<phase>.png` (PNG, CSS scale) and appends `{ type: 'screenshot', callId, phase, pageId, timestamp, file }`. Both key on the action's `callId`, the same id the `before` / `after` events carry, so each snapshot belongs to a step. The trace viewer's *Display Aria* mode reads them.

### 4.2 What Piwi does with them

- **`wrapConfig` defaults.** `defaultCapture` sets `trace: 'retain-on-failure'` today; the object form `{ mode: 'retain-on-failure', snapshots: { dom: true, aria: true } }` adds the aria tree at negligible size. `screen` stays off by default: a PNG per action per phase is the trace's biggest cost, and the storage doc should say what it adds. The object form must be gated on the installed Playwright being 1.63 or later (`require('@playwright/test/package.json').version` at config time): 1.61's protocol validator declares `snapshots: tOptional(tBoolean)` and rejects an object, so on an older Playwright `wrapConfig` keeps the plain `'retain-on-failure'` string.
- **Parser.** `trace-events.ts` learns the two event kinds (per action: a before / after aria file, a before / after screenshot file); `trace-fallback-evidence.ts` takes the failing action's *before* aria snapshot as the ARIA evidence when no `error-context` attachment exists (the JSON renders through the existing aria renderer in `dom-snapshot-aria.ts`).
- **Timeline tab.** A filmstrip row when screen snapshots exist — the *before* frame of each step, the failing step's frame marked; the Screen tab shows *before the failing action* next to the failure screenshot. Per-step page structure becomes a hover on the step row.
- **Page diff (the slot reserved for J).** The audit's **J** needs an aria snapshot on green to diff against; the trace gives a cheaper first cut with no green baseline: the tree *before the failing action* against the tree *at the failure*, which is exactly the modal that stayed open or the table that emptied during the test. With `on-first-retry` (or `on` plus retries) the passing attempt's trace supplies the green side, and **E**'s attempt diff can compare page structure, not only network and console. Sampling on green (the audit's version of J) remains the way to diff against the last passing *run*.
- **Healing and clues.** The JSON tree with boxes gives `matchRenamedElement` and the *present but disabled* clue real nodes (role, name, states, box) instead of YAML lines parsed by `extractAccessibleName`; the same applies to `page.ariaSnapshotJSON()` captured by the fixtures on failure (§5).

---

## 5. Locators and the capture fixtures

- **`locator.visible()`.** The capture proxy wraps the builder methods in `packages/core/src/locator-methods.ts` and the chain methods in `LOCATOR_CREATING_CHAINS`; `visible()` must pass through so that `page.locator('button').visible().click()` keeps its locator snapshot and its healing. On the analysis side, a strict-mode violation where the DOM probe or the aria tree shows one visible match among N is the case `.visible()` exists for: healing gains a *narrowing* suggestion (*add `.visible()`*, shown only when `test_runs.playwrightVersion` is 1.63 or later, which is already stored) alongside the replacement locators. The probe in `packages/picker-dom/src/probe.ts` counts matches without visibility, so it needs a box / `offsetParent` check first.
- **`page.frameLocator()` without a selector.** Frame locators are excluded from the capture proxy today (audit §3.2 item 10). The no-selector form is a single, wrappable entry point, and a healing recommendation can now say `page.frameLocator().getByRole(…)` when the element lives in an iframe — whether the failure-time aria snapshot sees into iframes decides how far that goes; note it as a check, not a promise.
- **`ariaSnapshotJSON()`.** `ariaSnapshotBestEffort` in `capture-fixtures.ts` feature-detects `ariaSnapshot`; add the JSON form the same way and attach it beside the YAML (`piwi-aria-snapshot-json`), so the YAML keeps feeding the display and the JSON feeds healing, the page diff and the clues.
- **`dialogclosed`.** The fixtures record `dialog` / `dialogclosed` with type, message and timestamps into a small `piwi-dialogs` attachment; the failure timeline gets a dialog lane and the clue engine a rule: *a dialog was open when the action failed*. No schema beyond one JSON column.
- **`contrast`.** One line in `getBrowserConfig` (`metadata-collector.ts`) next to `reducedMotion` and `forcedColors`; the environment diff picks it up for free.

---

## 6. Runner and CLI changes

- **`--add-reporter`** appends to the configured reporters instead of replacing them. Three uses: a documented no-edit trial (`npx playwright test --add-reporter @piwitests/reporter` with `PIWI_SERVER_URL` / `PIWI_API_KEY` / `PIWI_PROJECT`, since every option has an env var); `piwi run` / `piwi select` adding the reporter when the config has none (`cli/detect.ts` already knows); and the desktop shell's *Run locally* and **M**'s *Reproduce here*, which run whatever the linked folder's config says — with `--add-reporter` they can guarantee that the results reach the local dashboard even when the checkout has no Piwi reporter (the reporter argument can be a path, so the shell can point at its own copy).
- **`perfetto` reporter.** Writes Trace Event Format: a slice per test with hooks, fixtures and steps nested, arguments carrying locations, params, tags, annotations, errors, stdio and attachment paths. Piwi has all of that per run and per execution; an `/api/test-runs/:id/perfetto` export (and one per execution) opens a run in ui.perfetto.dev with no new UI. Import is not worth it — the blob report is richer and already supported.
- **`install --no-remove`** keeps the other browser builds when installing; **M**'s per-commit `npm ci` plus browser install should pass it so a bisect does not reinstall Chromium at every step.
- **HTML report duration waterfall.** Playwright's own report now draws step timing bars. `TestStepsTable.vue` has drawn a true waterfall from `startTime` since the steps carried it; with subtitles and params the table stays ahead. Nothing to do.

---

## 7. Nothing to do

`omitTags` (Piwi's terminal output prints no tags), `httpCredentials` arrays and the `opfs` storage-state option (page state captures key names only, and OPFS is not a key/value store), typed `apiRequestContext.get`, `codegen --http-credentials`, the retired component-testing packages (a non-goal), Ubuntu 20.04 (the reporter runs on the user's runner; the server image ships no browsers), the new browser builds.

---

## 8. Projection

Ordered by value over cost, sized in sessions, and placed against the work in flight. **L** (the UI simplification) is complete on `main`; **D**, **J**, **K** and **M** are open. Nothing below blocks on them, and nothing below should start on the execution page before the sessions that own **J** and **K** have claimed their slots.

**Now — compatibility, one session.**

1. Read `subtitle` and `params` in `flattenSteps`; the `stepLabel` helper; `categorizeStep` on `navigate` and on `params`; the stream event; the blob path; unit tests with 1.63-shaped steps beside the 1.61-shaped ones; the captured-data table in `reporter.md`. This is the item that keeps the step views intact for anyone who upgrades.

**Next — the two features with a visible payoff, one session each.**

2. Steps: subtitle and params in the step table, the failure timeline labels, the live row, the AI context and the MCP tools; `params.locator` into the headline and the URL clue.
3. Locks: reporter (`_locks`), wire, columns, ingest cap, demo mirror and simulator; lock chips, filter and grouping; the timeline lanes and the *Locks* table; the two clues; docs (`reporter.md`, `ui-overview.md`, `evidence.md`, `importing-runs.md`).

**Then — traces, one session, and the small ones folded into whichever session touches the file.**

4. `snapshots: { aria: true }` in `defaultCapture`; the two trace events in the parser; the fallback ARIA from the failing action; the *before the failing action* screenshot on the Screen tab and the filmstrip on the Timeline tab when `screen` is on; the in-execution page diff in J's slot, coordinated with whoever takes J.
5. `.visible()` and `frameLocator()` through the proxy; the narrowing suggestion; `ariaSnapshotJSON()` beside the YAML; `dialogclosed`; `contrast`.
6. Lock-aware `--shard` and the split-lock warning in selections; `--add-reporter` in the docs, `piwi run` and the desktop shell (with **M**); `--no-remove` in **M**.

**Later.** The perfetto export; the upstream request for public `locks` (and `parallelMode`).

---

## 9. Compatibility and rollout

- The peer range `^1.61.1` already admits 1.63; nothing here needs a floor bump. Every read is feature-detected (`'subtitle' in step`, `Array.isArray(test._locks)`, trace events by `type`), as `ariaSnapshotBestEffort` does today, and the one write that an older Playwright would reject — the `snapshots` object in `wrapConfig` — is gated on the installed version, so a 1.61 project loses nothing and a 1.63 project gains without configuration.
- Bump the workspace's own `@playwright/test` to 1.63 in the same change as item 1, so the reporter's tests and the dashboard's E2E run on the new shapes (a second CI leg on the previous minor is cheap insurance). The bundled trace viewer (`nuxt.config.ts` serves `playwright-core/lib/vite/traceViewer`) picks up *Display Aria* with the bump.
- The trace parser does not gate on the trace version and ignores unknown event types, so 1.63 traces already parse; the blob report version is still 2, so imports keep working and gain subtitles and params for free.
- The demo mirror and the seed move with every wire change (`wire-shared-drift.test.ts`, `app:seed:demo`); the docs screenshots that show the step table and the timeline (`app:screens:docs`) regenerate with items 2–4.

---

## 10. Open questions

- Store `subtitle` separately (recommended: it is what Playwright gives, and the helper composes) or fold it into `title` at the reporter (one line, but it freezes the 1.61 shape and makes the params / label split awkward later)?
- Should `screen: true` be a `defaultCapture` level (`'full'`) or a documented opt-in only? Per-action PNGs are the one thing here that changes storage bills.
- Locks on the workers timeline: lanes above the workers, or a colored bracket on the bars themselves? Lanes scale with the number of locks; brackets add no height. Decide with a screenshot of the seeded run.
- Is the private `_locks` read acceptable as a supported feature, or does it ship as *best effort* until upstream exposes it? (Recommendation: best effort, said so in `reporter.md`, as the `parallelMode` read already is.)

---

## Appendix A — Facts checked in the 1.63.0 packages

`playwright@1.63.0`, `@playwright/test@1.63.0` and `playwright-core@1.63.0` from npm, compared with the installed 1.61.1 where it matters.

| Fact | Where |
|---|---|
| `lock?: string \| string[]` on test and describe details; no lock property on the reporter's `TestCase` | `playwright/types/test.d.ts:2727`, `types/testReporter.d.ts` |
| `TestCase._locks` and `Suite._locks` are private arrays; the suite's locks are pushed into each test; `test._locks = data.locks` on parse | `playwright/lib/common/index.js` |
| The dispatcher skips a job whose locks are held (`_findFirstJobToRun`, `heldLocks`); a job's locks are the union of its tests' | `playwright/lib/runner/index.js:5539-5555` |
| Tele `_serializeTest` carries no locks; `_serializeStepStart` carries `subtitle` and `params`; the blob report version is still 2 | `playwright/lib/runner/index.js:2983-2993, 3038-3045, 3086` |
| API steps: `title: renderTitle(…)`, `subtitle: renderSubtitle(…)`, `params: renderParamsForCall(…)`; 1.61 appended the locator to the title instead | `playwright/lib/index.js:98-107, 795-801` vs the installed `1.61.1/lib/index.js:764-770` |
| Method formats: `Frame.click` `{ title: "Click", subtitle: "{selector}" }`, `Frame.goto` `{ title: "Navigate", subtitle: "{url}" }`; 1.61 had `'Navigate to "{url}"'` | `playwright-core/lib/coreBundle.js:4131-4172` vs the installed `:4033-4074` |
| `renderParamsForCall` (locator first, then `renderParams`), `kMaxParamLength = 200` | `playwright-core/lib/coreBundle.js:4422-4471` |
| `expect` steps carry `{ subtitle: locator, params: { locator } }` | `playwright/lib/matchers/expect.js` |
| `snapshots: true` normalizes to `{ dom: true }`; `snapshotAria` / `snapshotScreen` flags | `playwright-core/lib/coreBundle.js:58945-58952` |
| The `tracingStart` protocol takes `snapshotDom` / `snapshotAria` / `snapshotScreen` booleans in 1.63; 1.61 takes `snapshots: tOptional(tBoolean)` and rejects an object | `playwright-core/lib/coreBundle.js:18682-18688` vs the installed `:17950-17955` |
| The recorder writes `aria/<callId>-<phase>.json` (`ariaSnapshotJSONForFrame`, `boxes: true`) and `screenshots/<callId>-<phase>.png`, with `aria-snapshot` and `screenshot` trace events keyed by `callId` and `phase` | `playwright-core/lib/coreBundle.js:25904-25921` |
| `--add-reporter` keeps the configured reporters; the `perfetto` reporter writes `test-results/perfetto.json` | The Playwright CLI and reporters docs |

## Appendix B — Where each item lands today

Paths are relative to `apps/application/` unless they start with `packages/`.

| Area | Files |
|---|---|
| Step capture and shape | `packages/core/src/step-analysis.ts` (`FlatStep`, `flattenSteps`, `categorizeStep`, `collectStepMetrics`), `packages/reporter/src/public/reporter.ts:260-317, 379-385`, `packages/core/src/wire.ts:91-99, 142-164` |
| Step storage and caps | `server/database/schema.sqlite.ts:429-433`, `server/utils/persist-run-cases.ts:402-403`, `shared/ingest-limits.ts:40-41`, `server/utils/blob-report.ts:405-408`, `server/utils/trace-import.ts:145-155` |
| Step display | `app/components/test-case/TestStepsTable.vue`, `app/components/test-case/EvidenceTabs.vue:280-292`, `app/components/test-case/FailureTimelineCard.vue`, `shared/failure-timeline.ts:312-358`, `app/components/run/TestRowLiveStep.vue` |
| Step analysis | `server/utils/ai-context.ts:464-473`, `packages/core/src/error-parse.ts`, the clue rules behind `evidence.md` |
| Test metadata capture | `packages/reporter/src/public/reporter.ts:326-366`, `packages/reporter/src/internal/collect/metadata-collector.ts:129-200` |
| Execution columns and mirrors | `server/database/schema.sqlite.ts:410-488` (`tags` at 451, `workerIndex` at 453, `shardIndex` at 454), `test_cases.tags` at 122, `app/demo/api/reporter.ts:386-410, 615-682`, `app/demo/simulator.ts:607-633, 1117-1240` |
| Workers timeline | `app/components/run/WorkersTimeline.vue`, `app/components/run/timeline/*`, `app/components/run/RunTimelineExtras.vue`, `app/composables/useTimelineModel.ts`, `app/composables/useTimelineViewport.ts`, `app/utils/timeline.ts`, `tests/unit/timeline-model.test.ts` |
| Rows, headers, badges | `DetailHeader`, `TestRow` + `TestRowGroup`, `BadgeGroup` (`ui-simplification.md` §10) |
| Trace parsing | `server/utils/trace-events.ts:205-360`, `server/utils/trace-fallback-evidence.ts`, `server/utils/trace-evidence.ts`, `server/utils/dom-snapshot-aria.ts` |
| `wrapConfig` defaults | `packages/reporter/src/public/config-wrapper.ts:61-63, 109-121`, `packages/reporter/src/public/options.ts:81-92` |
| Capture fixtures | `packages/reporter/src/internal/capture/capture-fixtures.ts:635-667` (aria), `:946-957` (console), `:993-1014` (network), `packages/reporter/src/internal/capture/attachments.ts:8-28` |
| Locator proxy and healing | `packages/core/src/locator-methods.ts`, `packages/reporter/src/internal/capture/locator-healing.ts:99-181`, `packages/core/src/locator-generation.ts`, `shared/locator-healing.ts`, `server/utils/locator-healing.ts`, `packages/picker-dom/src/probe.ts` |
| Selections and sharding | `packages/reporter/src/cli/select.ts` |
| Docs | `apps/docs/reporter.md`, `capture-fixtures.md`, `evidence.md`, `ui-overview.md`, `importing-runs.md`, `storage.md` |
