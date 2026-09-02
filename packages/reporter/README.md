# Piwi Dashboard Reporter

A custom Playwright reporter that sends test results to a [Piwi Dashboard](https://piwitests.dev) server. It handles uploading test results, HTML reports, trace files, and performance metrics — with optional live streaming of results as tests execute.

📖 **[Full documentation](https://piwitests.dev/reporter)**

## Installation

```bash
npm install --save-dev @piwitests/reporter
```

## Set up in one command

From your Playwright project, `npx @piwitests/reporter init` installs the reporter, wraps your `playwright.config`, creates the capture-fixtures file, and records the connection in `.env.example`:

```bash
npx @piwitests/reporter init --server-url http://localhost:3000 --project my-project
```

Every step is idempotent (safe to re-run); a config shape it will not rewrite is reported as `manual` with the exact change to make, never mangled. Add `--dry-run` to preview or `--json` for a machine-readable plan an agent can act on. It also installs the [Piwi agent skills](https://piwitests.dev/mcp#agent-skills) so your coding agent can investigate failures, heal locators, and stabilize flaky tests. Run `npx @piwitests/reporter init --help` for all options, or wire it up by hand with the steps below.

> The package is `@piwitests/reporter`; its command is `piwi`. Invoke it through the package name (`npx @piwitests/reporter <command>`) so npx resolves this package — `npx piwi` would fetch an unrelated `piwi` from npm. Once the reporter is a project dependency, `npx piwi <command>` resolves the local binary and works too.

## Quick start

`wrapConfig` is the recommended setup. It injects the reporter **and** a global
setup step (so the run shows up as "initializing" while your `globalSetup` runs),
and forwards your options to that setup:

```typescript
import { defineConfig } from '@playwright/test'
import { wrapConfig } from '@piwitests/reporter'

export default wrapConfig(
  defineConfig({
    use: {
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
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
    screenshot: 'only-on-failure',
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
| `outputFile`                | string   | —                         | Write a JSON file with the run URL/id/status so CI can consume it (see below) |
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

### What gets captured

- **Network requests** — method, URL, status, duration, resource type (API/document traffic only). Aggregated on the dashboard into a *Slow API Endpoints* table grouped by `METHOD + normalized route`.
- **Console entries** — `warning`, `error`, and `assert` messages with their source location.
- **Browser Web Vitals** — TTFB, DOM Interactive, DOMContentLoaded, Load Complete, First Paint, First Contentful Paint — displayed with color-coded thresholds.
- **ARIA snapshot** — captured automatically when a test fails, shown as failure evidence and fed to the AI diagnosis.
- **Locator snapshots** — for each element a test proves resolvable (successful actions and passing `expect(locator)` assertions alike), its attributes plus ranked alternative locators, stamped with the call site. These power locator healing; when a failing locator matches nothing, a fresh suggestion is attached as a Playwright annotation.

Capture works for the `page` fixture, `browser.newPage()`, `browser.newContext().newPage()`, and popups. Everything is only collected when `collectPerformanceMetrics` is `true` (the default); locator snapshots can be disabled separately with `captureLocators: false`.

Without the fixtures you still get full run history, statuses, errors, traces, reports, streaming, and clustering — the fixtures add the slow-endpoint, Web Vitals, console, ARIA, and locator-healing layers. See the [capture fixtures guide](https://piwitests.dev/capture-fixtures) for the full feature matrix and composition patterns.

## AI steps

Locate elements and drive flows in plain English, without giving up determinism:

```typescript
await page.piwiLocator('the email address field').fill('ada@example.com')
await page.piwiRun('sign in as {email}', { email: 'ada@example.com' })
```

The LLM is a **compiler, not a runtime**: each prompt is resolved **once** by an agent into a committed, deterministic JSON artifact, and every run after that replays that artifact with plain Playwright — **zero LLM calls and zero network** in the default `replay` mode. Add it by composing `extendPiwiAi` over your test:

```typescript
import { extendPiwiFixtures, extendPiwiAi } from '@piwitests/reporter'
export const test = extendPiwiAi(extendPiwiFixtures(base))
```

Author missing entries once in `resolve` mode (`PIWI_AI=resolve`, pointed at a dashboard with an AI provider configured), commit the artifacts, and CI replays them offline. `{param}` placeholders are type-checked and masked out of everything sent to the model. Manage the committed entries with `piwi ai check | resolve | prune`.

See the [AI steps guide](https://piwitests.dev/ai-steps) for the authoring/replay lifecycle, the safety model (allowlisted, drift-guarded, postcondition-verified), and the full option/env-var reference.

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

## Publishing the run URL to CI

After a run is submitted, the reporter surfaces the dashboard run URL so a later
CI step (a custom email, a Slack message, a deploy gate) can pick it up without
scraping the log. The URL is always printed as `View run: <url>`, preceded by
one `✗ <title> — <headline> → <url>` line per failed test: a one-line
explanation of the failure (`getByLabel('Email address') was not found on the
page — fill timed out after 10 s`) and a link straight to that execution on the
dashboard, printed the moment the test's final attempt fails (in streaming
mode, before the run is over). In addition:

- **Any CI — JSON output file.** Set `outputFile` (or `PIWI_OUTPUT_FILE`) and the
  reporter writes a small JSON file when the run lands:

  ```json
  { "runUrl": "https://piwi.example.com/test-runs/1234", "runId": 1234, "projectId": 5, "projectName": "checkout", "status": "passed", "ciBuildUrl": "https://ci.example.com/build/9", "failedCount": 0, "failures": [] }
  ```

  `failures` lists every test whose final attempt failed as
  `{ title, file, retry, browser, url }`.

  Read it from any pipeline, e.g. `node -e "console.log(require('./piwi-run.json').runUrl)"`
  (portable) or `cat piwi-run.json` and parse it in your email step. In Jenkins,
  `def run = readJSON file: 'piwi-run.json'` then use `run.runUrl`.

- **GitHub Actions (automatic).** When `GITHUB_ACTIONS` is set, the reporter
  appends step outputs to `$GITHUB_OUTPUT` (`piwi_run_url`, `piwi_run_id`,
  `piwi_project_id`, `piwi_run_status`, `piwi_failed_count`), writes a markdown
  link plus the failed tests with their links to the job summary (20 at most,
  the rest counted), and prints a `::notice::` annotation. Give the test step an
  `id` and a downstream step can read it:

  ```yaml
  - id: tests
    run: npx playwright test
  - run: echo "Results at ${{ steps.tests.outputs.piwi_run_url }}"
  ```

- **GitLab CI (automatic).** When `GITLAB_CI` is set, the reporter writes a
  dotenv report (`piwi.env` by default, override with `PIWI_DOTENV_FILE`)
  carrying `PIWI_RUN_URL`, `PIWI_RUN_ID`, `PIWI_RUN_STATUS`, `PIWI_FAILED_COUNT`,
  `PIWI_PROJECT_ID` and `PIWI_CI_BUILD_URL`. Declare it so later jobs inherit
  `$PIWI_RUN_URL`:

  ```yaml
  test:
    script: npx playwright test
    artifacts:
      reports:
        dotenv: piwi.env
  email:
    needs: [test]
    script: ./send-email.sh "$PIWI_RUN_URL"
  ```

## How It Works

1. When tests start, the reporter creates a run on the server (streaming mode) or collects results locally (batch mode)
2. As tests complete, results are streamed in batches to the server
3. After all tests finish, HTML reports are compressed and uploaded
4. Trace files from test attachments are uploaded
5. Data from the capture fixtures (network requests, console entries, web vitals, ARIA snapshots, locator snapshots) is included per test case
6. The server stores everything and makes it available in the dashboard UI

## Requirements

- Node.js 18 or higher (the reporter runs inside your test project — the dashboard *server* itself targets Node 22+, or use its Docker image)
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
- Ensure screenshots are enabled: `use: { screenshot: 'only-on-failure' }` — Playwright's default is `'off'`
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
