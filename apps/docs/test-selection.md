---
title: Test selections
lang: en-US
---

# Test selections

A **selection** is a named, data-driven subset of your suite that Piwi resolves from the run history it already keeps —
then hands back as a command you can run. Instead of maintaining a `@smoke` tag convention and a grep pattern in a CI
file that quietly drift apart, you describe the subset once ("critical tests, under 15 s each, not quarantined") and
`piwi run` turns it into the tests to run, every time, against the current state of the suite.

Selections are resolved on demand, never frozen: a definition is rules over catalog facts, so a renamed file or a newly
flaky test is reflected the next time you resolve, with no edit.

## Run one

```bash
npx @piwitests/reporter run smoke
```

`piwi run <key>` resolves the selection and runs `playwright test` with exactly those tests. Point it at your dashboard
the same way the reporter does — `PIWI_DASHBOARD_URL`, `PIWI_API_KEY` (if auth is on), and `PIWI_PROJECT_NAME`:

```bash
PIWI_DASHBOARD_URL=https://piwi.example.com \
PIWI_PROJECT_NAME=web \
npx @piwitests/reporter run smoke -- --workers=4
```

Anything after `--` is passed straight to Playwright. The run is **stamped** with the selection it came from, so the
dashboard shows `smoke · 42 tests` instead of an anonymous filter, and a [gate](/ci) can re-resolve the same definition
to check nothing was silently dropped.

If the dashboard is unreachable, `piwi run` falls back to the full suite with a warning (and reuses the last good
resolution from `.piwi/selection-cache.json` when it has one) — a reporting problem never breaks the test run. Pass
`--strict` to invert that for CI, where an unresolvable selection should stop the pipeline. Resolving to **zero** tests
is always an error: a smoke job that silently runs nothing is worse than one that fails loudly.

### Print instead of run

`piwi select <key>` resolves and prints the Playwright arguments, for a composable two-step job:

```bash
npx @piwitests/reporter select smoke --format args > .piwi-selected
npx playwright test $(cat .piwi-selected)
```

`--format` picks the shape: `args` (`file:line` tokens, the default), `grep`, `files`, or `json` (the full resolution,
including the matched tests, the estimate and any warnings). `--budget 5m` caps the total time for this resolution.

## Built-in selections

Two selections exist for every project with no setup:

| Key | What it resolves to |
|---|---|
| `failed` | Tests whose most recent execution failed or timed out. |
| `quarantine-free` | The whole suite minus tests under an active [quarantine](/flaky-tests). |

They also double as worked examples of the definition format below.

## Defining a selection

Save a selection through the dashboard or the API (`POST /api/projects/:id/selections`). The `definition` is declarative
JSON: OR-ed `include` groups, minus OR-ed `exclude` groups, then pins, a budget and a limit — applied in that order.

```jsonc
{
  "include": [
    { "tags": ["smoke"] },
    { "priority": ["critical", "high"], "maxAvgDurationMs": 15000 }
  ],
  "exclude": [{ "quarantined": true }],
  "budget": { "maxTotalDurationMs": 300000, "rankBy": "failureLikelihood" },
  "limit": 200
}
```

Within a group every predicate must hold (AND); a test matches `include` if it matches any group (OR). An empty or
absent `include` starts from the whole suite. The predicates, all optional:

| Predicate | Matches when |
|---|---|
| `tags` / `anyTags` | the test carries all / any of these tags |
| `owner`, `priority`, `feature` | the `piwi:` annotation is one of these |
| `files` | the file path matches one of these globs (`**`, `*`, `?`) |
| `suitePath`, `text` | the describe chain / title (or file) contains this substring |
| `quarantined`, `flaky`, `neverRun` | the test is (or is not) in that state |
| `minPassRate` / `maxPassRate` | pass rate over executed runs is within bounds (0–1) |
| `minAvgDurationMs` / `maxAvgDurationMs` | average duration is within bounds |
| `lastStatus` | the latest execution's status is one of these |
| `failedInLastRuns` | the test failed within its last _N_ executions (N ≤ 25) |

An unknown predicate is a validation error, not a silent no-op — a typo fails loudly rather than resolving to a wider
set than you meant.

### Budgets and pins

`budget` turns a selection into a knapsack: tests are ranked (`failureLikelihood`, `recentFailure`, `priority`,
`slowest` or `fastest`) and taken until their summed average duration hits `maxTotalDurationMs`. "The best five minutes
of this suite" is an empty `include` plus a budget. `pins` force individual tests in (`add`) or out (`remove`) by test-
case id, on top of whatever the predicates matched. `limit` caps the count last.

## From a Playwright config

If you prefer `PIWI_SELECTION=smoke playwright test` over `piwi run`, resolve the selection in an ESM config with the
`resolveSelection` helper (it needs top-level `await`, which `defineConfig` in an ESM config allows):

```ts
import { defineConfig } from '@playwright/test';
import { wrapConfig, resolveSelection } from '@piwitests/reporter';

const selection = await resolveSelection(); // reads PIWI_SELECTION; undefined when unset
export default wrapConfig(defineConfig({ grep: selection?.grep }));
```

It stamps the run the same way `piwi run` does, and returns `undefined` (so the config runs everything) when no
selection is named or the dashboard cannot be reached.

## Guard it in CI

A tag convention can't tell you a smoke job silently shrank — a renamed file or an over-narrow grep quietly drops a
test, and the job stays green. `piwi gate --require-selection <key>` closes that gap: the dashboard re-resolves the
selection's current definition and fails the build if any test it now matches did not run, or ran and failed.

```bash
npx @piwitests/reporter run smoke                 # run the subset, stamping the run
npx @piwitests/reporter gate --require-selection smoke   # then assert it held
```

It composes with the other [gate](/ci) rules (`--max-new-regressions`, `--fail-on-flaky`, …). A quarantined test is
exempt — quarantine already means "don't gate on this test".

## In the dashboard, and for agents

The project's **Selections** tab lists the built-ins and your saved selections, with a builder that previews live what
a definition resolves to — the matching tests, the estimated duration, any warnings, and the exact command — before you
save it. For AI agents, the [MCP server](/mcp) exposes `list_selections`, `resolve_selection` (key → tests + verify
command) and `preview_selection` (an ad-hoc definition, dry-run); the `run-the-right-tests` skill ties them together.

## What selections are not

- **Not instrumented test-impact analysis.** Predicates read _observed_ history — durations, pass rates, statuses — not
  a build-time dependency graph.
- **Not a way to hide failures.** [Quarantine](/flaky-tests) decides a test's verdict; a selection only decides whether
  it runs. The full suite stays your baseline — selections are for the fast loops in between.
- **Not a hosted service.** Everything resolves on your instance against your data.
