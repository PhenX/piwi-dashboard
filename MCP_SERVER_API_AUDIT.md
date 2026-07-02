# Piwi Dashboard — MCP Server API Audit & Improvement Plan

**Date:** 2026-07-02
**Scope:** The built-in Model Context Protocol server at `POST /mcp` — its external tool surface, exported data shapes, parameters, token efficiency, correctness, and authorization.
**Method:** Static read of the server + shared handlers, plus live measurement against a dev server seeded from the demo dataset (`node scripts/seed-dev-from-demo.mjs`). Every "VERIFIED" claim below was reproduced against a running instance.

**Source files audited**

| File | Role |
|------|------|
| `application/server/routes/mcp.post.ts` | JSON-RPC transport / dispatcher |
| `application/server/utils/mcp/protocol.ts` | Protocol constants + envelope helpers |
| `application/server/utils/mcp/tools.ts` | 18 tool handlers + token helpers |
| `application/shared/mcp-tools.ts` | Tool catalog (names/descriptions/schemas) + output types |
| `application/app/pages/mcp.vue` | In-app setup page (renders the catalog) |
| `docs/mcp.md` | Public documentation |

---

## 1. Executive summary

The MCP server is well-architected: a single Nitro route, a compile-time-checked handler map (`Record<McpToolName, …>`), token-conscious output (`dropNulls`, compact `JSON.stringify(…, null, 0)`, 400-char error truncation), and cursor pagination on list tools. The design conventions in `AGENTS.md` ("MCP Tool Conventions") are sound.

However, the audit found **4 correctness bugs** (two make a tool's second page of results **crash or loop**, one makes `list_flaky_tests` return **empty stats**, one makes `get_test_case_context` return **no evidence at all**), **1 authorization gap** (MCP ignores the project-assignment scope the REST API enforces — any authenticated user can read every project), several **token-efficiency regressions** (heavy handlers fetch full JSON blobs then discard them; `get_run` returns *all* cases unpaginated), and a large **capability gap** versus REST (no run-vs-baseline insights, spec health, network/perf analysis, stability trends, full locator healing, global search, or any write/triage tool).

Priorities:

- **P0 — Correctness & security (ship first):** fix the 3 pagination/stats bugs, the empty execution-context bug, and enforce project scope. These are small, contained diffs.
- **P1 — Token efficiency:** push filters into SQL, paginate `get_run` cases, slim the heavy shared-handler fetches, trim the catalog.
- **P2 — Usefulness ("think large"):** add ~12 new tools that expose already-stored data (insights, spec health, network, stability, locator healing, global search, triage writes) and one composite "explain this failure" tool.

---

## 2. External API inventory (what is exposed today)

18 read-only tools over JSON-RPC 2.0 (`initialize`, `ping`, `tools/list`, `tools/call`; `resources/list` + `prompts/list` return empty). Auth: same `pd_` Bearer key as REST. Measured payload sizes (demo dataset, compact JSON) are the token cost an agent actually pays.

| Tool | Required params | Optional params | Returns (top-level) | Measured size |
|------|-----------------|-----------------|---------------------|---------------|
| `list_projects` | — | — | `Project[]` (id, name, label, totalRuns, totalTestCases, tags[], latestRun{}) | 0.7 KB / ~190 tok |
| `get_project` | `id` | `pageSize`, `cursor` | project + `runs[]` + `nextCursor` | 1.9 KB / ~490 tok |
| `list_runs` | `projectId` | `status`, `branch`, `pageSize`, `cursor` | `{items[], nextCursor}` | 1.8 KB / ~460 tok |
| `get_run` | `id` | `status_filter` (failed/flaky/all) | run summary + **all** `cases[]` (unpaginated) | 0.3 KB (failed) / 2.8 KB (all 14) |
| `list_failed_cases` | `projectId` | `runId`, `pageSize`, `cursor` | `{items[], nextCursor}` | 0.4 KB |
| `list_flaky_tests` | `projectId` | `runs`, `pageSize`, `cursor` | `{items[], nextCursor}` | **0.14 KB — stats missing (bug §3.1)** |
| `get_test_case` | `id` | `pageSize`, `cursor` | tc + stats + clusters + `recentExecutions{}` | ~0.5 KB |
| `list_clusters` | `projectId` | `status`, `pageSize`, `cursor` | `{items[], nextCursor}` | 0.6 KB |
| `get_cluster` | `id` | — | cluster + affectedTestCases[≤20] + locatorHealing[≤5] | 0.4 KB |
| `get_cluster_diagnosis` | `id` | — | diagnosis fields or `{diagnosis:null}` | 0.04 KB |
| `get_test_case_context` | `id` | — | execution AI context | **1.8 KB — all sections absent (bug §3.4)** |
| `get_case_screenshots` | `testRunsCaseId` | `content` | screenshot metadata or base64 | 2 B (none in demo) |
| `get_cluster_context` | `id` | `baseCommit`, `selectedCommitShas` | full cluster AI context markdown + coverage | 2.1 KB / ~540 tok |
| `search_test_cases` | `projectId`, `q` | `pageSize`, `cursor` | `{items[], nextCursor}` | small |
| `get_test_run_case` | `id` | — | one execution, full untruncated error + steps + console + vitals + aria | 1.9 KB |
| `list_recent_activity` | — | `pageSize`, `cursor` | `{items[], nextCursor}` cross-project | 1.7 KB |
| `get_repo_commits` | `projectId` | `branch`, `limit` | `{commits[]}` or `{commits:[], error}` | needs SCM token |
| `get_repo_diff` | `projectId`, `sha` | — | `{commit, files[]}` or `{error}` | needs SCM token |

**Catalog cost:** `tools/list` returns **14.6 KB (~3,740 tokens)** — paid once per session by every connected client. ~1,850 of those tokens are tool descriptions, and a large share is boilerplate repeated verbatim across tools (see §4.4).

**What's good and should be kept:**
- Compact serialization (`toContent` → `JSON.stringify(data, null, 0)`, `tools.ts:95`).
- `dropNulls` strips `null`/`''`/`[]` (`tools.ts:26`); errors truncated to 400 chars (`trunc`, `tools.ts:36`).
- Consistent field vocabulary (`testCaseId` / `executionId` / `filePath` / `startedAt`) per `AGENTS.md`.
- Cursor pagination helper `paginatedItems` (`tools.ts:66`) — correct *when handed the right cursor field* (see bugs).

---

## 3. Correctness bugs (P0 — all verified live)

### 3.1 `list_flaky_tests` returns no stats — every metric field is dropped

**Severity:** High (tool is effectively useless — returns only id/title/path).
**File:** `application/server/utils/mcp/tools.ts:378-410`.
**Root cause:** field-name mismatch between the handler and its backing function. `getProjectFlakyTests` (`shared/handlers/projects.ts:941-960`) returns objects with `score`, `totalRuns`, `failedRuns`, `retryPassRuns`, `alternations`, `failureRate`, `impact`, `wastedCiMinutes`, `avgFailedDurationMs`, `rootCause`, `lastFlakeAt`. The MCP handler reads **different names**: `t.flakyScore`, `t.runCount`, `t.retryPassCount`, `t.alternationCount`, `t.passCount`, `t.failCount`. All are `undefined`, so `dropNulls` removes them.

**Evidence (live):** first item keys were exactly `testCaseId,title,filePath` — every stat missing. Two knock-on effects: the sort comparator `b.flakyScore - a.flakyScore` (`:392`) is `NaN` (unsorted output), and the cursor `t.flakyScore < Number(cursor)` (`:389`) plus `getCursor: (r) => String(r.flakyScore)` (`:409`) produce `"undefined"` / `NaN` — pagination is broken too.

**Fix:** map the real fields, and surface the high-value ones the current shape omits.

```ts
// tools.ts — list_flaky_tests mapper
const mapped = sorted.slice(0, pageSize + 1).map((t: any) =>
  dropNulls({
    testCaseId: t.testCaseId,
    title: t.title,
    filePath: t.filePath,
    flakyScore: t.score,                 // was t.flakyScore
    failureRate: t.failureRate,          // NEW — 0..1, cheap signal
    runCount: t.totalRuns,               // was t.runCount
    failCount: t.failedRuns,             // was t.failCount
    retryPassCount: t.retryPassRuns,     // was t.retryPassCount
    alternationCount: t.alternations,    // was t.alternationCount
    rootCause: t.rootCause || null,      // NEW — timing/network/assertion/…
    impact: t.impact || null,            // NEW — ranking signal
    wastedCiMinutes: t.wastedCiMinutes || null,   // NEW
    avgFailedDurationMs: t.avgFailedDurationMs || null, // NEW
  }),
);
```

Then change the sort/cursor to `t.score`:
```ts
sorted.sort((a, b) => b.score - a.score || a.testCaseId - b.testCaseId);
const sortedFiltered = cursor ? items.filter((t) => t.score < Number(cursor)) : items;
return paginatedItems(mapped, pageSize, (r: any) => String(r.flakyScore)); // flakyScore now populated
```
Update `McpFlakyTestItem` in `shared/mcp-tools.ts:376` to add `failureRate`, `rootCause`, `impact`, `wastedCiMinutes`, `avgFailedDurationMs`. Add a regression test asserting `items[0].flakyScore` is a number (see §7).

---

### 3.2 `list_failed_cases` — page 2 crashes (cursor is the string `"undefined"`)

**Severity:** High (cannot paginate failed cases; second page throws a DB error).
**File:** `application/server/utils/mcp/tools.ts:374`.
**Root cause:** the mapper emits `executionId` (`:358`), but the cursor extractor reads the pre-map column name `caseId`: `paginatedItems(mapped, pageSize, (r: any) => String(r.caseId))`. `r.caseId` is `undefined` → `nextCursor = "undefined"`. On the next call, `lt(testRunsCases.id, Number("undefined"))` = `lt(id, NaN)` → SQL failure.

**Evidence (live):** project 4, `pageSize:1` → `nextCursor:"undefined"`; passing that cursor back → `-32603 Failed query: select … from test_runs_cases …`.

**Fix (one line):**
```ts
return paginatedItems(mapped, pageSize, (r: any) => String(r.executionId));
```
Guard `numericParam`-style cursors generally (see §3.5).

---

### 3.3 `list_runs` with a `branch` filter — infinite pagination loop

**Severity:** Medium (agent re-reads the same page forever; wasted tokens/DB).
**File:** `application/server/utils/mcp/tools.ts:210-260`.
**Root cause:** when a `branch` filter is present the cursor is deliberately *not* pushed into SQL (`if (cursor && !branchFilter)`, `:212`) because branch lives in JSON metadata and is filtered in memory. But `paginatedItems` still returns a `startedAt` cursor (`:260`), and the next call — still branch-filtered — ignores that cursor, so it returns the **same** first page again.

**Evidence (live):** branch=`main`, `pageSize:2` → page 1 ids `[21,22]`, `nextCursor:"…T23:34:48Z"`; page 2 with that cursor → ids `[21,22]` again, identical `nextCursor`.

**Fix:** apply the cursor in-memory on the same `startTime` axis used for the emitted cursor, so the branch path advances. After building `scopeRows`, before slicing:
```ts
const cursored = cursor
  ? scopeRows.filter((r) => r.startTime && new Date(r.startTime) < new Date(cursor))
  : scopeRows;
const mapped = cursored.slice(0, pageSize + 1).map(/* … */);
```
(Keep the SQL cursor for the no-branch path; this only covers the in-memory branch path.) Note the pre-existing correctness caveat: in-memory branch filtering over a `3×pageSize` window can under-return on dense history — documented, acceptable, but worth a comment. Add a paginated branch-filter test.

---

### 3.4 `get_test_case_context` — returns a "Data Coverage: everything absent" stub, no evidence

**Severity:** High (the tool's advertised value — "steps, console, network, and SCM diff" — is entirely missing).
**Files:** `application/server/utils/mcp/tools.ts:638-664` → `application/server/utils/ai-context.ts:1639-1846`.
**Root cause:** `buildDiagnosisContext` only assembles sections inside `if (opts.kind === 'cluster')` (`ai-context.ts:1654-1827`). There is **no `execution` branch**. When called with `kind:'execution'` (as `get_test_case_context` does at `tools.ts:646`), `contextSections` stays `[]`, so `text` is just the coverage header (every section marked absent) and `sections` is empty.

**Evidence (live + DB):** `get_test_case_context(451)` returned 1.8 KB whose text is only `"## Data Coverage … Absent or truncated sections …"`, `sections=[]`. A direct DB query shows case 451 **does** have `steps` (257 chars) and `console_logs` (101 chars) and an `error` — so this is a code gap, not sparse data.

**Blast radius:** the same builder + `kind:'execution'` backs REST `GET /api/test-run-cases/{id}/diagnosis-context` (`diagnosis-context.get.ts:49`) and execution-scoped AI diagnosis (`ai-diagnosis.ts:181`). Fixing the builder fixes all three; verify those two paths after the change.

**Fix options (pick one):**
1. **Preferred — implement the execution branch** in `buildDiagnosisContext`: load the specific `testRunsCaseId` as the representative execution and reuse the existing per-execution section builders (`executionError`, `testSource`, `steps`, `console`, `networkRequests`, `webVitals`, `ariaSnapshot`, `serverLogs`, `locatorHealing`, `scmInvestigation`). Most section helpers already take a representative row, so this is mostly wiring `loadExecutionById(id)` in place of `loadRepresentativeExecution(cluster)`.
2. **Fast interim** — make `get_test_case_context` fall back to the already-working data: return the `get_test_run_case` payload (which *does* read steps/console/vitals/aria straight from the row) and, when the case has a `failureClusterId`, additionally attach `get_cluster_context`. Update the tool description to match until option 1 lands.

Because option 1 touches the shared diagnosis pipeline, treat it as its own change with the AI-diagnosis tests; ship option 2 in the MCP P0 batch so the tool stops lying.

---

### 3.5 Hardening: numeric-cursor validation (defense for 3.1–3.3)

Several tools do `lt(col, Number(cursor))` with no `NaN` guard, so a malformed cursor becomes a `Failed query` (`-32603`) instead of a clean `INVALID_PARAMS`. Add a helper and use it wherever a cursor is numeric (`get_project`, `list_failed_cases`, `list_clusters`, `get_test_case`, `search_test_cases`):
```ts
function numericCursor(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error('Invalid cursor');
  return n;
}
```
Handler-thrown `Error`s already map to a JSON-RPC error via the `dispatch` try/catch (`mcp.post.ts:66`), so this yields a clean message.

---

## 4. Token efficiency (P1)

The output layer is good; the **input** side (backing queries) over-fetches, and one tool has no case pagination.

### 4.1 `get_run` fetches every case with full `stepEvents` JSON, then discards most of it

**File:** `tools.ts:264-317` → `getTestRun` (`shared/handlers/test-runs.ts:27-186`).
`getTestRun` loads **all** cases including the heavy `stepEvents` JSON and full untruncated `error`, and runs `computeWastedMs` over every case. The MCP handler then **filters to failed/flaky in memory** (`:271-276`) and truncates errors to 400. On a large run this reads (and CPU-processes) thousands of rows to emit a handful, and `get_run` **never paginates cases** — `status_filter:'all'` on a 500-case run is a single multi-hundred-KB response.

**Fixes:**
- Add `pageSize`/`cursor` to `get_run` and cap `cases[]` (default 25, max 50), with `casesShown`/`casesTotal` already present as the signal to page.
- Push the status filter into SQL: for the common `failed` path, query `test_runs_cases` directly with `status IN ('failed','timedOut')` + a join to `test_cases` (mirror `list_failed_cases`) instead of calling the full `getTestRun`. Reserve the full-run load for `status_filter:'all'`.
- Don't request `stepEvents` for the summary shape — the handler never emits it.

### 4.2 `get_test_case` re-queries executions that the handler already fetched

**File:** `tools.ts:413-474`. `getTestCase` already returns `recentExecutions` (up to 20 rows *with full error text*), but the handler only reads its truthiness as a flag (`:425`) and then **re-queries** executions with cursor pagination. Either (a) pass a `withExecutions:false`/limit option into `getTestCase` so it skips that fetch, or (b) keep the re-query but stop calling the expensive aggregate path when only executions are needed. Also unused from the fetched payload: `suitePath`, `timedOutRuns`, `passRate`, `lastRunAt`, `links`.

### 4.3 Heavy `SELECT *` in shared handlers pulls columns MCP always drops

- `getFailureCluster` (`failure-clusters.ts`) `SELECT *` pulls `embedding` (a JSON `number[]` semantic vector, can be multi-KB) and the full diagnosis `details` JSON; `get_cluster` uses **neither**. It also fetches `affectedTestCases` at 50 then slices to 20.
- `listProjects` fetches full `latestRun` rows including `setupSteps` JSON; `list_projects` keeps only a handful of scalar fields.
- `getProjectFlakyTests` re-fetches the run set twice (Q1 then Q2 with status) — could be one query.

**Fix:** give MCP slim projections. Either add an `opts` projection to these shared handlers or run dedicated narrow `db.select({…})` queries in the MCP layer (as `get_project`/`list_runs` already do). Avoid selecting `embedding`, `details`, `setupSteps`, `metadata` unless mapped.

### 4.4 Trim the `tools/list` catalog (~3.7k tokens → target < 2.5k)

Descriptions repeat boilerplate verbatim, e.g. *"Returns a paginated response — use nextCursor from the result to fetch the next page"* appears on ~6 tools, and *"Opaque cursor from a previous response to get the next page"* on nearly all. Move the pagination convention into the server `instructions` string (`mcp.post.ts:87`, returned once at `initialize`) and shorten each `description`/param doc to the tool-specific part. Keep the first sentence (what it does + when to use it) — that's what drives correct tool selection.

### 4.5 `get_test_run_case` blobs are uncapped

`get_test_run_case` returns `steps`, `stepEvents`, `consoleLogs`, `webVitals`, and `ariaSnapshot` as raw JSON with no cap (only `error` is deliberately untruncated). For a heavy case this can be large. Add optional `include` (e.g. `['steps','console','network','aria']`, default the lot) so an agent can ask for just what it needs, and cap `ariaSnapshot`/`consoleLogs` length with the same `trunc`/limit approach used elsewhere.

---

## 5. Authorization gap (P0 — security)

**Finding:** MCP bypasses the project-assignment scope that the REST API enforces.
**File:** `application/server/routes/mcp.post.ts:31` — `await requireAuth(event)` with **no roles**, and **no** `getProjectScope` / `requireProjectAccess` anywhere in `tools.ts`. Every handler queries by `projectId` directly (`list_projects` even calls `listProjects(db)` with the default `scope:'all'`, `tools.ts:111`).

**Consequence:** with `PIWI_AUTH_ENABLED=true`, a `USER`/`REPORTER` whose API key is scoped to project A can read **every** project's runs, cases, errors, clusters, diagnoses, screenshots, and SCM diffs via MCP — the exact isolation `AGENTS.md` ("Project-level Permissions") says the REST layer guarantees. (With auth disabled the virtual admin makes this moot, which is why it's unnoticed in dev.)

**Fix:**
1. Resolve the caller's scope once per request: `const scope = await getProjectScope(db, user)` (from `server/utils/project-access.ts`).
2. Thread it through the handler signature (`handler(db, args, ctx)` where `ctx = { user, scope }`), or resolve inside each handler.
3. For project-scoped tools (`get_project`, `list_runs`, `list_failed_cases`, `list_flaky_tests`, `list_clusters`, `search_test_cases`, `get_repo_commits`, `get_repo_diff`): reject with a clean error when `!scopeAllows(scope, projectId)`.
4. For entity-scoped tools (`get_run`, `get_cluster`, `get_test_case`, `get_test_run_case`, `get_cluster_context`, `get_test_case_context`, `get_case_screenshots`, `get_cluster_diagnosis`): resolve the owning project via the existing `resolveRunProjectId` / `resolveClusterProjectId` / `resolveCaseProjectId` / `resolveTestRunCaseProjectId` helpers and scope-check.
5. For `list_projects` / `list_recent_activity`: pass `scope` into `listProjects(db, scope)` / `getRecentTestRuns(db, scope)` (both already accept it).

Add a test: a USER-scoped key sees only assigned projects through MCP.

**Related, lower severity — CORS:** `/mcp` sets `Access-Control-Allow-Origin: *` (`mcp.post.ts:20` and `routeRules` in `nuxt.config.ts:131`). Because auth is Bearer (not cookie) for MCP clients this is not credential-leaking today, but `requireAuth` *also* accepts the session cookie, and `*` + future cookie use is a trap. Prefer echoing an allowlisted origin, or document that MCP must be Bearer-only. Low priority; note it.

---

## 6. Protocol / transport

- **Protocol version is old.** `MCP_PROTOCOL_VERSION = '2024-11-05'` (`protocol.ts:1`). Current spec is `2025-06-18`. Bump after verifying the handshake shape, or (better) echo the client's requested `params.protocolVersion` when supported and fall back to a pinned default.
- **`GET /mcp` returns the HTML setup page, not SSE/405.** The Streamable HTTP spec lets a server open an SSE stream on `GET` or reply `405`. Because `/mcp` is also a Nuxt page route, a `GET` yields `200 text/html` (VERIFIED). Strict clients that probe `GET` for a stream may mis-handle it. Either serve the page at a different path (e.g. `/mcp-setup`) and reserve `/mcp` for the JSON-RPC POST, or return `405` on `GET /mcp` with `Allow: POST, OPTIONS`.
- **Inconsistent error surfacing.** Most failures become JSON-RPC errors (via the `dispatch` try/catch), but `get_repo_commits`/`get_repo_diff` return `{commits:[], error}` / `{error}` **inside** a success result. Pick one convention. For "tool ran but the operation failed" prefer MCP's `isError: true` content block so agents detect failure uniformly.
- **`resources`/`prompts` advertised empty.** `capabilities` only lists `tools` (fine), and `resources/list`/`prompts/list` return `[]`. See §7 for a resources idea (expose test source / trace text as MCP resources).
- **Batch + size limits look correct.** 1 MB body cap (`mcp.post.ts:8`), notifications filtered, array-in/array-out preserved. Keep.

---

## 7. Proposed new tools ("think large" — all backed by already-stored data)

The database already stores far more than the current tools expose. Grouped by the agent job-to-be-done. Names follow the existing `verb_noun` style; all should honor project scope (§5) and return the compact `{items, nextCursor}` shape where list-like.

### 7.1 "Did my fix work / what changed?" — the highest-value gap

- **`get_run_insights(runId)`** → wraps `computeRunInsights` (`shared/handlers/run-insights.ts`, already powering `GET /api/test-runs/{id}/insights`). Returns `passRateDelta`, `newRegressions[]`, `recurrences[]`, `recovered[]`, `newFlaky[]`, `mostImproved/mostRegressed[]` (perf deltas), `workerImbalance`, `clusterNew[]` vs the last green run. This is the single most useful missing tool for an agent iterating on a fix. Bound the unbounded arrays (regressions/recoveries) to a `pageSize`.
- **`compare_runs(runA, runB)`** → thin wrapper over the same diff machinery for arbitrary run pairs (e.g. PR branch vs main).

### 7.2 Area-level & performance health

- **`get_spec_health(projectId, days?)`** → `GET /api/projects/{id}/spec-health` data: per-spec-prefix pass rate, flaky rate, failures, avg time. Lets an agent prioritize which files to fix.
- **`get_slow_tests(projectId)`** and **`get_performance_trend(projectId)`** → `slow-tests` / `performance` endpoints: avg/max/min, p90, trend direction. "Is the suite getting slower?"
- **`get_test_stability_trend(testCaseId)`** → `test-cases/{id}/stability-trend`: bucketed flaky-rate/pass-rate/duration time series. "Is this test getting flakier?"

### 7.3 Failure evidence the agent currently can't reach

- **`get_network_requests(runId)`** → `test-runs/{id}/network-requests`: requests aggregated by method + normalized route, sorted by avg duration, **including captured backend `serverLogs`** (`network_requests.server_logs`). Excellent for pinning a UI failure on a slow/500 endpoint.
- **`get_locator_healing(runId, caseId)`** → `test-runs/{id}/cases/{caseId}/locator-healing`: the **full** ranked alternatives (`fromPriorSuccess` + `fromElementMatch` + ARIA fallback) for **any** failing case. Today `get_cluster` embeds only the top recommendation for ≤5 cluster cases; an agent fixing a specific selector can't get the full list.
- **`get_failure_groups(runId)`** → `test-runs/{id}/failure-groups`: a single run's failures grouped by cluster + flakiness + worker correlation (run-scoped, unlike the project-scoped `list_clusters`).
- **`list_case_traces(testRunsCaseId)`** → `test-run-cases/{id}/traces`: list Playwright trace files (name, size, path). Pair with a resource (§7.6) or a `get_trace_actions` tool that returns the decoded action list (the trace-ZIP parser already exists in `ai-context.ts`'s `failingAction` section).

### 7.4 Discovery & linkage

- **`search(q)`** → global `GET /api/search`: cross-project search over project names, **run labels/ids**, and case titles. Complements the single-project `search_test_cases` (finding a run by label is impossible today).
- **`list_links(entityType, id)`** → `GET /api/links`: external URLs (Jira/PR/issue) attached to a run/case with unfurled status. "Which PR/issue is this failure tied to?"
- **`list_tags()`** + **`list_projects_by_tag(tag)`** → the tag catalog (only tag *names* leak today, inside `list_projects`).
- **`get_project_test_catalog(projectId)`** → `GET /api/projects/{id}/test-cases`: the whole test-case list *with* aggregated pass/fail/skip/flaky counts + avg duration + last status, ranked. A bulk companion to one-at-a-time `get_test_case`.

### 7.5 Write / triage tools (MCP is read-only today — this is a category gap)

These let an agent *close the loop* after fixing. Gate on `[ADMINISTRATOR, REPORTER]` and require an explicit confirmation-style argument.

- **`set_cluster_status(clusterId, status, note?)`** → `PATCH /api/failure-clusters/{id}/status`: mark a cluster resolved/ignored after the fix lands.
- **`run_cluster_diagnosis(clusterId, {force?, baseCommit?})`** → `POST /api/failure-clusters/{id}/diagnose`: trigger a fresh AI diagnosis (today only *reading* a stored one is possible).
- **`set_cluster_base_commit(clusterId, sha)`** → `PATCH …/base-commit`: pin the baseline so SCM-diff evidence is accurate.
- **`submit_diagnosis_feedback(diagnosisId, rating, note?)`** → `PATCH /api/failure-diagnoses/{id}/feedback`.

### 7.6 Composite & resources (biggest token win + ergonomics)

- **`explain_failure(testRunsCaseId)`** — one call that composes error + steps + console + slow/failed network (with server logs) + locator-healing recommendation + SCM diff-since-green + a screenshots pointer. Replaces the current 4–5 chained calls (`get_test_run_case` → `get_test_case_context` → `get_cluster_context` → `get_case_screenshots` → `get_locator_healing`) with a single evidence bundle — fewer round-trips and no duplicated preamble. This is the flagship usefulness+efficiency tool.
- **MCP resources** — expose read-only artifacts as `resources` (currently `[]`): test source snippets (`test_source`), decoded trace action lists, and report HTML by URI. Lets clients that prefer `resources/read` pull large artifacts out-of-band instead of inflating a tool result.

### 7.7 Cross-project situational awareness

- **`list_open_clusters()`** — open clusters across **all** in-scope projects, ranked by occurrences/recency: a triage queue. Today clusters are only reachable one project at a time.
- **`get_instance_stats()`** → `GET /api/admin/stats` (admin-gated): project/run/case/file counts + storage. Useful for an ops agent.

---

## 8. Prioritized execution plan

### P0 — Correctness & security (one PR, ~1 focused day)
1. `list_flaky_tests` field mapping + sort/cursor (§3.1) — and add the omitted `impact`/`rootCause`/`wastedCiMinutes` fields.
2. `list_failed_cases` cursor `executionId` (§3.2).
3. `list_runs` branch-filter in-memory cursor (§3.3).
4. `get_test_case_context` — ship the option-2 fallback now; open a follow-up for the builder's execution branch (§3.4).
5. `numericCursor` guard across cursor tools (§3.5).
6. Project-scope enforcement in the dispatcher + handlers (§5).
7. Tests for each of the above (see below).

### P1 — Token efficiency (one PR)
8. Paginate `get_run` cases + push the `failed` filter into SQL (§4.1).
9. Stop the `get_test_case` double-fetch (§4.2).
10. Slim `SELECT *` projections for `get_cluster`/`list_projects`/flaky (§4.3).
11. Trim catalog descriptions; move pagination boilerplate to `instructions` (§4.4).
12. Optional `include` on `get_test_run_case` + aria/console caps (§4.5).
13. Protocol version bump + `GET /mcp` → 405 (or move the setup page) + unify error surfacing (§6).

### P2 — New tools (incremental; each is a small handler + catalog entry + test)
14. Ship in value order: `get_run_insights`, `get_spec_health`, `get_network_requests`, `get_locator_healing`, `search`, `get_test_stability_trend`, `explain_failure`, then the triage writes and the rest of §7.

### Testing (extend `application/tests/mcp.spec.ts`)
- `tools/list` length assertion currently hard-codes **18** (`mcp.spec.ts:75,190`) — update it as tools are added, or assert `>= 18`.
- Add: `list_flaky_tests` → `items[0].flakyScore` is a finite number and `runCount`/`rootCause` present.
- Add: `list_failed_cases` two-page walk (page 2 returns rows, no error) — this reproduces §3.2.
- Add: `list_runs` branch-filtered two-page walk returns **disjoint** run ids — reproduces §3.3.
- Add: `get_test_case_context` on a case with steps/console returns non-empty `sections` — reproduces §3.4.
- Add: with `PIWI_AUTH_ENABLED=true`, a project-scoped key is refused on an out-of-scope `projectId` — reproduces §5.
- Add: `get_run` respects `pageSize` and never returns more than the cap.

### Docs to update in the same changes
- `docs/mcp.md` — tool count/table, new tools, auth-scope note, transport/protocol note.
- `AGENTS.md` "MCP Tool Conventions" — record the cursor-field rule (cursor extractor must read the **post-map** field name), the scope-enforcement requirement, and any new field-naming entries.
- `application/app/pages/mcp.vue` renders `MCP_TOOL_DEFS` automatically — no change needed beyond the catalog.

---

## Appendix A — Confirmed-bug reproduction (live)

| # | Tool | Call | Observed | Expected |
|---|------|------|----------|----------|
| 3.1 | `list_flaky_tests` | `{projectId:2}` | item keys `testCaseId,title,filePath` only | includes `flakyScore`, `runCount`, `rootCause`, `impact` |
| 3.2 | `list_failed_cases` | `{projectId:4,pageSize:1}` then reuse `nextCursor` | `nextCursor:"undefined"`; page 2 → `-32603 Failed query` | valid numeric cursor; page 2 returns rows |
| 3.3 | `list_runs` | `{projectId:2,branch:"main",pageSize:2}` ×2 | page 1 & 2 both ids `[21,22]`, same cursor | page 2 disjoint from page 1 |
| 3.4 | `get_test_case_context` | `{id:451}` (case has steps+console in DB) | text = "Data Coverage: all absent", `sections:[]` | populated `sections[]` with steps/console/error |
| 5 | scope | any project-scoped tool with a non-admin key | returns any project's data | refused unless assigned |

## Appendix B — Measured payload sizes (demo dataset, compact JSON)

`tools/list` 14.6 KB (~3,740 tok) · `list_projects` 0.7 KB · `get_project` 1.9 KB · `list_runs` 1.8 KB · `get_run` failed 0.3 KB / all-14 2.8 KB · `list_failed_cases` 0.4 KB · `list_flaky_tests` 0.14 KB (broken) · `list_clusters` 0.6 KB · `get_cluster` 0.4 KB · `get_cluster_diagnosis` 0.04 KB · `get_test_case_context` 1.8 KB (empty) · `get_cluster_context` 2.1 KB · `get_test_run_case` 1.9 KB · `list_recent_activity` 1.7 KB.

*Sizes scale with real data — `get_run` (unpaginated cases) and `get_test_run_case` (uncapped blobs) are the ones to watch at production volume.*
