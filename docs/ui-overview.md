---
title: UI overview
lang: en-US
---

# UI overview

This page is a **map of the dashboard** — where each view lives and what it's for. For the concepts behind a feature, follow the links to the dedicated pages ([Core concepts](./concepts), [Flaky tests](./flaky-tests), [AI diagnosis & clustering](./ai-diagnosis), [Reporter](./reporter)).

The dashboard is a single-page app built with [Nuxt UI](https://ui.nuxt.com). It updates itself in real time over Server-Sent Events — pages refresh automatically when runs start or finish, so you never reload manually.

## Inline help

Blocks that aren't self-explanatory carry a small muted help icon (a circled question mark) next to their title. Click it for a short explanation and, where relevant, a **Learn more** link into these docs. The icon is keyboard-focusable and closes with `Esc`. Self-explanatory blocks (counters, search boxes) have no icon, keeping the UI uncluttered.

## Open in IDE

Every source path shown in the dashboard is clickable — hover it to reveal an **open in IDE** control that jumps to that file (and line) in VS Code or JetBrains. See [Open in IDE](./ide-integration) for setup and the available methods.

## Navigation

The sidebar gives access to the top-level sections:

| Section | Path | Purpose |
|---------|------|---------|
| Home | `/` | Aggregate stats and activity across all projects |
| Analytics | `/analytics` | Cross-project trends, portfolio health, and insights over a chosen time window (see [Analytics](./analytics)) |
| Projects | `/projects` | Full project listing with search and tag filters |
| Settings | `/settings` | Configuration — general, account, users, storage, tags, wasted time, AI, notifications |
| API docs | `/docs` | Self-contained OpenAPI 3.1 reference (no external CDN) — browse endpoints and schemas, try requests live, copy cURL / fetch snippets |
| MCP server | `/mcp` | Setup guide for connecting AI clients (see [MCP server](./mcp)) |

Everything else is reached by drilling into a project, run, or test case:

| Page | Path |
|------|------|
| Project detail | `/projects/:id` |
| Project edit | `/projects/:id/edit` |
| Test cases (project) | `/projects/:id/test-cases` |
| Failure cluster | `/failure-clusters/:id` |
| Test run | `/test-runs/:id` |
| Test case | `/test-cases/:id` |

## Home

A quick health check across all projects: **stats cards** (projects, runs, active/passing projects, flaky count, slowest project), a **test-results trend chart** (pass/fail/skip/flaky over time), **recent projects**, and a getting-started snippet for teams that haven't wired up the reporter yet.

## Analytics

A cross-project decision view — where Home answers *"what's happening now"*, Analytics answers *"across projects, over time"*. A **scope bar** at the top sets the period (last 7 / 30 / 90 days, last year, or all time), an optional environment, and a full-runs-only toggle; every widget re-aggregates against that scope.

Widgets: an **insights** feed, **portfolio health**, a **pass-rate heatmap**, **CI time** and **wasted CI time**, the global **flakiest tests** leaderboard, open **failure clusters**, **regression velocity**, a **browser matrix**, and cross-project **slow endpoints**. [Timeline markers](./timeline-markers) overlay your deploys and infrastructure changes on the trend charts.

See [Analytics](./analytics) for what each widget answers and how the periods are compared.

## Projects

The primary hub: instant **text search**, **tag filters**, and a table showing each project's run count, last-run date, duration, status, test pass/fail bar, report links, and actions. Create a project manually with **New project** (it's also created automatically on first result submission).

## Project detail

The complete history for one project, organized into tabs:

- **Test runs** — every run with status, start time, duration, test counts, and browser badges; select two runs to compare. Runs with a shared failure signature roll up into **Failure clusters** here (see [AI diagnosis & clustering](./ai-diagnosis)).
- **Flaky tests** — intermittent tests scored by a composite flakiness metric, with root-cause classification and impact ranking. See [Flaky tests](./flaky-tests#flaky-test-detection).
- **Performance** — average/P90 duration trends and a slowest-tests table. See [Performance](./flaky-tests#performance).
- **Test cases** — every unique test with status, executed-only pass rate, result breakdown, average duration, and last run; searchable, filterable by status, [tag](./reporter#test-tags), owner, priority and last-run age (stale cases hidden by default), paginated, with flat and per-spec tree views.
- **Compare** — side-by-side delta between two runs (new failures, recovered, duration changes).
- **Spec health** — a heatmap grouping test cases by spec file and coloring each by pass rate, so an unhealthy area of the suite jumps out. See [Spec health heatmap](./flaky-tests#spec-health-heatmap).
- **Members** *(admins, when auth is enabled)* — grant or scope project access per user. See [Project access](./authentication#project-access).

Project **edit** (`/projects/:id/edit`) sets the label, description, tags, per-project SCM token, and **AI diagnosis instructions** (project-specific context combined with the global instructions for every diagnosis).

Project **import** (`/projects/:id/import`, admins only) backfills runs recorded before you adopted Piwi from Playwright blob reports, checking each archive against the server's size limit and the project's existing imports before uploading anything. See [Importing past runs](./importing-runs).

## Test run detail

A deep dive into a single run. The **summary header** shows status, duration, test counts, duration metrics (avg/P90), and metadata cards (CI/environment, source control, tags). While a run is still `running`, a **live progress bar** and streaming results appear in real time. **Reports** buttons open or download the attached HTML reports (Playwright, Monocart).

The right panel is tabbed:

- **Test cases** — every test with browser icon, status, duration, location, errors, annotations, and traces; searchable, filterable by status/browser, and grouped by suite hierarchy (describe blocks).
- **Insights** — what changed versus the last passing baseline: new regressions, recurring failures, fixed tests, new flaky tests, performance changes, worker imbalance, and new clusters. See [Run insights](./flaky-tests#run-insights).
- **Failure groups** — failures grouped by error fingerprint, each with flaky/worker-correlation signals and actions to filter the list, trigger AI diagnosis, or open the cluster. See [AI diagnosis & clustering](./ai-diagnosis).
- **Regression** *(shown when a baseline exists)* — the regression delta for this run at a glance.
- **Timeline** — a horizontal per-worker timeline of test execution, with a span-type filter to isolate test phases (setup, actual test, wasted waits, teardown); click a bar to jump to that test case.
- **Compare** — pick a baseline run for a side-by-side delta (improved / regressed / unchanged).
- **Slow endpoints** — network requests grouped by method + normalized route, with avg/p90/max duration and error rate. Requires the [capture fixtures](./capture-fixtures).

Administrators can **delete** the entire run and its files from the header.

## Test case detail

Everything about a single test execution, laid out **diagnosis-first**. A pinned **summary** carries the status, title, copyable location, duration, worker, retries and duration-vs-average, plus at-a-glance **signal badges** (new regression, new flaky, passed-on-retry), any test annotations (`@fixme`, `@slow`, …), the **wasted time** spent in fixed waits, and metadata cards (environment, CI, branch, commit, author, browser, storage). Traces stream in live while the parent run is still running.

The tabs adapt to the result.

**A failing execution opens on the Diagnosis tab** — the whole investigation on one screen, modeled on the [failure cluster](#failure-cluster-detail) page you already know. It leads with the raw **error** (copyable), then splits into a right-hand rail and a left-hand evidence funnel:

- **Verdict** — is this a new regression or flaky, how many times it retried, and how long the test has been failing, with a clickable recent-runs strip to jump between executions.
- **Failure cluster** *(when the failure is clustered)* — signature, error type, how many tests it hit, the cluster's own AI verdict, and a hand-off to the full cross-test investigation.
- **AI diagnosis** — diagnose *this execution* with one click, or **Copy AI context** to paste the full evidence bundle into your own assistant (works even with no provider configured). Cited evidence links jump to the matching section on the page.
- **Evidence funnel** — the **test source** as a call stack (the line that actually threw plus the callers above it, so a failure inside a helper is visible, not just the test line that invoked it — and, [with a trace](#trace-powered-deep-views), the complete stack with real source), grouped **failure evidence** (screenshots, video, traces, attachments), [alternative locators](./reporter#locator-healing) for a broken locator, an **environment diff** and **visual diff** against the last green run, **console** output, **network requests** with inline [backend logs](./backend-logs) and a [Full trace](#trace-powered-deep-views) network view, **app state**, the failure-time **ARIA snapshot**, and the reconstructed **DOM snapshot**.

**A passing execution opens on Steps**, with an **Artifacts** tab for its traces, attachments, console and network.

Both keep a **Performance** tab (performance hints plus color-coded **Web Vitals**) and a **History** tab (this test's status and duration trend over recent runs, linking through to the full test history). A **Copy retry command** button in the header gives you the exact Playwright command to re-run just this test. The Web Vitals, network, console, ARIA-snapshot and alternative-locator data all come from the [capture fixtures](./capture-fixtures).

### Trace-powered deep views

When an execution has an uploaded trace, two evidence blocks go deeper — no configuration beyond recording traces (`trace: 'retain-on-failure'` or `'on-first-retry'` in your Playwright config):

- **Test source → Full stack** — the complete call stack of the failing action from the trace's stacks index, every frame with its real source read from the trace's embedded files (recorded by default with the Playwright test runner), the failing line highlighted, dependency frames folded, and Open-in-IDE links on each in-project frame. A toggle switches back to the reporter-captured frames.
- **Network → Full trace** — every request the page made (documents, scripts, images — not just fetch/XHR), on a waterfall with the failing action's time window shaded. Click a request for timing phases, request/response headers, and a capped body preview (JSON pretty-printed, images inline). Sensitive header values (`Authorization`, `Cookie`, …) are masked server-side and never leave the dashboard, and token-shaped strings in URLs and bodies are masked too.

Executions without a trace keep the reporter-captured baseline — the blocks simply hint at what a trace would add. Traces recorded without embedded sources still show the full frame list.

<figure>
  <img src="/screenshots/test-case-detail.png" alt="Test case detail page with summary stats, duration trend, status history, and recent executions">
  <figcaption>The test case detail page — pass rate and duration stats, a duration trend, a status-history strip, and every recent execution of this one test.</figcaption>
</figure>

## Trace viewer

Every trace shows a **View trace** button that opens the full Playwright trace viewer — the same UI as `npx playwright show-trace`, with the DOM snapshot timeline, action log, network, console, and source.

The viewer is **served by the dashboard itself** (the `playwright-core` viewer assets are bundled and served at `/trace-viewer/`), so traces are never uploaded to a third party — unlike sending a colleague to `trace.playwright.dev`, the bytes stay on your server. Traces are stored efficiently: each archive is split into a slim events ZIP plus a project-wide, hash-deduplicated resource pool, and reconstructed on download (see [Storage](./storage)). Trace blobs are content-addressed, so the browser caches them and re-opening a trace is instant.

::: tip Authentication caveat
The bundled `/trace-viewer/` is same-origin, so it works whether or not [authentication](./authentication) is enabled. The hosted `trace.playwright.dev` viewer is a different origin and cannot send your session cookie, so it only works against a dashboard with auth disabled — use the built-in **View trace** button, which always works.
:::

## Failure cluster detail

Each cluster (`/failure-clusters/:id`) opens on a summary — signature, affected tests, and **Triage** (set status open/resolved/ignored and write a note) — above a two-column body. The left column collapses each investigation section to a header with an at-a-glance peek (click to expand, and the state is remembered): the raw **error message**, an **alternative-locators** panel for broken locators, **test evidence** (one tab per affected case, each linking through to its test-run case, with screenshots, traces, failing steps, console/network signals and source), and **what changed** (the SCM diff since the last green run, with a baseline-commit picker and commit browser). The right column holds the **AI diagnosis** — an SCM-grounded LLM analysis whose cited evidence links back to the matching left-column section. Full detail: [AI diagnosis & clustering](./ai-diagnosis).

## Settings

| Page | Path | What it does |
|------|------|--------------|
| General | `/settings` | Basic app configuration; a **Reset Demo** button in demo mode |
| Account | `/settings/account` | Your display name, email, password, and **connected accounts** (link/unlink Google or GitHub — see [OAuth](./authentication#oauth-google-github)) |
| Users | `/settings/users` | User accounts, roles, project access, and API keys (shown once, stored hashed) — see [Authentication](./authentication) |
| Storage | `/settings/storage` | Storage stats and cleanup (bulk-delete runs older than N days) — see [Storage](./storage#storage-management) |
| Tags | `/settings/tags` | Create, color, edit, and delete the tags used to organize projects |
| Pull requests | `/settings/pr-feedback` | What Piwi posts back to a pull request when a run finishes — see [Pull-request feedback](./ci#pull-request-feedback) |
| Wasted time | `/settings/wasted-time` | Patterns that classify which Playwright waits count as "wasted time" on the timeline — see [Configuration](./configuration#wasted-time) |
| AI | `/settings/ai` | Provider/model roles, auto-diagnose, global instructions, and context limits — see [AI diagnosis](./ai-diagnosis#enabling-ai-diagnosis) |
| Notifications | `/settings/notifications` | Channels, subscriptions, and SMTP — see [Notifications & alerts](./notifications) |

Where an environment variable backs a setting, the field is shown read-only with a lock badge and the env var name (see [Configuration](./configuration)).

## Real-time updates

The dashboard uses Server-Sent Events so it never needs a manual refresh:

- **Global stream** (`/api/stream`) — tells every connected client when a run starts, finishes, or is submitted; pages re-fetch their data.
- **Per-run stream** (`/api/test-runs/:id/stream`) — drives the live progress on the run detail page during a streaming run.

## Live demo

The [live demo](https://piwitests.github.io/demo/) runs entirely in your browser (in-memory SQLite) and adds two things the real app doesn't need:

**Simulate a test run** — the demo banner replays the exact streaming protocol a Piwi reporter speaks during a real run, so you can watch one arrive live. Scenarios: a passing run, a run with failures (joining a known cluster plus a brand-new one), flaky retries, a performance regression, an interrupted run, and a cross-browser run. Each creates a real run in the in-browser database, so worker timeline, failure groups, and history comparisons all behave exactly as they would against a server.

**Acting as** — the demo runs with authentication conceptually enabled. Switch between pre-seeded identities (an admin, a CI reporter, and several project-scoped users) to see how [project access](./authentication#project-access) changes what each user sees. Acting as the admin, you can change affectations live and then switch users to see the effect.

## Responsive & dark mode

The dashboard is fully responsive — sidebar navigation on desktop, collapsible sidebar and horizontally scrolling tables on tablet, and a stacked/hamburger layout on mobile. It supports light and dark themes, following the system preference by default, with a manual toggle in the sidebar.
