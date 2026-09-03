---
title: Failure evidence
lang: en-US
---

# Failure evidence

When a test fails, everything Piwi captured about that attempt lands on one screen. This page describes
that screen — what each block holds, where the data came from, and how much more you get once a trace
is attached.

Two different pages are involved, and [Core concepts](./concepts#execution) draws the line between them:

| Page | Path | Answers |
|---|---|---|
| **Execution** | `/test-run-cases/:id` | "why did this attempt fail?" — [the diagnosis view](#one-execution-diagnosis-first) |
| **Test case** | `/test-cases/:id` | "how has this test behaved over time?" — [its history](#the-test-case-page) |

Most links from a run land on an execution; the test's title links to the test case above it.

## One execution, diagnosis-first

Everything about a single test execution, laid out **diagnosis-first**. A pinned **summary** carries the status, title, copyable location, duration, worker, retries and duration-vs-average, plus at-a-glance **signal badges** (new regression, new flaky, passed-on-retry), any test annotations (`@fixme`, `@slow`, …), the **wasted time** spent in fixed waits, and metadata cards (environment, CI, branch, commit, author, browser, storage). Traces stream in live while the parent run is still running.

<figure>
  <img src="/screenshots/gather-evidence.png" alt="A failing execution's Diagnosis tab: the pinned summary, the error and call log, the test source and failure evidence open, and the remaining evidence sections folded (alternative locators, environment diff, visual diff, console, network)">
  <figcaption>A failing execution, diagnosis-first — the summary with its wasted-time readout, the error, the test source and screenshots open, and the rest of the captured evidence folded into one screen.</figcaption>
</figure>

The tabs adapt to the result.

**A failing execution opens on the Diagnosis tab** — the whole investigation on one screen, modeled on the [failure cluster](./ui-overview#failure-cluster-detail) page you already know. It leads with the **headline**, then the raw **error** (copyable), then splits into a right-hand rail and a left-hand evidence funnel:

- **Headline** — what broke, in one sentence built from the Playwright error itself, before you read a line of it: `getByRole('button', { name: 'Pay' }) never became enabled — click timed out after 30 s`, `Expected 26 rows, found 51 — getByRole('row') toHaveCount`, `Text "Invite sent" never became visible (30 s)`, `Navigation to /users timed out after 30 s`, `getByRole('button') matched 3 buttons — strict mode`, `Test timed out after 30 s while "fillPaymentDetails(page)"`. The parser reads the action or matcher, the locator, the expected and received values, the timeout and the last state Playwright's call log reported (not found, hidden, not enabled, covered by another element, N elements, navigating); a shape it does not know falls back to the error's first line. Under it, one row of facts: **why** (new regression, passed on retry, new flaky, infrastructure), **since when** (the first run the cluster failed in, the commit and author the run reported), how many **other tests in this run** share the cause, and the **owner** (`piwi:owner` annotation first, then CODEOWNERS when an SCM token is configured). The same headline names every failing row on the run page, leads the [alerts](./notifications) and the [pull-request comment](./ci#pull-request-feedback), reaches AI agents through the MCP tools, and is what the [reporter prints](./reporter#how-it-works) next to each failing test in the terminal — the raw error is never rewritten, only preceded.

- **Clues** — the strongest [deterministic clue](#clues) in one line right on the headline (*"GET /api/quote returned 504, 1.1 s before the failure"*), with a **Clues** card below listing every clue, each with a strength chip, its `t-N s` before the failure, and citation chips that jump to the evidence it came from.
- **Failure timeline** — one time axis, directly below the error, that places the **steps**, **console** entries, **network** requests and their **backend logs** on the same clock and marks the **moment of failure**, so "console (1) / network (3)" become *what the app was doing when the test gave up*. Below the axis, the same items read as one chronological list — `t-1.1s · GET /api/quote → 504 (1500 ms)`, `t+0 · click getByRole('button', { name: 'Pay' }) failed` — and a click on any line jumps to that step, console entry or request. Actions are grouped by the method (or `test.step`) they were called from — `↳ in CheckoutPage.pay() · pages/checkout.ts:42 ← checkout.spec.ts:23`, each file:line opening in your editor — so a failure inside a page object reads as one call, not a loose run of clicks; the method name needs an uploaded trace, while the file and line come from the reporter. Two views: **Around the failure** (the default — the failed step plus the 10 s before and 2 s after) and **Whole test**. Times are shown relative to the failure (`t+0`). When a run's reporter recorded no step start times, positions are derived from step durations and the card says so. **Web Vitals and screenshots are not placed yet** — Web Vitals are relative to navigation start with no stored absolute origin, and screenshots carry no capture time; they are listed as not-yet-placed rather than guessed at. With a trace, the card links out to the [trace viewer](#trace-viewer). The card is hidden when fewer than two items can be placed.
- **Regression status** — how many consecutive runs the test has been failing and when it last passed, with a clickable recent-runs strip to jump between executions.
- **Failure cluster** *(when the failure is clustered)* — signature, error type, how many tests it hit, the cluster's own AI verdict, and a hand-off to the full cross-test investigation.
- **AI diagnosis** — diagnose *this execution* with one click, or **Copy AI context** to paste the full evidence bundle into your own assistant (works even with no provider configured). Cited evidence links jump to the matching section on the page.
- **Evidence funnel** — every section is a card that folds to a one-line peek and remembers your choice; the test source and the failure evidence open expanded so the failing line and the screenshot are on the first screen, the rest starts folded. It runs from the **test source** as a call stack (the line that actually threw plus the callers above it, so a failure inside a helper is visible, not just the test line that invoked it — and, [with a trace](#trace-powered-deep-views), the complete stack with real source), grouped **failure evidence** (screenshots, video, traces, attachments), [alternative locators](./reporter#locator-healing) for a broken locator, an **environment diff** and **visual diff** against the last green run, **console** output, **network requests** with inline [backend logs](./backend-logs) and a [Full trace](#trace-powered-deep-views) network view, **app state**, the failure-time **ARIA snapshot**, and the reconstructed **DOM snapshot**.

### Clues

A **clue** is a deterministic, rule-based finding correlated from the evidence already captured — no model runs. A small library of rules looks at the parsed error, the timeline, the network requests, the ARIA snapshot, the locator-healing result, the app state, the environment diff, the run's sibling and same-worker executions, and the cluster's fix history, and each rule that fires emits a ranked, cited one-line clue. Every clue carries a **strength** (strong / medium / weak) and a **citation** to the evidence section it came from — the same section ids the AI diagnosis cites — so a click jumps straight to the proof, and the same clues are handed to the AI diagnosis as evidence to confirm or refute (and used to prioritize the [auto-diagnose budget](./ai-diagnosis#enabling-ai-diagnosis)). The rules:

- **Failed request before the failure** *(strong)* — a request returned 5xx or was aborted within the lead window before the moment of failure.
- **Slow request overlapping the failure** *(medium)* — a request slower than the slow-request threshold was still in flight during the failed step.
- **Console mentions the target** *(strong for an error, medium for a warning)* — a console entry in the failure window names the failing locator or the failing route.
- **Backend error attached** *(strong)* — a request in the window carries an error-level [backend log](./backend-logs).
- **Element renamed** *(strong)* — locator healing found the element under a new identity, or flagged the stored name as stale while still recommending a fix.
- **Element present but blocked** *(strong)* — the call log says the element resolved but was disabled, hidden, not visible or covered, and the ARIA snapshot still shows one with its role and name.
- **Wrong page** *(strong)* — the page ended on a login, auth, error or 404 route, or somewhere other than the last navigation the test asked for.
- **Worker pollution** *(medium)* — the previous test on this worker failed or timed out, so shared state it left behind is a candidate cause.
- **Timeout budget** *(medium)* — the failed step used ≥ 80 % of the test timeout, or the execution used ≥ 95 % of it.
- **Environment changed** *(medium, weak when only the environment label differs)* — the same-environment [environment diff](#one-execution-diagnosis-first) is non-empty.
- **Browser-specific** *(medium)* — the same test passed on at least one other browser in this run.
- **Fixed before** *(weak)* — this cluster recorded a fix that has since regressed.

The card is hidden when no rule fires, and the ranked list is capped at eight clues.

**A passing execution opens on Steps**, with an **Artifacts** tab for its traces, attachments, console and network.

Both keep a **Performance** tab (performance hints plus color-coded **Web Vitals**) and a **History** tab (this test's status and duration trend over recent runs, linking through to the full test history). A **Copy retry command** button in the summary gives you the exact Playwright command to re-run just this test. The Web Vitals, network, console, ARIA-snapshot and alternative-locator data all come from the [capture fixtures](./capture-fixtures).

## Trace-powered deep views

::: tip Screenshots are Playwright's to record
The screenshots in **failure evidence** come from Playwright's `screenshot: 'only-on-failure'` `use` option (`'on'` records every test). Playwright's default is `'off'`, so with the option unset the block shows video and traces but no screenshot. Set it beside `trace` in your Playwright config; see [Basic configuration](./reporter#basic-configuration) on the reporter page.
:::

When an execution has an uploaded trace, two evidence blocks go deeper — no configuration beyond recording traces (`trace: 'retain-on-failure'` or `'on-first-retry'` in your Playwright config):

- **Test source → Full stack** — the complete call stack of the failing action from the trace's stacks index, every frame with its real source read from the trace's embedded files (recorded by default with the Playwright test runner), the failing line highlighted, dependency frames folded, and Open-in-IDE links on each in-project frame. A toggle switches back to the reporter-captured frames.
- **Network → Full trace** — every request the page made (documents, scripts, images — not just fetch/XHR), on a waterfall with the failing action's time window shaded. Click a request for timing phases, request/response headers, and a capped body preview (JSON pretty-printed, images inline). Sensitive header values (`Authorization`, `Cookie`, …) are masked server-side and never leave the dashboard, and token-shaped strings in URLs and bodies are masked too.

Executions without a trace keep the reporter-captured baseline — the blocks simply hint at what a trace would add. Traces recorded without embedded sources still show the full frame list.

### Recovered from the trace without the fixtures

A project that installed only the reporter — no [capture fixtures](./capture-fixtures) — still gets most of the failure evidence, because the trace carries it. When a reported execution has an uploaded trace but no fixture data, the dashboard recovers three things at ingest and stores them in the same place the fixtures would: the **console** entries (`warning`/`error`/`assert`), the **network requests** (method, URL, status, duration, start time — restricted to the API and document requests the fixtures keep, and including the failed and aborted requests the fixtures never captured), and the failure-time **ARIA snapshot** when Playwright wrote an `error-context` alongside the trace. Cards showing this data carry a **derived from the trace** chip. Fixture-captured data is never replaced, and each kind is recovered only when it is otherwise missing. This is on by default with [`wrapConfig`](./reporter#installing-via-wrapconfig), which records the trace for you.

### Why a card is empty

Console, network, app state, ARIA snapshot, backend logs and Web Vitals no longer simply vanish when they hold nothing. Each empty card states exactly one of three things, so a blank block is never ambiguous:

- **Not captured** — the [capture fixtures](./capture-fixtures) are not active for this project (for example a spec that still imports `test` from `@playwright/test`). The card names what to add and links to the in-app `/setup` capability checklist. "Fixtures active" is decided per execution, so a spec that never adopted the fixtures reads *not captured* while its fixture-using neighbors read *nothing happened*.
- **Captured, nothing happened** — the fixtures were active and this run simply produced nothing (no console output, no matching requests, …). Working as intended, nothing to fix.
- **Not applicable** — the card needs a capability the app under test does not have. Backend logs are the case: they need a [Piwi backend integration](./backend-logs) on the app under test on top of the fixtures.

The AI diagnosis reads the same map: its **Data Coverage** block names each absent section with the same reason a human sees, so the model and the reader are never looking at different pictures.

## Trace viewer

Every trace shows a **View trace** button that opens the full Playwright trace viewer — the same UI as `npx playwright show-trace`, with the DOM snapshot timeline, action log, network, console, and source.

The viewer is **served by the dashboard itself** (the `playwright-core` viewer assets are bundled and served at `/trace-viewer/`), so traces are never uploaded to a third party — unlike sending a colleague to `trace.playwright.dev`, the bytes stay on your server. Traces are stored efficiently: each archive is split into a slim events ZIP plus a project-wide, hash-deduplicated resource pool, and reconstructed on download (see [Storage](./storage)). Trace blobs are content-addressed, so the browser caches them and re-opening a trace is instant.

::: tip Authentication caveat
The bundled `/trace-viewer/` is same-origin, so it works whether or not [authentication](./authentication) is enabled. The hosted `trace.playwright.dev` viewer is a different origin and cannot send your session cookie, so it only works against a dashboard with auth disabled — use the built-in **View trace** button, which always works.
:::

## The test case page

`/test-cases/:id` is the other axis: not one attempt, but the test's whole life. Total runs, pass rate,
average duration and last run across every execution, a duration trend, a status-history strip, and the
list of recent executions — each linking back to the diagnosis view above.

<figure>
  <img src="/screenshots/test-case-detail.png" alt="Test case page with total runs, pass rate, failed count, average duration, flaky count and last run, above a duration trend chart, a status history strip, and a table of recent executions">
  <figcaption>The test case page — the across-time view: pass rate and duration stats, a duration trend, a status-history strip, and every recent execution of this one test.</figcaption>
</figure>

## Taking it out of the dashboard

Any of this can leave the dashboard as a self-contained file — for a ticket attachment, a colleague
without an account, or an archive that outlives your retention window. See
[Offline export](./offline-export).

## See also

- [Capture fixtures](./capture-fixtures) — the one file that produces the network, console, Web Vitals and locator evidence
- [AI diagnosis & clustering](./ai-diagnosis) — the same investigation across every test sharing a fingerprint
- [Core concepts](./concepts#execution) — execution versus test case
- [Fix a broken locator](./recipes/broken-locator) — this page, used for one concrete job
