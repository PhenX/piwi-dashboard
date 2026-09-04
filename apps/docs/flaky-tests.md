---
title: Flaky tests
lang: en-US
---

# Flaky tests

A single run tells you what failed. A few dozen runs tell you what's *unreliable* — and that's a
different, more expensive problem. This page covers what Piwi computes for one project once it has some
history: flaky scoring, regression signals, performance trends, and spec health.

For the same signals aggregated across every project, see [Analytics](./analytics).

## Flaky test detection

A test is flaky when its result isn't deterministic. Piwi computes a **composite flakiness score** per test from three signals:

- **Retry passes** — failed on the first attempt, passed on retry.
- **Status alternation** — flips between pass and fail across runs.
- **Failure rate** — overall proportion of failures.

The project's **Failures** tab has a **Flaky** view with a **configurable lookback window** so you can focus on recent behavior or a longer baseline. Each flaky test links to its history and carries a **Quarantine** action.

**Per-environment scoping** — select a single environment in the project's filter bar and the flaky analysis is scoped to runs from that environment, so you can compare stability across `staging`, `production`, and `development` instead of blending them. (Set the environment via the reporter's `environment` option / `PIWI_ENVIRONMENT`; see the [reporter](./reporter) docs.)

<figure>
  <img src="/screenshots/flaky-detection.png" alt="Flaky tests tab listing tests with composite score, failure rate, retry passes, and flip counts">
  <figcaption>The Flaky view of a project's Failures tab — each intermittent test scored by retry passes, status flips, and failure rate, ranked by impact and filterable by root-cause category.</figcaption>
</figure>

### Root-cause classification

Every flaky test is automatically tagged with one of five categories, using keyword and distribution heuristics over its errors, steps, and browser spread:

| Category | Typical signals |
|----------|-----------------|
| `timing` | Timeouts, "to be visible", `waitFor`, element-not-found-within |
| `network` | `net::` / `ERR_` errors, 5xx responses, `ECONNREFUSED`, `waitForResponse` |
| `assertion` | `expect(...)`, "Expected:", snapshot/screenshot comparison — with no timing/network noise |
| `environment` | Fails repeatedly on exactly one browser while others pass |
| `other` | No clear signal |

Filter the flaky table by category to triage a class of failures at once.

### Impact ranking

Not all flaky tests are equally expensive. Piwi ranks them by **impact** — derived from wasted CI minutes (retries × average failed duration) and pipeline-block effect — so you fix the ones that hurt most first. A color-coded dot makes it scannable:

- 🟢 green — under 5 wasted minutes
- 🟡 amber — under 30 minutes
- 🔴 red — 30 minutes or more

### Per-test stability trend

Each test case has a **stability trend**: a time series of pass rate, flaky rate, and average duration, bucketed over time — so you can see whether a fix actually stuck.

## Run insights

The **Insights** tab on a run compares it against its last passing baseline and surfaces what changed:

- **New regressions** — tests that newly started failing
- **Recurring failures** — failing again
- **Fixed** — previously failing, now passing
- **New flaky** — newly flaky tests
- **Performance changes** — most regressed / most improved
- **Worker imbalance** — uneven load across workers
- **New failure clusters**

<figure>
  <img src="/screenshots/run-insights-annotated.png" alt="Run Insights tab showing pass-rate delta, new regressions, and new flaky tests versus the baseline, with the run summary boxed and the pass rate and new regressions numbered">
  <figcaption>The Insights tab on a run — <strong>1</strong> pass-rate and duration deltas against the last passing baseline, <strong>2</strong> the tests that newly started failing.</figcaption>
</figure>

## Quarantine, with a way out

Detecting a flaky test doesn't stop it blocking merges. Quarantine does — without hiding it.

The usual approach is `--grep-invert @quarantine`: the test stops running, so nothing ever proves it's fixed, and the
list only grows. A year later nobody remembers why half of it is there.

**A quarantined test in Piwi keeps running and keeps reporting.** It is excluded from the [CI gate](./ci#blocking-a-merge)'s
verdict and nothing else. That single difference is what makes the exit possible:

- Passing runs after quarantine accumulate as a **streak**, and one failure resets it.
- After five consecutive passes the test is flagged **ready to release** — the dashboard tells you, rather than waiting
  to be asked.
- **Candidates** are proposed from the flaky analysis, ranked by *wasted CI minutes* rather than flakiness score. A test
  that flakes constantly but finishes in 200 ms costs nothing; one that flakes weekly and burns a four-minute timeout is
  what actually hurts.
- **Debt** is reported in aggregate: how many are quarantined, how many are ready to release, how long the oldest has
  been in, and how many still have no passing streak at all.

The gate always states how many failures quarantine excluded — a green gate that silently ignored failures would be
worthless — and `--max-quarantined` sets a ceiling so the list can't grow unbounded.

Manage it from the **Quarantine** view of the project's **Failures** tab, or over the API (`GET`/`POST /api/projects/:id/quarantine`,
`DELETE /api/projects/:id/quarantine/:testCaseId`).

## Regression signals

Individual test cases in a run carry at-a-glance badges:

- **`NEW`** (red) — a new regression
- **`FLAKY`** (purple) — newly flaky

Toggle filters on the run's test-case list to show only new regressions or new flaky tests.

Opening a failing execution surfaces the same signals (see [Test case detail](./evidence#one-execution-diagnosis-first)): the new-regression / passed-on-retry / newly-flaky badges in the header, the *why* and *since when* facts on the headline, and the failing-streak sentence with a link back to the last green run in the history block.

## Performance

- **Duration trends** — average and **P90** over time, so a few slow outliers don't hide a real regression.
- **Slowest tests** — the top offenders ranked by duration.
- **Timeout opportunities** — tests whose configured per-test timeout dwarfs their real p95 duration (so a hang or failure waits far longer than necessary), plus tests still carrying a stale `test.slow()` mark they no longer need. Each row suggests a tighter timeout (or removing the mark) and the time reclaimable per failing run, ranked by impact. This relies on the per-test timeout the [reporter](./reporter#per-test-timeout) captures; runs reported before that shipped still surface stale `test.slow()` marks from annotations + durations alone. Thresholds are tunable via `PUT /api/settings/timeout-hygiene`.
- **Network analysis** — slow API calls grouped by method and normalized route (e.g. `/api/users/:id`), for a run picked from the tab.
- **Browser Web Vitals** — TTFB, DOMContentLoaded, FCP and more, with color-coded thresholds.

Network analysis and Web Vitals require the [capture fixtures](./capture-fixtures) in your test setup.

<figure>
  <img src="/screenshots/performance-trends.png" alt="Performance tab showing the duration trend chart and slowest-tests table">
  <figcaption>The Performance tab — average and P90 duration trends over time, followed by a ranked table of the slowest tests.</figcaption>
</figure>

## Spec health heatmap

The project's **Tests** tab has a **Group by File** view that groups the tests under each spec file and carries that file's pass rate, flaky rate, failure count, test count and average time in the group header, so an unhealthy area of the suite jumps out.

## Across every project

Everything above is scoped to one project. The **Analytics** page lifts the same signals to your whole
portfolio over a time window you choose — portfolio health, a pass-rate heatmap, wasted CI minutes,
regression velocity, a global flaky leaderboard, and an auto-generated insights feed. See
[Analytics](./analytics).

## See also

- [Analytics](./analytics) — the same signals across every project
- [UI overview](./ui-overview) — where each of these views lives in the dashboard
- [Reporter](./reporter) — how retries, traces, and run metadata get captured
- [Capture fixtures](./capture-fixtures) — the test-side setup behind network analysis and Web Vitals
- [AI diagnosis & failure clustering](./ai-diagnosis) — explain the failures behind the trends
