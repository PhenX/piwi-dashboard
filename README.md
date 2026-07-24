<p align="center">
  <img src="./docs/public/logo-wide.svg" alt="Piwi Dashboard" height="64">
</p>

<p align="center">
  <b>Your Playwright results, kept and explained.</b><br>
  CI throws away every report it makes. Piwi keeps them — every run, trace, and HTML report — then
  groups the failures by root cause, scores the flaky tests, and tells you which locator to use
  instead of the one that just broke. Self-hosted, MIT, zero telemetry.
</p>

<p align="center">
  <a href="https://piwitests.github.io/demo/">Live demo</a> ·
  <a href="https://piwitests.github.io">Documentation</a> ·
  <a href="./ROADMAP.md">Roadmap</a> ·
  <a href="https://github.com/PiwiTests/platform/discussions">Discussions</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@piwitests/reporter"><img src="https://img.shields.io/npm/v/@piwitests/reporter?logo=npm&label=reporter&labelColor=020420&color=CB3837" alt="npm reporter"></a>
  <a href="https://www.npmjs.com/package/@piwitests/server"><img src="https://img.shields.io/npm/v/@piwitests/server?logo=npm&label=server&labelColor=020420&color=CB3837" alt="npm server"></a>
  <a href="https://hub.docker.com/r/phenx/piwitests-server"><img src="https://img.shields.io/docker/v/phenx/piwitests-server?logo=docker&labelColor=020420&color=2496ED" alt="Docker"></a>
  <a href="https://github.com/PiwiTests/platform/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/PiwiTests/platform/ci.yml?branch=main&logo=githubactions&logoColor=white&labelColor=020420&label=CI" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?labelColor=020420" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://piwitests.github.io/demo/">
    <img src="./docs/public/screenshots/demo-live-run-poster.png" alt="A test run streaming live into Piwi Dashboard" width="100%">
  </a>
</p>

<p align="center">
  <sub>A run streaming in live. The <a href="https://piwitests.github.io/demo/">demo</a> is the real app on seeded data — it runs entirely in your browser, no install and no backend.</sub>
</p>

## The problem it solves

Playwright's HTML report is excellent, and it lasts exactly until the next build. So the questions that
actually matter get hard to answer: *Has this test always been flaky? Did my fix work? Which of these
forty red tests are the same bug? What did we change the day the suite started failing?*

Piwi keeps the runs so you can answer them.

- **Permanent history** — every run, trace, and report, browsable long after CI deleted its artifacts.
- **Failures grouped by cause** — an error fingerprint collapses forty red tests into the three root
  causes behind them, each triaged once.
- **Flaky tests, scored and costed** — a composite score, a root-cause class, and the CI minutes each
  flake wastes, so you fix the expensive ones rather than the annoying ones.
- **Locator healing** — when a selector breaks, ranked replacements captured from the last passing run,
  with a recommended fix.
- **Evidence in one place** — the trace viewer, screenshots, console, network calls, Web Vitals, and the
  failing call stack with real source, all served by your own instance.
- **AI diagnosis, if you want it** — an LLM *you* configure explains a cluster against your actual git
  diff, and its suggested patch is checked against your source before you see it. Off by default.

Also in the box: cross-project analytics, live run streaming, notifications (email, Slack, webhook,
browser), a REST API with in-app OpenAPI docs, and an MCP server so your coding agent can ask about
test health.

## Quick start

**1. Start the dashboard**

```bash
# Linux / macOS
mkdir -p .data && chown -R 1001:1001 .data # the container runs as non-root UID 1001
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data phenx/piwitests-server:latest
```

```powershell
# Windows (PowerShell)
docker run -p 3000:3000 -v ${PWD}/.data:/app/.data phenx/piwitests-server:latest
```

Visit `http://localhost:3000`. A [`docker-compose.yml`](./docker-compose.yml) is included, and with
**Node.js 24+** you can skip Docker entirely — `npx @piwitests/server` creates its `.data/` in the
current directory. There's also a [desktop build](https://piwitests.github.io/desktop) (Windows `.msi`,
macOS `.dmg`) that bundles the server for a single machine.

> **Linux hosts:** the container runs as non-root UID 1001, so without the `chown` above, Docker
> auto-creates `.data` owned by `root` and the container can't write to it. Docker Desktop on Windows
> and macOS handles this for you. See [Troubleshooting](./DOCKER.md#troubleshooting).

> **Before you expose it:** set `PIWI_SECRET_KEY` to a long random string so stored credentials (AI
> keys, SCM tokens) are actually encrypted. Generate one with
> `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. See the
> [deployment guide](https://piwitests.github.io/deployment).

**2. Add the reporter to your test project**

```bash
npm install --save-dev @piwitests/reporter
```

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['list'],
    ['@piwitests/reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
    }],
  ],
  use: { trace: 'retain-on-failure' },
})
```

**3. Run your tests** — `npx playwright test`. Results appear as they finish; the project is created on
first submission.

**4. Add the capture fixtures** *(recommended)* — one file, and the deeper features light up: locator
healing, slow-endpoint analysis, Web Vitals, console capture, failure-time ARIA snapshots.

```typescript
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test'
import { piwiFixtures } from '@piwitests/reporter'

export const test = base.extend(piwiFixtures)
export { expect }
```

Import `test` from this file in your specs instead of `@playwright/test` — that's the whole change.
Details in the [capture fixtures guide](https://piwitests.github.io/capture-fixtures); a runnable
project lives in [`examples/playwright-fixtures`](./examples/playwright-fixtures).

In CI, set `PIWI_DASHBOARD_URL` (and `PIWI_API_KEY` if auth is on) and you're done — branch, commit, CI
metadata and `--shard` merging are detected automatically. See
[CI & sharding](https://piwitests.github.io/ci).

## A quick tour

| | |
|---|---|
| [![Failure cluster with AI diagnosis](./docs/public/screenshots/failure-cluster.png)](https://piwitests.github.io/ai-diagnosis) | [![AI diagnosis grounded in your SCM diff](./docs/public/screenshots/ai-diagnosis.png)](https://piwitests.github.io/ai-diagnosis) |
| **Failure clusters** — forty red tests, three root causes | **AI diagnosis** — read against your actual git diff |
| [![Flaky test detection](./docs/public/screenshots/flaky-detection.png)](https://piwitests.github.io/flaky-tests) | [![Test run detail with worker timeline](./docs/public/screenshots/test-run.png)](https://piwitests.github.io/ui-overview) |
| **Flaky tests** — scored, classified, ranked by wasted CI time | **Run detail** — cases, worker timeline, traces, retry command |
| [![Locator healing suggestions](./docs/public/screenshots/locator-healing.png)](https://piwitests.github.io/reporter#locator-healing) | [![Performance trends](./docs/public/screenshots/performance-trends.png)](https://piwitests.github.io/flaky-tests#performance) |
| **Locator healing** — replacements from the last passing run | **Performance** — P90 trends and slowest-test tracking |

## Where this fits

Playwright's own HTML report is the right tool for debugging a run on your machine; Piwi is for the runs
you can't open anymore. It's deliberately **Playwright-only** — that's what makes traces, step timing,
and locator healing first-class rather than lowest-common-denominator. If you need one place for JUnit,
pytest and Cypress results too, [ReportPortal](https://reportportal.io) or
[Allure](https://allurereport.org) fit that better. If you'd rather someone else ran the server,
[Currents](https://currents.dev) is the managed option. And if you only ever debug locally and never
look back, you don't need any of this.

The longer version, including where Piwi loses, is in
[Why Piwi?](https://piwitests.github.io/comparison).

## Project status

Pre-1.0 and under active development: expect occasional breaking changes between minor versions, pin a
version tag, and keep backups of `.data/`. Every commit runs a CI matrix across SQLite/PostgreSQL and
local/S3 storage with a full Playwright E2E suite, and upgrades apply database migrations
automatically. Direction and non-goals live in the [roadmap](./ROADMAP.md).

## Documentation

Full docs at **[piwitests.github.io](https://piwitests.github.io)**. The usual entry points:

- [Getting started](https://piwitests.github.io/getting-started) — install, reporter, first run
- [Core concepts](https://piwitests.github.io/concepts) — runs, test cases, executions, clusters
- [Reporter](https://piwitests.github.io/reporter) and [CI & sharding](https://piwitests.github.io/ci) — getting results in
- [Deployment](https://piwitests.github.io/deployment) and [Configuration](https://piwitests.github.io/configuration) — running your instance
- [Privacy & data flow](https://piwitests.github.io/privacy) — exactly what leaves your server (nothing you didn't configure)

A running dashboard also serves interactive API docs at `/docs`, rendered in-app from its own OpenAPI
spec — no external CDN, so they work offline.

## Community & support

- 💬 [Discussions](https://github.com/PiwiTests/platform/discussions) — questions, ideas, show & tell
- 🐛 [Issues](https://github.com/PiwiTests/platform/issues) — bugs and feature requests
- 🔐 [Security policy](./SECURITY.md) — how to report a vulnerability

## Contributing

Contributions are welcome — [CONTRIBUTING.md](CONTRIBUTING.md) covers dev setup, tests, and commit
conventions; [AGENTS.md](AGENTS.md) has the architecture tour.

```bash
cd application && npm install && npm run app:dev   # http://localhost:3000
```

## License

MIT

---

<sub>**Disclaimer:** Piwi Dashboard is **not affiliated with, endorsed by, or connected to Microsoft Corporation** in any way. "Piwi" is a playful, unrelated name with no connection to any existing product or brand. Playwright is a trademark of Microsoft Corporation.</sub>
