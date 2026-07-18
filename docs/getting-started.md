---
title: Getting started
lang: en-US
---

# Getting started

## What is Piwi Dashboard?

Piwi Dashboard is a self-hosted observability platform for [Playwright](https://playwright.dev) end-to-end tests. It replaces ephemeral CI reports with a permanent, searchable history — then goes further with live streaming, failure clustering, AI diagnosis, and cross-run analytics.

**Key benefits:**
- See test health trends across hundreds of runs with cross-run analytics
- Stream results live from CI — investigate failures before the suite finishes
- Failure clustering groups tests sharing the same root cause automatically
- AI diagnosis analyzes clusters with full SCM diff context
- Store HTML reports and trace files permanently for later debugging
- Track performance regressions with avg/P90 duration charts
- Self-hosted and open-source — your data stays on your infrastructure

## Requirements

- **Node.js 24+** — only for running the dashboard **from source** (CI and the Docker image both use Node 24). With Docker, your test project just needs a Node version supported by Playwright
- **npm** — for package management
- **PostgreSQL 14+** — optional; required only when using the PostgreSQL backend

## Quick start with Docker

The fastest way to get started is with the pre-built container image:

::: code-group

```bash [Linux / macOS]
docker pull phenx/piwitests-server:latest
mkdir -p .data && chown -R 1001:1001 .data # the container runs as non-root UID 1001
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data phenx/piwitests-server:latest
```

```powershell [Windows (PowerShell)]
docker pull phenx/piwitests-server:latest
docker run -p 3000:3000 -v ${PWD}/.data:/app/.data phenx/piwitests-server:latest
```

:::

Visit `http://localhost:3000` to access the dashboard.

> **Linux hosts:** the container runs as non-root UID 1001, so without the `chown` above, Docker auto-creates `.data` owned by `root` and the container can't write to it. Windows and macOS (Docker Desktop) don't need this step. See [Permission issues with volumes](./deployment#permission-issues-with-volumes) if you hit a permission error.

See [Deployment](./deployment) for detailed Docker, Docker Compose, PostgreSQL, and Kubernetes options.

## Running from source

```bash
# Clone the repository
git clone https://github.com/PiwiTests/platform.git
cd platform/application

# Install dependencies
npm install

# Start the development server
npm run app:dev
```

The dashboard will be available at `http://localhost:3000`.  
The SQLite database is automatically created on the first API call.

> The repository is an npm-workspaces monorepo, so the application scripts are prefixed `app:` (e.g. `app:dev`, `app:build`). Run them from the `application/` directory.

## Using the Piwi Dashboard reporter

The recommended way to integrate is via the custom reporter package — it handles uploading results, HTML reports, and trace files automatically.

Install it:

```bash
npm install --save-dev @piwitests/reporter
```

Then add it to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['list'],
    ['@piwitests/reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
    }],
  ],
  use: {
    trace: 'retain-on-failure',
  },
})
```

Run your tests and results will appear in the dashboard:

```bash
npx playwright test
```

See the [Reporter](./reporter) page for the full configuration reference, including live streaming, multiple report types, performance metrics, and authentication.

### Recommended: capture fixtures

One small file unlocks the dashboard's richest features — locator healing, the slow-endpoints table, Web Vitals, console capture, and failure-time ARIA snapshots:

```typescript
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test'
import { piwiFixtures } from '@piwitests/reporter'

export const test = base.extend(piwiFixtures)
export { expect }
```

Then import `test` from this file in your specs instead of `@playwright/test`:

```typescript
import { test, expect } from './fixtures'
```

The reporter works fine without this — see the [capture fixtures guide](./capture-fixtures) for exactly what the fixtures add, composition patterns, and troubleshooting.

Prefer starting from something runnable? [`examples/playwright-fixtures`](https://github.com/PiwiTests/platform/tree/main/examples/playwright-fixtures) is a complete working project — a small instrumented Nitro app plus a Playwright suite exercising every capture path, including [backend logs](./backend-logs) and an intentional failure that lights up locator healing.

## Submitting via the REST API (optional)

Not using Playwright, or piping results in from another tool? Submit runs directly over HTTP — this is what the reporter itself does under the hood.

::: code-group

```bash [Linux / macOS]
curl -X POST http://localhost:3000/api/test-runs/submit \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "my-project",
    "status": "passed",
    "startTime": "2024-01-01T12:00:00Z",
    "duration": 120000,
    "totalTests": 2,
    "passedTests": 1,
    "failedTests": 1,
    "skippedTests": 0,
    "testCases": [
      {
        "title": "should login successfully",
        "status": "passed",
        "duration": 1500,
        "location": "tests/login.spec.ts:10:5",
        "retries": 0
      },
      {
        "title": "should handle errors",
        "status": "failed",
        "duration": 2300,
        "location": "tests/errors.spec.ts:5:5",
        "error": "Expected true but got false",
        "retries": 1
      }
    ]
  }'
```

```powershell [Windows (PowerShell)]
$body = @{
  projectName  = 'my-project'
  status       = 'passed'
  startTime    = '2024-01-01T12:00:00Z'
  duration     = 120000
  totalTests   = 2
  passedTests  = 1
  failedTests  = 1
  skippedTests = 0
  testCases    = @(
    @{ title = 'should login successfully'; status = 'passed'; duration = 1500; location = 'tests/login.spec.ts:10:5'; retries = 0 }
    @{ title = 'should handle errors'; status = 'failed'; duration = 2300; location = 'tests/errors.spec.ts:5:5'; error = 'Expected true but got false'; retries = 1 }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/test-runs/submit `
  -ContentType 'application/json' -Body $body
```

:::

The project `my-project` is created automatically if it doesn't exist yet. See the [API docs](https://piwitests.github.io/demo/docs) for the full endpoint reference (or `/docs` on your own instance).

## Running in CI

Nothing Piwi-specific is required in CI — the reporter runs inside `npx playwright test` and pushes results to your dashboard. Point the reporter at your deployed instance (via the `PIWI_DASHBOARD_URL` env var or the `serverUrl` option) and pass an API key if [authentication](./authentication) is enabled. CI metadata (workflow, branch, commit, run URL) and [shard merging](./reporter#sharding) are detected automatically on GitHub Actions, GitLab CI, Jenkins, CircleCI, Azure DevOps, and more.

**GitHub Actions:**

```yaml
name: e2e
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
        env:
          PIWI_DASHBOARD_URL: https://piwi.example.com
          PIWI_API_KEY: ${{ secrets.PIWI_API_KEY }}
```

**GitLab CI:**

```yaml
e2e:
  image: mcr.microsoft.com/playwright:v1.54.0-noble
  script:
    - npm ci
    - npx playwright test
  variables:
    PIWI_DASHBOARD_URL: https://piwi.example.com
    PIWI_API_KEY: $PIWI_API_KEY
```

With live streaming enabled you can watch the run progress in the dashboard while CI is still executing — see [Reporter → Streaming](./reporter#live-streaming).

## Dashboard navigation

After submitting results, the dashboard provides:

| Page | Purpose |
|------|---------|
| **Home** (`/`) | Overview stats, test trend chart, and quick access to recent projects |
| **Projects** (`/projects`) | Searchable table of all projects with status, duration, and tag filters |
| **Project detail** (`/projects/:id`) | Run history for a project, with tabs for failure clusters, flaky tests, performance, spec health, and run comparison |
| **Test run** (`/test-runs/:id`) | Individual test cases with status, errors, traces, insights, failure groups, worker timeline, and reports |
| **Test case** (`/test-cases/:id`) | Detailed view of a single test including steps, web vitals, and network data |
| **API Docs** (`/docs`) | Interactive API reference with endpoint documentation, schemas, and try-it console (auto-generated) |
| **Settings** (`/settings`) | Account, users, storage, tags, wasted-time patterns, AI diagnosis, and notifications |

See the [UI overview](./ui-overview) for a full map of every page and tab.

## Development commands

Run these from the `application/` directory:

| Command | Description |
|---------|-------------|
| `npm run app:dev` | Start development server with hot reload |
| `npm run app:build` | Build for production |
| `npm run app:preview` | Preview the production build locally |
| `npm run app:typecheck` | TypeScript type checking |
| `npm run app:lint` | Run oxlint (`app:lint:fix` to auto-fix) |
| `npm run app:test:unit` | Run unit tests (Vitest) |
| `npm run app:test` | Run Playwright end-to-end tests |
| `npm test` | Run both unit and end-to-end tests |
| `npm run db:generate` | Generate SQLite migration from schema changes |
| `npm run db:generate:pg` | Generate PostgreSQL migration from schema changes |
| `npm run db:studio` | Open Drizzle Studio to browse the SQLite database |
| `npm run db:studio:pg` | Open Drizzle Studio to browse the PostgreSQL database |
| `npm run app:seed:demo` | Regenerate demo seed data for the live demo |

> **Migration workflow:** edit `server/database/schema.sqlite.ts` (and `schema.pg.ts` for the PostgreSQL equivalent — `schema.ts` is just a dialect-selecting re-export, don't edit it) → run `npm run db:generate` (SQLite) or `npm run db:generate:pg` (PostgreSQL) → review the generated `.sql` file → restart the app. Never create migration files or edit `meta/_journal.json` by hand — the Drizzle migrator depends on the journal to track which migrations have been applied, and manual entries cause it to silently skip the migration.
