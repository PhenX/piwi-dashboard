---
title: Importing past runs
lang: en-US
---

# Importing past runs

Piwi's analysis gets better the more history it has: flaky detection needs repeated executions, failure clusters need
several failures to group, and trend charts need runs to plot. A team adopting Piwi starts with none of that.

If you already run Playwright in CI, you can backfill it. Playwright's **blob reporter** writes a complete, replayable
record of a run — results, steps, errors, traces, screenshots and videos — and Piwi imports those archives as finished
runs.

## Producing the archives

Run your suite with the blob reporter:

```bash
npx playwright test --reporter=blob
```

It writes `blob-report/report.zip` (or `blob-report/report-<n>.zip` per shard). Those `.zip` files are what you upload —
one archive per run.

If you already keep blob reports as CI artifacts, download them; there is nothing to re-run.

The blob format is internal to Playwright and versioned. Piwi reads versions **1 and 2**, which covers every Playwright
release to date. An archive written in a format a given Piwi build does not know is refused outright, with the version
in the message — never imported half-understood.

::: tip
Piwi only reads blob reports — not HTML reports, JSON reporter output, or bare `trace.zip` files. The blob report is
the only Playwright artifact that carries a whole run's results *and* its attachments in one file.
:::

## Importing them

Open the project, click **Import** in the page header, then drop the archives on the page (or pick them with **Choose
files**).

Before anything uploads, the page checks each archive and tells you where it stands:

| Verdict | Meaning |
|---|---|
| **Ready** | New to this project — it will be imported. |
| **Already imported** | This exact archive is already in the project. Skipped, with a link to the run. |
| **Too large** | Bigger than this server accepts. Nothing is uploaded. |
| **Not importable** | Not a `.zip`, or empty. |

Click **Import N archives** to upload the ready ones, one at a time, with a progress bar each. Nothing is uploaded that
the server would have rejected, and nothing that is already there is uploaded twice.

Importing is **idempotent**: an archive is identified by the SHA-256 of its bytes, so re-uploading one changes nothing.
An interrupted batch is safe to simply repeat.

## What imported runs carry

Everything Playwright itself recorded comes across:

- Test results — status, duration, timeout, retries, worker, start time, annotations
- Suite structure — spec file, `describe` nesting, Playwright project (browser) name
- Errors, with full call logs, so failures **cluster exactly like reported ones**
- Steps, including the slowest step and wasted-time totals
- Traces, screenshots and videos — the trace viewer, call stack, network and DOM snapshot views all work
- The failure-time page snapshot and source snippet, recovered from Playwright's `error-context` attachment
- Browser console entries, recovered from the trace

What Playwright never recorded cannot be recovered. Web vitals, page state and locator healing come from
[Piwi's own capture fixtures](./capture-fixtures), so historical runs have none — those start once the reporter is
installed.

Imports are also deliberately **silent**: they never send notifications, never trigger AI diagnosis, and never compute
regression signals. Backfilling a year of history should not page your team about failures they fixed months ago, or
label an old failure a new regression.

## Making history line up

Imported runs only join your existing history when the spec paths match. Piwi records paths the same way the reporter
does — relative to the directory holding your Playwright config — and the import summary lists them so you can check:

```
Spec files recorded as (these must match the paths your live runs report for history to line up):
  tests/checkout.spec.ts
```

If those look different from the paths on your existing test cases, the archive was produced from a different working
directory, and the imported executions will land on separate test cases.

## Size limits

Each archive is uploaded whole, so it must fit under the server's limit — **500 MB** by default. The import page shows
the effective limit and rejects anything larger before uploading it.

If a reverse proxy in front of Piwi enforces a smaller body limit, set
[`PIWI_IMPORT_MAX_BYTES`](./configuration#ingest-limits) to match, so the page rejects the same archives your proxy would
instead of failing mid-upload.

## Limitations

- **Sharded runs import separately.** An archive that is one shard of a larger run becomes its own run in Piwi — shards
  are not merged. The import summary flags this when it detects one.
- **Administrators only.** Importing can create projects and back-dates history, so it is not open to the reporter role.
- **One archive per request.** There is no bulk endpoint; the page handles batching for you.
