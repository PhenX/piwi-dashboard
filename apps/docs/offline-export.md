---
title: Offline export
lang: en-US
---

# Offline export

An investigation is only useful while someone can open it. Piwi can write a failing execution or a
whole failure cluster to a file that opens with **no network and no Piwi server** — for a ticket
attachment, a mail to someone without an account, or an archive that outlives your retention window.

The **Export** button sits on a test-case execution (`/test-run-cases/:id`) and on a failure cluster
(`/failure-clusters/:id`).

## Formats

| Format | What you get |
|--------|--------------|
| **HTML** | One file. Screenshots and video are embedded as `data:` URIs; error, steps, console, network, ARIA snapshot, test source and the AI diagnosis are all inline. Double-click it. |
| **ZIP** | `report.html` plus the raw artifacts on disk — full-size video, reconstructed `trace.zip` archives, console and network logs — and `data.json` with everything the report shows, machine-readable. |
| **PDF** | The HTML report opened with your browser's print dialog. Video and traces cannot survive printing; everything else does. |
| **Markdown / JSON** | Text only, for pasting into an issue or feeding an agent. |

A cluster export carries the most recent failing execution of each affected test.

## What an export leaves out, and why it tells you

Exports are bounded so one download cannot exhaust the server:

| Variable | Default | Bounds |
|---|---|---|
| `PIWI_EXPORT_MAX_INLINE_BYTES` | 8 MB | What a single HTML file will embed as a `data:` URI. Larger files stay out of the one-file HTML; the ZIP still carries them at full size. |
| `PIWI_EXPORT_MAX_BYTES` | 500 MB | The whole export. Evidence is added largest-last until the budget is reached. The archive is built in memory, so this also bounds what one export costs the server. |
| `PIWI_EXPORT_MAX_CASES` | 25 | Member executions carrying full evidence in a cluster export. Remaining affected tests are listed by name. |

Anything left out is listed in an **Omitted from this export** table in the report and in the ZIP's
`README.txt` — an export never drops evidence silently. Defaults and tuning:
[Configuration](./configuration#offline-export).

## Opening a hostile report safely

The exported HTML carries a restrictive `Content-Security-Policy` and escapes every value that came
from a test run, so a report is safe to open even when the failure it describes involved hostile page
content.

## Reading an exported trace

The ZIP carries reconstructed `trace.zip` archives, but reading one still needs a Playwright trace
viewer — `npx playwright show-trace trace.zip`, or the [bundled viewer](./evidence#trace-viewer) on any
Piwi instance. Bundling the viewer's assets into the export itself is on the
[roadmap](https://github.com/PiwiTests/platform/blob/main/ROADMAP.md).

## See also

- [Failure evidence](./evidence) — what the export is a snapshot of
- [AI diagnosis & clustering](./ai-diagnosis) — cluster exports carry the diagnosis too
- [Storage configuration](./storage#data-retention) — retention, and why an export outlives it
