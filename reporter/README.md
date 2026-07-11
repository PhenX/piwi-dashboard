# Piwi Dashboard Reporter

A custom Playwright reporter that sends test results to a [Piwi Dashboard](https://piwitests.github.io) server. It handles uploading test results, HTML reports, trace files, and performance metrics — with optional live streaming of results as tests execute.

📖 **[Full documentation](https://piwitests.github.io/reporter)**

## Installation

```bash
npm install --save-dev @piwitests/reporter
```

## Quick start

`wrapConfig` is the recommended setup. It injects the reporter **and** a global
setup step (so the run shows up as "initialising" while your `globalSetup` runs),
and forwards your options to that setup:

```typescript
import { defineConfig } from '@playwright/test'
import { wrapConfig } from '@piwitests/reporter'

export default wrapConfig(
  defineConfig({
    use: {
      trace: 'retain-on-failure',
    },
  }),
  {
    serverUrl: 'http://localhost:3000',
    projectName: 'my-project',
  },
)
```

Run your tests — results are uploaded automatically:

```bash
npx playwright test
```

**Recommended: enable the [capture fixtures](#capture-fixtures)** — one small file unlocks the dashboard's richest features (locator healing, slow-endpoint analysis, Web Vitals, console capture, failure-time ARIA snapshots):

```typescript
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test'
import { piwiFixtures } from '@piwitests/reporter'

export const test = base.extend(piwiFixtures)
export { expect }
```

Import `test` from this file in your specs instead of `@playwright/test` — see [Capture fixtures](#capture-fixtures) below.

Prefer to wire it up by hand? Add the reporter to the `reporter` array instead:

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

## Configuration Options

| Option                      | Type     | Default                   | Description                                                            |
|-----------------------------|----------|---------------------------|------------------------------------------------------------------------|
| `serverUrl`                 | string   | `'http://localhost:3000'` | URL of the Piwi Dashboard server                                       |
| `projectName`               | string   | `'default-project'`       | Name of the project to report results under                            |
| `uploadTraces`              | boolean  | `true`                    | Whether to upload trace files to the dashboard                         |
| `uploadReport`              | boolean  | `true`                    | Whether to upload the HTML report to the dashboard                     |
| `reports`                   | array    | —                         | Additional report types to upload (html, monocart, blob, or custom)    |
| `streaming`                 | boolean  | `true`                    | Enable live streaming of results as tests complete                     |
| `streamingBatchSize`        | number   | `5`                       | Number of test results to batch before sending                         |
| `streamingBatchDelay`       | number   | `2000`                    | Max delay (ms) before flushing pending events                          |
| `projectDescription`        | string   | —                         | Description of the project                                             |
| `environment`               | string   | —                         | Deployment environment for the run, e.g. `production`, `staging`       |
| `relatedIssue`              | string   | —                         | Related issue reference (e.g., "PROJ-123")                             |
| `ciInfo`                    | string   | —                         | CI job information                                                     |
| `tags`                      | string[] | —                         | Tags to categorize the test run                                        |
| `customData`                | object   | —                         | Additional custom metadata as key-value pairs                          |
| `collectScmInfo`            | boolean  | `true`                    | Auto-collect git commit, branch, author                                |
| `collectCiInfo`             | boolean  | `true`                    | Auto-collect CI environment info                                       |
| `collectPerformanceMetrics` | boolean  | `true`                    | Collect step timings, network requests and web vitals from the fixture |
| `apiKey`                    | string   | —                         | API key for authentication (preferred for CI)                          |
| `username`                  | string   | —                         | Username for dashboard login (use `apiKey` instead when possible)      |
| `password`                  | string   | —                         | Password for dashboard login (used with `username`)                    |
| `verbose`                   | boolean  | `false`                   | Enable verbose logging for debugging                                   |

## Live streaming

By default, the reporter streams test results to the dashboard in real-time. This allows you to monitor progress live in the dashboard UI while CI is still running.

To disable streaming and send all results at the end:

```typescript
['@piwitests/reporter', {
  serverUrl: 'http://localhost:3000',
  projectName: 'my-project',
  streaming: false,
}]
```

If the server doesn't support streaming (older versions), the reporter automatically falls back to batch mode.

## Multiple reports

Attach multiple report types to a single test run:

```typescript
export default defineConfig({
  reporter: [
    ['list'],
    ['@playwright/test/reporter-html', { outputFolder: 'playwright-report' }],
    ['monocart-reporter', { name: 'My Tests', outputFile: 'monocart-report/index.html' }],
    ['@piwitests/reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
      reports: [
        { type: 'html' },
        { type: 'monocart' },
        { type: 'blob', dir: 'blob-report', label: 'Blob archive' },
      ],
    }],
  ],
})
```

## Capture fixtures

The reporter works without any test-code changes, but the **capture fixtures** observe your tests from the inside and unlock the dashboard's richest features. Extend your `test` with them:

```typescript
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test'
import { piwiFixtures } from '@piwitests/reporter'

export const test = base.extend(piwiFixtures)
export { expect }
```

Or extend the base `test` in one line with `extendPiwiFixtures`:

```typescript
import { test as base } from '@playwright/test'
import { extendPiwiFixtures } from '@piwitests/reporter'

export const test = extendPiwiFixtures(base)
export { expect } from '@playwright/test'
```

Then import `test` from your fixtures file in every spec — a spec that imports `test` from `@playwright/test` directly still runs and reports fine, it just isn't captured.

> `piwiFixtures` / `extendPiwiFixtures` were named `dashboardFixtures` / `extendDashboardFixtures` in `0.9.x`. The old names still work as deprecated aliases.

### What gets captured

- **Network requests** — method, URL, status, duration, resource type (API/document traffic only). Aggregated on the dashboard into a *Slow API Endpoints* table grouped by `METHOD + normalized route`.
- **Console entries** — `warning`, `error`, and `assert` messages with their source location.
- **Browser Web Vitals** — TTFB, DOM Interactive, DOMContentLoaded, Load Complete, First Paint, First Contentful Paint — displayed with color-coded thresholds.
- **ARIA snapshot** — captured automatically when a test fails, shown as failure evidence and fed to the AI diagnosis.
- **Locator snapshots** — for each acted-on element, its attributes plus ranked alternative locators, stamped with the call site. These power locator healing; when a failing locator matches nothing, a fresh suggestion is attached as a Playwright annotation.

Capture works for the `page` fixture, `browser.newPage()`, `browser.newContext().newPage()`, and popups. Everything is only collected when `collectPerformanceMetrics` is `true` (the default); locator snapshots can be disabled separately with `captureLocators: false`.

Without the fixtures you still get full run history, statuses, errors, traces, reports, streaming, and clustering — the fixtures add the slow-endpoint, Web Vitals, console, ARIA, and locator-healing layers. See the [capture fixtures guide](https://piwitests.github.io/capture-fixtures) for the full feature matrix and composition patterns.

## Authentication

When the dashboard has authentication enabled, use an API key (recommended for CI):

```typescript
['@piwitests/reporter', {
  serverUrl: 'https://your-dashboard.example.com',
  projectName: 'my-project',
  apiKey: process.env.PIWI_API_KEY,
}]
```

Generate a key in the dashboard UI: **Settings → Users → API keys**. Store it as a CI secret.

Alternatively, use `username`/`password` — the reporter will call `/api/auth/login` automatically.

## Automatic Metadata Collection

### SCM Information (Git)

When `collectScmInfo` is enabled (default), the reporter collects:
- Commit hash and message
- Branch name
- Author name
- Remote URL

### CI Information

When `collectCiInfo` is enabled (default), the reporter auto-detects:
- **GitHub Actions** — run ID, workflow, actor, repository, ref, SHA
- **Jenkins** — build number, build URL, job name
- **GitLab CI** — pipeline ID/URL, job ID/URL, job name
- **CircleCI** — build number/URL, job name, workflow
- **Travis CI** — build number/URL, job number
- **Azure Pipelines** — build number, build ID/URL, job name

## How It Works

1. When tests start, the reporter creates a run on the server (streaming mode) or collects results locally (batch mode)
2. As tests complete, results are streamed in batches to the server
3. After all tests finish, HTML reports are compressed and uploaded
4. Trace files from test attachments are uploaded
5. Data from the capture fixtures (network requests, console entries, web vitals, ARIA snapshots, locator snapshots) is included per test case
6. The server stores everything and makes it available in the dashboard UI

## Requirements

- Node.js 18 or higher (the reporter runs inside your test project — the dashboard *server* itself targets Node 24+, or use its Docker image)
- Playwright Test 1.40 or higher
- Running Piwi Dashboard server

## Development

This package is written in TypeScript. Source files live in `src/` and compile to `dist/`.

```bash
cd reporter
npm install
npm run reporter:build   # compile TypeScript src/ → dist/
npm run reporter:dev     # watch mode — auto-recompile on changes
```

### Source layout

The package keeps its **public API** (`src/index.ts`, `src/public/`) separate from internal plumbing (`src/internal/<domain>/`) and the type model (`src/types/`). See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full map — the public/internal split, the collect-and-submit data flow, the fallback ladder, and the conventions.

Everything public — the reporter, config helpers, and the capture fixtures — is exported from the package's single entry point (`@piwitests/reporter`).

## Troubleshooting

### Reporter not uploading files

- Ensure an HTML reporter is configured: `['html', { outputFolder: 'playwright-report' }]`
- Ensure traces are enabled: `use: { trace: 'retain-on-failure' }`
- Check the dashboard server is running and accessible at `serverUrl`

### Fixture data not appearing (network, Web Vitals, console, ARIA, locator healing)

- Extend your `test` with `piwiFixtures` / `extendPiwiFixtures` from `@piwitests/reporter`, and import `test` from your fixtures file in every spec — not from `@playwright/test` directly
- Verify `collectPerformanceMetrics` is not set to `false` (and `captureLocators` for locator healing)
- Ensure tests navigate to at least one page (`await page.goto(...)`)

### Connection errors

- Check that `serverUrl` is correct and the server is running
- Verify network connectivity and firewall settings

## License

MIT
