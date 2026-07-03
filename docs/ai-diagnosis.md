---
title: AI diagnosis & failure clustering
lang: en-US
---

# AI diagnosis & failure clustering

When a run finishes, Piwi groups related failures and — optionally — asks an LLM to explain them. The two features work together: clustering decides *what* to diagnose, AI diagnosis explains *why* it broke.

## Failure clustering

Failed test cases that share the same **error fingerprint** are grouped into a cluster automatically. Instead of scrolling through 20 unrelated stack traces, you see something like *"20 failures, 3 root causes."*

- **Fingerprinting** normalizes error messages so that the same underlying failure groups together across tests, spec files, and runs. Volatile fragments are masked out: timeouts and other numbers, UUIDs and hashes, URLs and emails, and both the *expected* and *received* values of an assertion. Dynamic locator options (e.g. the `{ name: '…' }` of a table row) are masked too, so per-row failures collapse into one cluster — while the locator target itself (the test id / role) still distinguishes genuinely different failures.
- Fingerprints are **call-site agnostic**: the failing stack frame is shown for context but doesn't split clusters, so one root cause reached from several spec files stays a single cluster.
- The run detail page shows each failure group with **flaky** and **worker-correlation** heuristics, so you can tell "the app is broken" from "worker 3 is misbehaving."
- Every cluster has its own **detail page** with the affected tests, triage tools (status + notes), and the AI diagnosis panel.

Clustering is always on and requires no configuration. When the normalization algorithm is improved, existing clusters are migrated in place (re-fingerprinted from a stored sample error), so triage status, notes, and diagnoses survive the change. AI diagnosis is opt-in.

### Semantic merging (optional)

If an **embedding** model role is configured (Settings → AI), Piwi adds a semantic layer on top of the deterministic fingerprint. After a run, the clusters first seen in it are embedded and compared (cosine similarity) against the project's other open clusters; near-duplicates above `PIWI_CLUSTER_SIMILARITY_THRESHOLD` (default `0.92`) are merged into the longest-lived cluster. This catches failures that are the same root cause but phrased differently enough to dodge the fingerprint. Merges record a fingerprint alias so future occurrences attach to the survivor instead of re-forking. With no embedding role configured, clustering stays purely deterministic.

When auto-diagnose is enabled, new clusters are also given a short **human-readable title** (one cheap batched model call per run) shown in place of the raw normalized signature across the lists and the cluster page — the signature stays available on hover and below the title. Clusters fall back to the signature when no title has been generated.

Pairs that fall in the **ambiguous band** (similarity between `PIWI_CLUSTER_SUGGEST_THRESHOLD`, default `0.80`, and the merge threshold) aren't merged automatically. If a **research** model is configured it adjudicates the pair ("same root cause?") and merges only on a high-confidence yes; otherwise — or when it's unsure — the pair becomes a **merge suggestion** on the project's Failure clusters tab, where a reporter or admin approves (merge) or dismisses it. Adjudication is budget-capped per run to control cost.

## Enabling AI diagnosis

Configure a provider via **Settings → AI**, or with environment variables (env always takes precedence over values stored through the UI, and the UI shows env-managed fields read-only).

| Variable | Description |
|----------|-------------|
| `PIWI_AI_PROVIDER` | `anthropic` or `openai` |
| `PIWI_AI_API_KEY` | Provider API key (stored encrypted when set via the UI; never returned by the API) |
| `PIWI_AI_MODEL` | Model name (default: `claude-opus-4-8` for Anthropic) |
| `PIWI_AI_BASE_URL` | Base URL for OpenAI-compatible providers (e.g. Ollama, LM Studio, vLLM) |
| `PIWI_AI_AUTO_DIAGNOSE` | `true` to automatically diagnose new clusters when a run finishes |
| `PIWI_AI_RESEARCH_MODEL` / `_PROVIDER` / `_BASE_URL` / `_API_KEY` | Optional **research** model for two-stage diagnosis; provider/base URL/key default to the main ones |
| `PIWI_AI_EMBEDDING_PROVIDER` / `_MODEL` / `_BASE_URL` / `_API_KEY` | Optional **embedding** model for semantic failure clustering (OpenAI-compatible only — Anthropic has no embeddings API) |

`GET /api/ai/status` reports whether AI is configured (without ever exposing the key); the UI uses it to show or hide AI actions.

### Streaming diagnosis

Instead of waiting for a synchronous response, the diagnosis can be **streamed** via SSE (Server-Sent Events) — the model's reasoning tokens appear in the UI as they arrive:

- **`POST /api/failure-clusters/[id]/diagnose/stream`** — same request body as the synchronous endpoint, but the response is a `text/event-stream` with `event: thinking` chunks containing incremental text, then a final `event: result` with the complete diagnosis.
- The client uses `fetch()` with `POST` (not `EventSource`) so it can send request body params (additional context, images, base commit, etc.). The response body is read as a `ReadableStream` and parsed for SSE messages.
- See the [API docs](https://piwitests.github.io/demo/docs) for the exact protocol (the in-app Scalar UI at `/docs` shows the same spec).
- In the UI, the live thinking panel shows the accumulating text with a stage indicator and auto-scroll. When the stream completes, the panel transitions to the full result card.

### Model roles

Piwi calls models in up to three distinct roles, each with its own complete provider configuration (or a **reuse** pointer to inherit another role's provider and credentials):

- **Diagnosis** — the main model that writes the final diagnosis (required to enable AI).
- **Research** — an optional cheaper/faster model that pre-analyzes the failure first (*two-stage diagnosis*).
- **Embedding** — an optional embeddings model that powers semantic failure clustering.

Configure each role in **Settings → AI → Model providers**. A role set to *reuse* another role uses that role's provider, key, and base URL — only its model can differ — so you don't re-enter credentials for, say, a Haiku research pass on the same Anthropic key.

### Providers

**Anthropic (recommended)**

```bash
PIWI_AI_PROVIDER=anthropic
PIWI_AI_API_KEY=sk-ant-...
PIWI_AI_MODEL=claude-opus-4-8
```

**OpenAI**

```bash
PIWI_AI_PROVIDER=openai
PIWI_AI_API_KEY=sk-...
PIWI_AI_MODEL=gpt-4o
```

**OpenAI-compatible / local (Ollama, etc.)** — set `provider` to `openai` and point `base URL` at the local endpoint:

```bash
PIWI_AI_PROVIDER=openai
PIWI_AI_BASE_URL=http://localhost:11434/v1
PIWI_AI_MODEL=llama3.1
PIWI_AI_API_KEY=ollama   # any non-empty value for local servers
```

Use **Settings → AI → Test** to smoke-test the configured provider.

## What a diagnosis contains

A diagnosis is grounded in your actual run — it is not a generic "ask AI" button. Each result includes:

- **Category** and **confidence**
- **Root cause** — the most likely explanation
- **Evidence** — the signals the model relied on
- **Suggested fix** and **prevention tips**

## SCM-grounded context

The real power is feeding the model the code that changed. On a cluster page you can:

- **Pin a baseline commit** — the diagnosis includes the aggregate diff between that commit and the run, so the model sees what changed.
- **Browse and cherry-pick commits** — add the full diff of specific commits to the context for targeted analysis.
- **Preview the exact context** that will be sent before running (`GET /api/failure-clusters/[id]/context`), so there are no surprises about what leaves your server.

### Commit selection algorithm

When you trigger a diagnosis, Piwi determines the commit range to diff using the following priority chain:

1. **Manual override** — if you pinned a baseline commit (or the cluster has a `manualBaseCommit` saved), that commit is used as `fromSha`. This applies even in auto-diagnose and MCP-triggered diagnoses. The `Data Coverage` block in the AI context will show `baselineKind: manual`.

2. **Project-wide last-green run** — Piwi looks for the most recent test run (for the same project) that finished with `status = 'passed'` *before* the **first** run in which this cluster appeared (`firstSeenRunId`, not `lastSeenRunId`). Using `firstSeenRunId` gives the tightest possible causal window: the diff covers exactly the commits introduced between when the suite was last fully-green and when the failure was first observed. `baselineKind: run-green`.

3. **Per-test last-passing fallback** — if no project-wide green run exists (e.g. the project is new, or CI has been failing for a long time), Piwi falls back to the last run where *this specific test case* passed. This is less precise than a project-green baseline but still vastly better than no diff. `baselineKind: test-green`.

4. **No SCM data** — if none of the above yields both a baseline commit and a current commit (from the run's SCM metadata), no diff is fetched. The `Data Coverage` block marks `scmInvestigation` absent and explains why (missing repository URL, no SCM token, or a fetch error).

The `coverage.scm.baselineKind` field is available on every diagnosis response and in the context-preview endpoint, so you can always tell which path was taken. If an SCM fetch fails, `coverage.scm.error` contains the first 300 characters of the error message.

#### Relevance scoring

Changed files are ranked by relevance to the failing test before patch text is included in the context (the patch budget is limited). The scoring signals are:

| Signal | Score |
|--------|------:|
| Patch removes a line containing a string the test was trying to locate (smoking gun) | +8 |
| Patch touches (but doesn't remove) a locator-literal string | +6 |
| Test imports this file (basename match) | +5 |
| Changed file IS the test file | +4 |
| Changed file shares the test file's basename | +2 |
| Filename token overlaps with the test title or page ARIA state | +1 each |
| File is under a source directory (`src/`, `lib/`, `app/`, …) | +1 |
| File is a lockfile, doc, or config | −1 |

Files scoring ≤ 2 are excluded from the "Top Suspected Change" callout (a low-signal hint is worse than none), but they still appear in the full changed-files list.

### Full source files

A diff shows only the lines that changed. To write a patch the model needs the surrounding code too, so — when SCM is reachable — Piwi also fetches the **full current content** of the most-suspect changed files (top-ranked by the relevance score above) and the failing test's local imports (page objects, helpers, fixtures resolved one hop from the test's `import` statements), at the commit under test. These land in a `Source Files` context section with `NNNN | ` line numbers so the model can compute correct hunk headers.

Capped by `PIWI_AI_MAX_SOURCE_FILES` (default 4, set to 0 to disable) and `PIWI_AI_MAX_SOURCE_FILE_CHARS` (default 12000). Fetched over the same SCM provider API as the diff (GitHub/GitLab/Bitbucket), cached per commit SHA. The `coverage.sourceFiles` field on the context/diagnosis response lists which files were pulled in.

### Validated patches

Every `suggestedFix.patch` is checked server-side, before it reaches you, against the exact source files the model was shown: Piwi parses the unified diff and dry-runs each hunk against the real file content (tolerating line-offset drift). The result is stored on the diagnosis as `details.patchValidation.status` and shown as a badge on the patch:

| Status | Badge | Meaning |
|--------|-------|---------|
| `applies` | ✅ Applies cleanly | Every hunk matched at its stated position |
| `applies-with-offset` | ⚠️ Applies with offset | Matched, but at a shifted line — `git apply` should still succeed |
| `stale-file` | ❌ Does not apply | The file diverged from what the patch expects |
| `invalid` | ❌ Invalid diff | The text isn't a parseable unified diff |
| `unchecked` | Unverified | The target file wasn't in context, so the patch couldn't be validated |

A wrong patch is worse than none, so the model is instructed to set `patch` to null unless it can quote the lines it changes from the `Source Files` / `Test Source` sections. The patch card offers **Copy**, **Copy `git apply` command**, and **Download `.patch`**; applying is always manual (the dashboard never writes to your repository).

## Locator healing

When the failure is a broken locator, the context includes an **Alternative Locators** section: ranked replacement locators sourced from a prior passing run (highest confidence — captured against the real DOM), from a fresh match of the renamed/moved element on the failing page, or from the failure-time ARIA snapshot. The section also names a single **recommended fix** — convention-preserving where the original locator style is stable enough — which the model is instructed to use verbatim in `suggestedFix.code` rather than fabricating a locator. When nothing scores as stable, it advises adding a `data-testid` to the application as the durable fix.

This evidence is generated automatically from the [locator snapshots](./reporter#locator-healing) the reporter captures while tests run; no configuration is required beyond the default-on `captureLocators` reporter option. The same data drives the standalone **Alternative locators** panel on the test-case and cluster pages.

## Custom instructions

Tailor the analysis to your stack with **global** instructions (Settings → AI) and **per-project** instructions. Use them to describe your architecture, common false positives, or house style for fixes.

## Context limits (and token cost)

Every piece of evidence sent to the model costs tokens. Piwi caps each input so diagnoses stay fast and affordable. Defaults live in `shared/ai-context-limits.ts`; override them in **Settings → AI** or via env (env wins; the UI then shows the field read-only).

| Environment variable | Default | What it caps |
|----------------------|--------:|--------------|
| `PIWI_AI_MAX_SAMPLE_ERROR_CHARS` | 10000 | Characters of raw error text per error block |
| `PIWI_AI_MAX_SCM_PATCH_BUDGET` | 15000 | Total characters of diff patches across changed files |
| `PIWI_AI_MAX_AFFECTED_TESTS` | 30 | Affected tests listed |
| `PIWI_AI_MAX_STEPS` | 50 | Recent test steps included |
| `PIWI_AI_MAX_CONSOLE_ENTRIES` | 30 | Console error/warning entries |
| `PIWI_AI_MAX_CONSOLE_ENTRY_CHARS` | 1000 | Characters per console entry |
| `PIWI_AI_MAX_NETWORK_REQUESTS` | 25 | Failed network requests included |
| `PIWI_AI_MAX_ARIA_SNAPSHOT_CHARS` | 12000 | Characters of the page ARIA snapshot |
| `PIWI_AI_MAX_TEST_SOURCE_CHARS` | 8000 | Characters of the test source snippet |
| `PIWI_AI_MAX_SOURCE_FILES` | 4 | Full source files fetched from SCM to ground patches (0 disables) |
| `PIWI_AI_MAX_SOURCE_FILE_CHARS` | 12000 | Characters per fetched full source file |
| `PIWI_AI_MAX_SERVER_LOG_ENTRIES` | 50 | Backend server log entries (from the `X-Piwi-Logs` header) |
| `PIWI_AI_MAX_SERVER_LOG_ENTRY_CHARS` | 1000 | Characters per server log entry |
| `PIWI_AI_MAX_IMAGES` | 5 | Screenshots auto-included in the context |
| `PIWI_AI_MAX_PASSED_PEERS` | 20 | Passing peer tests in the same file listed |
| `PIWI_AI_MAX_CONSOLE_WINDOW` | 50 | Console entries (any level) in the window before failure |
| `PIWI_AI_SLOW_REQUEST_MS` | 1500 | Duration (ms) above which a network request is flagged as slow |

## Privacy

API keys are encrypted at rest with [`PIWI_SECRET_KEY`](./configuration#general). When you run a diagnosis, the bounded context above is sent to your configured provider — so for fully local analysis, use Ollama or another self-hosted OpenAI-compatible model and keep everything on your own infrastructure.

## See also

- [Configuration reference](./configuration) — all environment variables
- [Notifications](./notifications) — get alerted with `cluster.new` when a new cluster appears
- [MCP server](./mcp) — let AI agents query clusters and diagnoses directly
