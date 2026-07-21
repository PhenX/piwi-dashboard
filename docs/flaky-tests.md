---
title: Flaky tests & analytics
lang: en-US
---

# Flaky tests & analytics

Once Piwi has a few runs of history, it turns them into cross-run intelligence: which tests are flaky, what's regressing, where time is wasted, and how performance trends over time. This page covers the analytics features beyond a single run.

## Flaky test detection

A test is flaky when its result isn't deterministic. Piwi computes a **composite flakiness score** per test from three signals:

- **Retry passes** — failed on the first attempt, passed on retry.
- **Status alternation** — flips between pass and fail across runs.
- **Failure rate** — overall proportion of failures.

Each project has a dedicated **Flaky tests** tab with a **configurable lookback window** so you can focus on recent behavior or a longer baseline.

**Per-environment scoping** — select a single environment in the project's environment filter and the flaky analysis is scoped to runs from that environment, so you can compare stability across `staging`, `production`, and `development` instead of blending them. (Set the environment via the reporter's `environment` option / `PIWI_ENVIRONMENT`; see the [reporter](./reporter) docs.)

<figure>
  <img src="/screenshots/flaky-detection.png" alt="Flaky tests tab listing tests with composite score, failure rate, retry passes, and flip counts">
  <figcaption>The Flaky tests tab — each intermittent test scored by retry passes, status flips, and failure rate, ranked by impact and filterable by root-cause category.</figcaption>
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
  <img src="/screenshots/run-insights.png" alt="Run Insights tab showing pass-rate delta, new regressions, and new flaky tests versus the baseline">
  <figcaption>The Insights tab on a run — pass-rate and duration deltas versus the last passing baseline, with new regressions and newly flaky tests called out.</figcaption>
</figure>

## Regression signals

Individual test cases in a run carry at-a-glance badges:

- **`NEW`** (red) — a new regression
- **`FLAKY`** (purple) — newly flaky

Toggle filters on the run's test-case list to show only new regressions or new flaky tests.

Opening a failing execution surfaces the same signals in its **Verdict** card (see [Test case detail](./ui-overview#test-case-detail)): new-regression / new-flaky / passed-on-retry chips, plus how long the test has been failing and a link back to its last green run.

## Performance

- **Duration trends** — average and **P90** over time, so a few slow outliers don't hide a real regression.
- **Slowest tests** — the top offenders ranked by duration.
- **Timeout opportunities** — tests whose configured per-test timeout dwarfs their real p95 duration (so a hang or failure waits far longer than necessary), plus tests still carrying a stale `test.slow()` mark they no longer need. Each row suggests a tighter timeout (or removing the mark) and the time reclaimable per failing run, ranked by impact. This relies on the per-test timeout the [reporter](./reporter#per-test-timeout) captures; runs reported before that shipped still surface stale `test.slow()` marks from annotations + durations alone. Thresholds are tunable via `PUT /api/settings/timeout-hygiene`.
- **Run comparison** — a side-by-side delta of two runs with improved / regressed / unchanged summaries.
- **Network analysis** — slow API calls grouped by method and normalized route (e.g. `/api/users/:id`).
- **Browser Web Vitals** — TTFB, DOMContentLoaded, FCP and more, with color-coded thresholds.

Network analysis and Web Vitals require the [capture fixtures](./capture-fixtures) in your test setup.

<figure>
  <img src="/screenshots/performance-trends.png" alt="Performance tab showing the duration trend chart and slowest-tests table">
  <figcaption>The Performance tab — average and P90 duration trends over time, followed by a ranked table of the slowest tests.</figcaption>
</figure>

## Spec health heatmap

A project-level overview groups test cases by spec file and colors each by pass rate, so an unhealthy area of the suite jumps out. Cells link straight to the filtered test-case list.

## Cross-project analytics

Everything above is scoped to one project. The **Analytics** page (`/analytics`) lifts the same signals to the whole portfolio over a time window you choose (last 7 / 30 / 90 days, last year, or all time — plus an optional environment and a full-runs-only toggle). It answers the higher-level questions a single project page can't:

- **Portfolio health** — every project's pass rate with its change vs the previous period, flaky volume, open failure clusters, and latest run, sorted worst-first.
- **Pass rate heatmap** — projects × time, colored by pass rate, so you can see who degraded and when.
- **CI time** and **Wasted CI time** — how many CI minutes your runs consume, and how many of those produce no signal (wait steps + failed attempts).
- **Flakiest tests** — the global flaky leaderboard across all projects, using the [impact ranking](#impact-ranking) above.
- **Failure clusters** — open root causes across all projects, by age and occurrences.
- **Regression velocity** — new regressions and newly-flaky tests introduced per period (see [Regression signals](#regression-signals)), so you can see whether quality debt is growing or shrinking.
- **Browser matrix** — pass rate per project × browser, to catch browser-specific breakage.
- **Slow endpoints** — the backend calls captured during tests, aggregated across all projects by route (p50/p90 latency, error rate, projects affected).
- **Insights** — an auto-generated, severity-ranked feed of the findings that matter (pass-rate drops, failing streaks, stale clusters, wasted time, oversized timeouts and stale `test.slow()` marks, regression surges, slow shared endpoints), each linking to the source.

Each widget is served by `GET /api/analytics/:widget` and computed by a shared handler in `shared/handlers/analytics/`, so the same numbers back the dashboard, the demo, and any future API consumer.

## See also

- [UI overview](./ui-overview) — where each of these views lives in the dashboard
- [Reporter](./reporter) — how retries, traces, and run metadata get captured
- [Capture fixtures](./capture-fixtures) — the test-side setup behind network analysis and Web Vitals
- [AI diagnosis & failure clustering](./ai-diagnosis) — explain the failures behind the trends
