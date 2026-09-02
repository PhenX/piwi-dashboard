---
title: Core concepts
lang: en-US
---

# Core concepts

Piwi reuses Playwright's vocabulary where it can, but a dashboard that keeps history needs a few
distinctions Playwright doesn't have to make — most importantly between *a test* and *one run of that
test*. This page defines the words the rest of the documentation and the UI use.

## The object model

```
Project                      one test suite you submit results for
└── Test run                 one `npx playwright test` (all shards merged)
    └── Execution            one attempt of one test, on one browser
        └── belongs to a Test case   the test's identity across all runs
             │
             └── Failure cluster     executions that failed the same way
```

Read it in two directions:

- **Down** — "what happened in this run?" A run holds executions; each execution points at the test it
  is an attempt of.
- **Across** — "how has this test behaved?" A test case holds every execution of itself, in every run,
  over time. That's the axis flakiness, pass rate, and duration trends are computed on.

## Project

A named container for one suite's results — usually one repository, or one suite within it. Projects
are created automatically the first time results are submitted under a new `projectName`; you never
have to pre-register one.

A project carries its own tags, retention, access assignments, SCM connection, and AI-diagnosis
instructions.

## Test run

Everything one `npx playwright test` invocation produced: counts, duration, the HTML report, CI and
git metadata, and every execution inside it.

Two things commonly surprise people:

- **Shards merge into one run.** Ten `--shard` jobs produce one run, not ten. The reporter derives a
  stable *run label* from your CI's pipeline ID and every shard submits against it; the run stays
  `running` until the last shard finishes. See [CI & sharding](./ci).
- **A run can be watched while it happens.** With streaming enabled (the default), the run row appears
  when the suite starts and fills in test by test, so a failure is browsable before CI finishes.

## Test case

The **identity of a test across time**, keyed by project + file path + `describe` path + title. It is
not a row you submit — it's created and reused as results arrive, so renaming a test creates a new one
and moving a spec file does too.

A test case is browser-independent: `login.spec.ts › signs in` is one test case whether it ran on
Chromium, Firefox, or all five projects in your matrix.

This is the object at `/test-cases/:id` — pass rate, duration trend, status history, and the list of
every execution.

## Execution

**One attempt of one test case, in one run, on one browser.** Retries are separate executions, not a
field on one: a test that failed twice and passed on the third attempt contributes three executions to
the same run. So is each browser in a project matrix.

This is the object at `/test-run-cases/:id` — the error, steps, trace, screenshots, console, network,
Web Vitals, and (for a failure) the diagnosis view. When the docs say *execution* or *test-run case*,
this is what they mean; when they say *test case*, they mean the identity above it. The run page's
list still calls executions *cases* in a few labels (the counter, the search box, the title column) —
same object, older name.

The distinction matters in practice: "this test is flaky" is a statement about a **test case**, and
"here is the stack trace" is a statement about one **execution**.

## Error fingerprint & failure cluster

When an execution fails, Piwi hashes a normalized form of its error — error type, message with the
volatile parts masked out (timeouts, numbers, UUIDs, URLs, expected/received values), and the locator
with its dynamic arguments masked. That hash is the **error fingerprint**.

Every failed execution sharing a fingerprint joins one **failure cluster**. Fifty red tests caused by
one broken endpoint become one cluster you triage once, with a status (open / resolved / ignored) and
a note. API routes and a few components say *failure groups* for the same thing.

Fingerprints deliberately **ignore the failing stack frame**, so the same root cause reached from six
different spec files stays one cluster. Full detail:
[Failure clustering & AI diagnosis](./ai-diagnosis).

## Baseline (last green run)

Several views answer "what changed?" — run insights, the regression signals on a test, the environment
and visual diffs, and the git diff behind an AI diagnosis. They all compare against a **baseline**,
chosen to be branch-aware: the most recent passing run **on the same branch**, falling back to the
**default branch** (what a fresh pull-request branch forked from) when the branch has no history yet,
and to any branch only when neither exists. A run whose branch is unknown compares against the most
recent passing run in the project, as before.

The **default branch** is resolved per project: an explicit setting in **project settings**, else the
repository's default branch read from the SCM provider, else `main`.

Two derived flags are stored per execution:

- **New regression** — passed in the baseline, fails now.
- **New flaky** — didn't retry in the baseline, passed on retry now.

## Flakiness score

A test case's **composite score** from three independent signals — retry passes, status alternation
across runs, and overall failure rate — plus a **root-cause class** (timing, network, assertion,
environment, other) and an **impact ranking** in wasted CI minutes. It's a property of the test case,
computed over its execution history, which is why a test needs a few runs of history before it can be
called flaky. See [Flaky tests](./flaky-tests).

## Locator snapshot

When the [capture fixtures](./capture-fixtures) are installed, every successful locator call records
what the element actually looked like — role, accessible name, test id, structural anchors — keyed by
the **call site** (`file:line`) rather than the selector text. One row per call site, refreshed on each
passing run.

When that locator later fails, those snapshots are what Piwi ranks replacement locators from. See
[Locator healing](./reporter#locator-healing).

## Environment

A free-text label on a run (`production`, `staging`, a preview URL, whatever you use), set with the
reporter's `environment` option or `PIWI_ENVIRONMENT`. It's a **scoping** dimension, not a
configuration one: flaky analysis, analytics, and timeline markers can all be narrowed to a single
environment so a staging suite's noise doesn't blend into production's numbers.

## Tags & ownership

Two ways to say what a test *is*, both declared in the spec file and both read by the reporter.

**Tags** come from Playwright itself — `@smoke` in a title or the `{ tag: [...] }` option. Piwi stores them with the
leading `@` stripped, on the execution (what that run saw) and on the test case (the latest declaration). They are how
you slice the test-case catalog and the flaky leaderboard, and what the [CI gate](./ci#blocking-a-merge)'s
`--require-tag` rule matches on.

**Ownership metadata** comes from four `piwi:` annotations — `owner`, `priority`, `feature` and `link`. Where a tag
groups tests, this says who answers for one. It shows as badges wherever the test is listed and is carried into
[pull-request feedback](./ci#pull-request-feedback), so a failure comment names the team rather than leaving a reviewer
to guess.

Both are optional and neither changes how a test runs. Details and the exact accepted values are in
[Reporter → Test tags](./reporter#test-tags).

**When a test declares no owner, Piwi reads your repository's CODEOWNERS instead.** Asking every team to annotate every
test is how ownership features die; the repository already records who owns which files, and Piwi can read it because it
runs inside your network with a token it already has. So ownership works on day one with no test edits, and a
`piwi:owner` annotation still wins wherever a team wants to be explicit.

That derived owner is used in [pull-request comments](./ci#pull-request-feedback), on the flaky leaderboard, and by the
`owners` [notification filter](./notifications#subscriptions), which routes a run only to the team whose tests broke.
It needs an [SCM token](./ai-diagnosis#scm-grounded-context); without one, ownership falls back to annotations alone.

## Where each concept lives in the UI

| Concept | URL | Docs |
|---|---|---|
| Project | `/projects/:id` | [UI overview](./ui-overview#project-detail) |
| Test run | `/test-runs/:id` | [UI overview](./ui-overview#test-run-detail) |
| Test case | `/test-cases/:id` | [UI overview](./evidence#the-test-case-page) |
| Execution | `/test-run-cases/:id` | [UI overview](./evidence#one-execution-diagnosis-first) |
| Failure cluster | `/failure-clusters/:id` | [AI diagnosis & clustering](./ai-diagnosis) |
| Cross-project view | `/analytics` | [Analytics](./analytics) |

## See also

- [Getting started](./getting-started) — get results flowing in
- [UI overview](./ui-overview) — a map of every page
- [Reporter](./reporter) — how each of these objects gets populated
