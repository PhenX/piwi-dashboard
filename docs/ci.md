---
title: CI & sharding
lang: en-US
---

# CI & sharding

CI is where Piwi earns its keep — it's the place your results were disappearing from. There is no
Piwi-specific step to add: the reporter runs inside `npx playwright test` and pushes results as they
happen. In practice you set two environment variables.

```yaml
env:
  PIWI_DASHBOARD_URL: https://piwi.example.com
  PIWI_API_KEY: ${{ secrets.PIWI_API_KEY }}   # only if authentication is enabled
```

Everything else — branch, commit, author, workflow, build URL, shard index — is
[detected automatically](#what-gets-detected).

## GitHub Actions

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

`actions/checkout` fetches a shallow clone by default. That's fine for the commit metadata Piwi
records, but [AI diagnosis](./ai-diagnosis) reads the diff since the last green run from your git host
over the API, not from the checkout — so no `fetch-depth` change is required.

## GitLab CI

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

## Other systems

Jenkins, CircleCI, Azure DevOps, Travis, Buildkite, TeamCity, Bitbucket, Semaphore, AppVeyor and Drone
are recognized too — set the same two variables however your system exposes them. Nothing about the
reporter is platform-specific; unrecognized CI just means less auto-filled metadata.

## What gets detected

Without any configuration, the reporter records:

- **Source control** — commit SHA, message, author, branch, and the repository URL, read from the local
  git checkout.
- **CI** — provider, workflow/job name, build number, and a link back to the CI build, from the
  provider's environment variables.
- **Environment** — Node, Playwright and OS versions, plus each test's browser and viewport.
- **Shard index** — from Playwright's own `--shard` config.

Turn off either collector with `collectScmInfo: false` / `collectCiInfo: false` if you'd rather not
store it.

## Sharding

Playwright's `--shard=1/3` splits a suite across parallel jobs. Piwi merges them back into **one run**
— you shouldn't have to think about shards when reading results.

```yaml
strategy:
  matrix:
    shard: [1, 2, 3]
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}/3
    env:
      PIWI_DASHBOARD_URL: https://piwi.example.com
      PIWI_API_KEY: ${{ secrets.PIWI_API_KEY }}
```

How the merge works:

1. Each shard derives a **run label** — a stable identifier for the CI pipeline — from environment
   variables (`GITHUB_RUN_ID`, `CI_PIPELINE_ID`, `CIRCLE_WORKFLOW_ID`, `TRAVIS_BUILD_ID`,
   `BUILD_BUILDID`, `BUILD_ID`, `BUILDKITE_BUILD_ID`, `TEAMCITY_BUILD_ID`, `BITBUCKET_BUILD_NUMBER`,
   `SEMAPHORE_WORKFLOW_ID`, `APPVEYOR_BUILD_ID`, `DRONE_BUILD_NUMBER`).
2. Shards sharing a run label **and** a `projectName` resolve to the same run.
3. Each shard streams independently; the run stays `running` until the **last** shard calls finish.
4. Counters accumulate across shards. The run is `failed` if any shard reported a failure.
5. The run detail page shows a shard progress badge (`2/3`) while shards are still arriving.

**All shards must use the same `projectName`.** That's the one requirement.

If your CI isn't detected, set the label yourself to anything common to all shards:

```typescript
['@piwitests/reporter', {
  serverUrl: 'https://piwi.example.com',
  projectName: 'my-project',
  runLabel: process.env.BUILD_TAG || 'my-custom-label',
}]
```

Both the streaming and the batch (`submit` / `upload`) paths support sharding.

## Watching a run while CI is still going

Streaming is on by default: the run appears in the dashboard when the suite starts and fills in test by
test, with traces and attachments uploaded per test as they finish. You can open a failure and start
reading the trace before the pipeline is done. See [Reporter → Live streaming](./reporter#live-streaming)
to tune batch size or turn it off.

## Getting the run URL back out of CI

After results land, the reporter surfaces the dashboard run URL wherever a pipeline can pick it up, so
a later step (a Slack post, a deploy gate, a PR comment) doesn't have to scrape stdout. All of it is
best-effort — a failure in any channel is logged and never fails your run.

**Always** — a `View run: <url>` line in the log.

**GitHub Actions (automatic)** — step outputs, a job-summary link, and a `::notice::` annotation:

```yaml
- run: npx playwright test
  id: e2e
  env:
    PIWI_DASHBOARD_URL: https://piwi.example.com
- run: echo "Results: ${{ steps.e2e.outputs.piwi_run_url }}"
  if: always()
```

Available outputs: `piwi_run_url`, `piwi_run_id`, `piwi_run_status`, `piwi_project_id`.

**GitLab CI (automatic)** — a dotenv report (`piwi.env` by default, override with `PIWI_DOTENV_FILE`)
carrying `PIWI_RUN_URL`, `PIWI_RUN_ID`, `PIWI_RUN_STATUS`, `PIWI_PROJECT_ID` and `PIWI_CI_BUILD_URL`.
Declare it so later jobs inherit the variables:

```yaml
e2e:
  script:
    - npx playwright test
  artifacts:
    reports:
      dotenv: piwi.env
```

**Any other system** — set `outputFile` (or `PIWI_OUTPUT_FILE`) and read the JSON:

```yaml
- run: npx playwright test
  env:
    PIWI_OUTPUT_FILE: piwi-run.json
- run: cat piwi-run.json   # { runUrl, runId, projectId, projectName, status, ciBuildUrl }
```

## Notifying people instead

If all you want is "tell the team when main goes red", you don't need any of the above — configure a
[notification subscription](./notifications) on the dashboard side and let it push to Slack, email, or
a webhook. That keeps the alerting rules in one place instead of in every pipeline.

## Troubleshooting

**Results don't appear.** Check the CI log for the reporter's own output; run with `PIWI_VERBOSE=true`
for the full request trace. The usual causes are an unreachable `PIWI_DASHBOARD_URL` from the runner's
network, or a missing API key against an instance with authentication enabled.

**Shards create several runs instead of one.** The run label wasn't detected, or the shards disagree on
`projectName`. Set `runLabel` explicitly.

**Traces are missing.** Traces have to be recorded before they can be uploaded — set
`use: { trace: 'retain-on-failure' }` (or `'on-first-retry'`) in your Playwright config.

**A run is stuck as `interrupted`.** A live reporter heartbeats every ~15s; when a run goes quiet for
two minutes — a cancelled job, an OOM-killed runner, a dropped network — the server marks it
`interrupted` rather than leaving it `running` forever. If the reporter comes back (a long test, a
transient blip) the next event revives the run automatically, so `interrupted` is only final when the
job really died. Those runs are excluded by the **full runs only** filter in
[Analytics](./analytics#scope).

## See also

- [Reporter](./reporter) — every option, streaming, and locator healing
- [Authentication](./authentication) — creating the API key CI uses
- [Concepts → Test run](./concepts#test-run) — why shards are one run
- [Notifications](./notifications) — alerting without touching the pipeline
