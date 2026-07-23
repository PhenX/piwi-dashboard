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

<figure>
  <svg viewBox="0 0 900 252" role="img" aria-label="Diagram: a raw Playwright error is normalized and masked, then hashed into a fingerprint that routes the failure to its cluster" style="max-width:100%;height:auto;font-family:var(--vp-font-family-base)">
    <defs>
      <marker id="fp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--vp-c-text-3)"></path>
      </marker>
    </defs>
    <rect x="10" y="36" width="272" height="172" rx="8" fill="var(--vp-c-bg-soft)" stroke="var(--vp-c-divider)"></rect>
    <text x="26" y="62" font-size="12" font-weight="600" fill="var(--vp-c-text-2)">Raw error text</text>
    <g font-family="var(--vp-font-family-mono)" font-size="11.5" fill="var(--vp-c-text-1)">
      <text x="26" y="88">TimeoutError: locator.click:</text>
      <text x="26" y="106">Timeout <tspan fill="var(--vp-c-brand-1)">30000</tspan>ms exceeded</text>
      <text x="26" y="124">waiting for getByRole('row',</text>
      <text x="26" y="142">  { name: <tspan fill="var(--vp-c-brand-1)">'Acme Corp'</tspan> })</text>
      <text x="26" y="172" fill="var(--vp-c-text-3)">at checkout.spec.ts:42:11</text>
    </g>
    <line x1="290" y1="122" x2="322" y2="122" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#fp-arrow)"></line>
    <text x="306" y="106" font-size="11" fill="var(--vp-c-text-2)" text-anchor="middle">normalize</text>
    <rect x="330" y="16" width="272" height="212" rx="8" fill="var(--vp-c-bg-soft)" stroke="var(--vp-c-divider)"></rect>
    <text x="346" y="42" font-size="12" font-weight="600" fill="var(--vp-c-text-2)">Fingerprint input</text>
    <rect x="346" y="54" width="66" height="20" rx="10" fill="var(--vp-c-brand-soft)"></rect>
    <text x="379" y="68" font-size="11" font-weight="600" fill="var(--vp-c-brand-1)" text-anchor="middle">timeout</text>
    <text x="420" y="68" font-size="11" fill="var(--vp-c-text-3)">error category</text>
    <g font-family="var(--vp-font-family-mono)" font-size="11.5" fill="var(--vp-c-text-1)">
      <text x="346" y="98">Timeout <tspan fill="var(--vp-c-brand-1)">&lt;N&gt;</tspan>ms exceeded</text>
      <text x="346" y="116">waiting for getByRole('row',</text>
      <text x="346" y="134">  { name: <tspan fill="var(--vp-c-brand-1)">&lt;STR&gt;</tspan> })</text>
    </g>
    <line x1="346" y1="152" x2="586" y2="152" stroke="var(--vp-c-divider)"></line>
    <g font-size="11" fill="var(--vp-c-text-3)">
      <text x="346" y="174">stack frame kept for display,</text>
      <text x="346" y="190">volatile values masked —</text>
      <text x="346" y="206">neither splits a cluster</text>
    </g>
    <line x1="610" y1="122" x2="642" y2="122" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#fp-arrow)"></line>
    <text x="626" y="106" font-size="11" fill="var(--vp-c-text-2)" text-anchor="middle">SHA-256</text>
    <rect x="650" y="36" width="240" height="172" rx="8" fill="var(--vp-c-bg-soft)" stroke="var(--vp-c-divider)"></rect>
    <text x="666" y="62" font-size="12" font-weight="600" fill="var(--vp-c-text-2)">Failure cluster</text>
    <text x="666" y="90" font-family="var(--vp-font-family-mono)" font-size="11.5" fill="var(--vp-c-text-1)">fingerprint 3f9c1a…</text>
    <g font-size="12" fill="var(--vp-c-text-2)">
      <text x="666" y="120">Same fingerprint — or a</text>
      <text x="666" y="138">recorded merge alias —</text>
      <text x="666" y="156">joins the same cluster,</text>
      <text x="666" y="174">across tests, spec files</text>
      <text x="666" y="192">and runs.</text>
    </g>
  </svg>
  <figcaption>From raw error to cluster: the category, the masked message head, and the masked locator are hashed; dynamic values and the call site never split a cluster.</figcaption>
</figure>

<figure>
  <img src="/screenshots/failure-clusters.png" alt="Failure clusters tab grouping failures by normalized error signature">
  <figcaption>The Failure clusters tab — failures sharing an error fingerprint collapse into one row, with error type, occurrence count, and triage status.</figcaption>
</figure>

Clustering is always on and requires no configuration. When the normalization algorithm is improved, existing clusters are migrated in place (re-fingerprinted from a stored sample error), so triage status, notes, and diagnoses survive the change. AI diagnosis is opt-in.

### Semantic merging (optional)

If an **embedding** model role is configured (Settings → AI), Piwi adds a semantic layer on top of the deterministic fingerprint. After a run, the clusters first seen in it are embedded and compared (cosine similarity) against the project's other open clusters; near-duplicates above `PIWI_CLUSTER_SIMILARITY_THRESHOLD` (default `0.92`) are merged into the longest-lived cluster. This catches failures that are the same root cause but phrased differently enough to dodge the fingerprint. Merges record a fingerprint alias so future occurrences attach to the survivor instead of re-forking. With no embedding role configured, clustering stays purely deterministic.

The text fed to the embedder is cleaned first — ANSI color codes stripped, framework stack frames collapsed, and volatile tokens (URLs, ids, received/expected values) masked — so vectors measure a failure's shape rather than its per-occurrence noise. Each pass also backfills a bounded batch of older open clusters that don't have a usable vector yet (created before the embedding role existed, or embedded with a different model), so a pre-existing backlog of near-duplicates converges over the runs that follow. Vectors are only ever compared within one embedding model: after switching models, stale vectors are re-embedded by the same backfill instead of being scored against the new model's output.

When auto-diagnose is enabled, new clusters are also given a short **human-readable title** (one cheap batched model call per run, using the research model when one is configured, otherwise the diagnosis model) shown in place of the raw normalized signature across the lists and the cluster page — the signature stays available on hover and below the title. Clusters fall back to the signature when no title has been generated.

Pairs that fall in the **ambiguous band** (similarity between `PIWI_CLUSTER_SUGGEST_THRESHOLD`, default `0.80`, and the merge threshold) aren't merged automatically. Whenever AI is configured, a model adjudicates the pair ("same root cause?") — the **research** model when one is configured, the diagnosis model otherwise — and merges only on a high-confidence yes; when it's unsure (or no AI is configured at all), the pair becomes a **merge suggestion** on the project's Failure clusters tab, where a reporter or admin approves (merge) or dismisses it. The adjudicator sees more than the error text: each cluster's extracted locator, its most-affected tests, and how much the two clusters overlap (tests failing in both, runs where both fired) — signals that separate "one cause, reworded message" from "similar boilerplate, different problems". Adjudication is budget-capped per run to control cost.

<figure>
  <svg viewBox="0 0 900 332" role="img" aria-label="Diagram: new and backfilled clusters are embedded, compared to open clusters by cosine similarity, and land in one of three bands — kept separate below 0.80, adjudicated between 0.80 and 0.92, auto-merged at 0.92 and above" style="max-width:100%;height:auto;font-family:var(--vp-font-family-base)">
    <defs>
      <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--vp-c-text-3)"></path>
      </marker>
    </defs>
    <rect x="10" y="18" width="280" height="58" rx="8" fill="var(--vp-c-bg-soft)" stroke="var(--vp-c-divider)"></rect>
    <text x="26" y="42" font-size="12.5" fill="var(--vp-c-text-1)">Clusters first seen in this run</text>
    <text x="26" y="60" font-size="11.5" fill="var(--vp-c-text-3)">+ backfill of older ones without a vector</text>
    <line x1="298" y1="47" x2="336" y2="47" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#sm-arrow)"></line>
    <text x="317" y="32" font-size="11" fill="var(--vp-c-text-2)" text-anchor="middle">embed</text>
    <rect x="344" y="18" width="250" height="58" rx="8" fill="var(--vp-c-bg-soft)" stroke="var(--vp-c-divider)"></rect>
    <text x="360" y="42" font-size="12.5" fill="var(--vp-c-text-1)">Cleaned error text → vector</text>
    <text x="360" y="60" font-size="11.5" fill="var(--vp-c-text-3)">ANSI, stack noise &amp; volatile values out</text>
    <line x1="602" y1="47" x2="640" y2="47" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#sm-arrow)"></line>
    <rect x="648" y="18" width="242" height="58" rx="8" fill="var(--vp-c-bg-soft)" stroke="var(--vp-c-divider)"></rect>
    <text x="664" y="42" font-size="12.5" fill="var(--vp-c-text-1)">Nearest open cluster</text>
    <text x="664" y="60" font-size="11.5" fill="var(--vp-c-text-3)">cosine, same embedding model only</text>
    <line x1="769" y1="76" x2="769" y2="98" stroke="var(--vp-c-text-3)" stroke-width="1.5"></line>
    <line x1="769" y1="98" x2="450" y2="98" stroke="var(--vp-c-text-3)" stroke-width="1.5"></line>
    <line x1="450" y1="98" x2="450" y2="120" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#sm-arrow)"></line>
    <text x="60" y="144" font-size="11.5" fill="var(--vp-c-text-3)">similarity of the closest pair</text>
    <rect x="60" y="154" width="316" height="44" rx="6" fill="var(--vp-c-default-soft)"></rect>
    <text x="218" y="180" font-size="12.5" fill="var(--vp-c-text-2)" text-anchor="middle">kept separate</text>
    <rect x="380" y="154" width="276" height="44" rx="6" fill="var(--vp-c-yellow-soft)"></rect>
    <text x="518" y="180" font-size="12.5" font-weight="600" fill="var(--vp-c-yellow-1)" text-anchor="middle">ambiguous band</text>
    <rect x="660" y="154" width="230" height="44" rx="6" fill="var(--vp-c-green-soft)"></rect>
    <text x="775" y="180" font-size="12.5" font-weight="600" fill="var(--vp-c-green-1)" text-anchor="middle">auto-merge</text>
    <g font-family="var(--vp-font-family-mono)" font-size="11" fill="var(--vp-c-text-2)">
      <text x="380" y="216" text-anchor="middle">0.80</text>
      <text x="658" y="216" text-anchor="middle">0.92</text>
    </g>
    <line x1="518" y1="224" x2="518" y2="244" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#sm-arrow)"></line>
    <rect x="380" y="252" width="276" height="70" rx="8" fill="var(--vp-c-bg-soft)" stroke="var(--vp-c-divider)"></rect>
    <text x="396" y="276" font-size="12.5" fill="var(--vp-c-text-1)">A model adjudicates the pair:</text>
    <text x="396" y="294" font-size="12" fill="var(--vp-c-text-2)">high confidence → <tspan font-weight="600" fill="var(--vp-c-green-1)">merge</tspan></text>
    <text x="396" y="312" font-size="12" fill="var(--vp-c-text-2)">unsure / no model → <tspan font-weight="600" fill="var(--vp-c-yellow-1)">suggestion</tspan> for review</text>
    <line x1="775" y1="224" x2="775" y2="244" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#sm-arrow)"></line>
    <rect x="660" y="252" width="230" height="70" rx="8" fill="var(--vp-c-bg-soft)" stroke="var(--vp-c-divider)"></rect>
    <text x="676" y="280" font-size="12" fill="var(--vp-c-text-2)">merged into the older cluster,</text>
    <text x="676" y="298" font-size="12" fill="var(--vp-c-text-2)">fingerprint alias recorded</text>
  </svg>
  <figcaption>The semantic layer: freshly embedded clusters seek their nearest neighbour; the cosine score decides between keeping them apart, asking a model (or a human), and merging outright. Thresholds are the <code>PIWI_CLUSTER_SUGGEST_THRESHOLD</code> and <code>PIWI_CLUSTER_SIMILARITY_THRESHOLD</code> defaults.</figcaption>
</figure>

Embedding-based reconciliation runs after every finished run whenever an embedding role is configured — it is independent of the auto-diagnose toggle.

## Enabling AI diagnosis

Configure a provider via **Settings → AI**, or with environment variables (env always takes precedence over values stored through the UI, and the UI shows env-managed fields read-only).

| Variable | Description |
|----------|-------------|
| `PIWI_AI_PROVIDER` | `anthropic` or `openai` |
| `PIWI_AI_API_KEY` | Provider API key (stored encrypted when set via the UI; never returned by the API) |
| `PIWI_AI_MODEL` | Model name (default: `claude-opus-4-8` for Anthropic) |
| `PIWI_AI_BASE_URL` | Base URL for OpenAI-compatible providers (e.g. Ollama, LM Studio, vLLM) |
| `PIWI_AI_AUTO_DIAGNOSE` | `true` to automatically diagnose new clusters when a run finishes |
| `PIWI_AI_AUTO_DIAGNOSE_MAX` | Max clusters auto-diagnosed per finished run (budget cap; default `3`) |
| `PIWI_AI_RESEARCH_MODEL` / `_PROVIDER` / `_BASE_URL` / `_API_KEY` | Optional **research** model for two-stage diagnosis; provider/base URL/key default to the main ones |
| `PIWI_AI_EMBEDDING_PROVIDER` / `_MODEL` / `_BASE_URL` / `_API_KEY` | Optional **embedding** model for semantic failure clustering (OpenAI-compatible only — Anthropic has no embeddings API) |

`GET /api/ai/status` reports whether AI is configured (without ever exposing the key); the UI uses it to show or hide AI actions.

### Streaming diagnosis

Instead of waiting for a synchronous response, the diagnosis can be **streamed** via SSE (Server-Sent Events) — the model's reasoning tokens appear in the UI as they arrive:

- **`POST /api/failure-clusters/[id]/diagnose/stream`** — same request body as the synchronous endpoint, but the response is a `text/event-stream` with `event: thinking` chunks containing incremental text, then a final `event: result` with the complete diagnosis.
- The client uses `fetch()` with `POST` (not `EventSource`) so it can send request body params (additional context, images, base commit, etc.). The response body is read as a `ReadableStream` and parsed for SSE messages.
- See the [API docs](https://piwitests.github.io/demo/docs) for the exact protocol (the in-app API reference at `/docs` shows the same spec).
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

<figure>
  <img src="/screenshots/ai-diagnosis.png" alt="Failure cluster page with the AI diagnosis result alongside the error and alternative locators">
  <figcaption>A cluster page — the AI diagnosis (category, confidence, root cause, evidence, and a suggested fix) sits beside the actual error and the ranked alternative locators it was grounded in.</figcaption>
</figure>

## Diagnosing one execution

The [failure cluster](./ui-overview#failure-cluster-detail) page diagnoses a *group* of failures that share a fingerprint. When you are looking at a single failing execution, the [test case detail](./ui-overview#test-case-detail) page's **Diagnosis** tab can diagnose *just that execution* — same model, same structured result, scoped to the one run in front of you. This is handy when a failure hasn't clustered yet, or when you want a diagnosis grounded in this specific execution's evidence rather than the cluster aggregate.

Two things are always available there, even with **no provider configured**:

- **Copy AI context** — copies the exact evidence bundle (error, steps, console, network, ARIA snapshot, source — plus, when a trace was uploaded, the full call stack with embedded source and the trace's complete network activity — all trimmed to the [context limits](#context-limits-and-token-cost)) so you can paste it into your own AI tool. It is the same context the model would receive.
- A **coverage strip** showing which evidence sections are present, truncated, or absent — the same map the model sees.

With a provider configured, **Diagnose with AI** runs the diagnosis inline and renders the result (category, confidence, root cause, evidence, suggested fix) right in the tab; cited evidence links jump to the matching section on the page. The result is stored per execution, so it survives a reload, and you can add free-text context or re-diagnose. Execution-scoped and cluster-scoped diagnoses are independent — running one never overwrites the other.

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

<figure>
  <img src="/screenshots/locator-healing.png" alt="Alternative locators panel with ranked replacement locators and a recommended fix">
  <figcaption>The Alternative locators panel — the broken locator, ranked replacements scored for stability, and a single recommended fix that preserves your locator style.</figcaption>
</figure>

This evidence is generated from the locator snapshots recorded by the [capture fixtures](./capture-fixtures) while tests run — make sure your specs import `test` from a fixtures file that extends `piwiFixtures`. Capture is gated by the default-on `captureLocators` reporter option. The same data drives the standalone **Alternative locators** panel on the test-case and cluster pages.

## Custom instructions

Tailor the analysis to your stack with **global** instructions (Settings → AI) and **per-project** instructions. Use them to describe your architecture, common false positives, or house style for fixes.

## Context limits (and token cost)

Every piece of evidence sent to the model costs tokens. Piwi caps each input so diagnoses stay fast and affordable. Defaults live in `shared/ai-context-limits.ts`; override them in **Settings → AI** or via env (env wins; the UI then shows the field read-only).

The full list of `PIWI_AI_MAX_*` limit variables, their defaults and their clamping ranges lives in the [Configuration reference → AI context limits](./configuration#ai-context-limits) — generated from the same registry the server reads, so it can never drift from the code.

## Try it in the demo

The [live demo](https://piwitests.github.io/demo/) runs entirely in your browser with no AI provider — yet the diagnosis experience is fully wired. Several failing clusters ship with a completed diagnosis (category, confidence, evidence with citations, a validated suggested patch, per-stage pipeline stats, and auto-selected suspect commits); others are left undiagnosed so you can trigger a **simulated streaming diagnosis** yourself and watch the reasoning tokens arrive. The diagnoses are generated from each cluster's real seeded evidence (occurrences, failure rate, affected tests, browsers) and a canned SCM history, so the **Context sent to AI** modal, the data-coverage map, the commit browser, baseline pinning, and the diagnosis version history all behave as they do against a real server. Suggested-fix patches are validated against the seeded source files, so the "Applies cleanly" badge means the same thing it does in production.

## Privacy

API keys are encrypted at rest with [`PIWI_SECRET_KEY`](./configuration#general). When you run a diagnosis, the bounded context above is sent to your configured provider — so for fully local analysis, use Ollama or another self-hosted OpenAI-compatible model and keep everything on your own infrastructure.

## See also

- [Configuration reference](./configuration) — all environment variables
- [Notifications](./notifications) — subscribe to `cluster.new` and `diagnosis.completed` to get alerted when a new cluster appears or a diagnosis completes (browser, email, Slack, or webhook)
- [MCP server](./mcp) — let AI agents query clusters and diagnoses directly
