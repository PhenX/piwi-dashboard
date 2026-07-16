# Database structure audit

_Audited: July 2026 · dashboard v0.12.0 · covers both SQLite and PostgreSQL backends._

This document records a full audit of the Piwi Dashboard database layer — schema structure, growth behavior, query patterns, and dialect parity — together with the rationale for the improvement program that followed. Statements about the code reference the state at audit time; the "Improvement program" section maps each finding to its fix.

## 1. Summary

The schema's core shape is sound: lean identity tables (`test_cases`, `test_suites`), a per-execution junction (`test_runs_cases`), content-addressed trace storage, and clustering tables deduplicated by fingerprint. The problems concentrate in four areas:

1. **Per-run payload redundancy.** Every execution row re-stores large text/JSON payloads (ARIA snapshot, test source snippets, error text) that are byte-identical across consecutive runs of an unchanged test. Nothing deduplicates, truncates, or expires them.
2. **Unbounded growth.** There is no automatic retention; the notification outbox is never pruned; space reclamation after the manual cleanup is a no-op on SQLite and crashes on PostgreSQL.
3. **Missing indexes** on hot correlated subqueries, cascade targets, and a refcount scan that runs on every trace deletion.
4. **Dialect drift.** The two hand-maintained schemas (`schema.sqlite.ts` / `schema.pg.ts`) had diverged — including one drift that disables a concurrency guard on PostgreSQL — and nothing guarded against future drift.

## 2. Storage model at audit time

| Layer | Location | Dedup | Growth |
|---|---|---|---|
| Test run/case rows | DB (`test_runs`, `test_runs_cases`) | none | per run × case × retry × browser |
| Per-case payloads (ARIA, source, error, steps, console) | DB columns on `test_runs_cases` | none | same as above — the growth center |
| Network requests | DB child table `network_requests` | capped (failures + top 50) | per case |
| Locator snapshots | DB `locator_snapshots` | upsert per (test_case, location) | bounded |
| Traces | filesystem/S3 + `trace_blobs`/`trace_resources` | SHA-256 content-addressed | bounded per unique content |
| HTML reports, screenshots, videos | filesystem/S3 + `files` rows | none | per run |
| Failure clusters / AI diagnoses | DB | fingerprint-deduped / per diagnosis | bounded; version history unbounded |
| Notification outbox | DB `notification_deliveries` | dedupe key on insert | never pruned |

## 3. Findings

### 3.1 Per-run payload redundancy (the growth center)

`test_runs_cases` holds one row per test × browser × retry × run. All ingest endpoints (`submit`, `upload`, streaming `events`) funnel into a single writer, `server/utils/persist-run-cases.ts`, which stores per row:

| Column | Written | Redundancy across runs | Size (typical) | Cap at audit time |
|---|---|---|---|---|
| `aria_snapshot` | failures only | near-identical for the same failing page | 5–50+ KB (largest column) | none |
| `test_source` | failures only | identical while the test file is unchanged (±30 lines around the failing line) | 3–6 KB | none |
| `test_source_frames` | failures only | identical; the test-file frame **also duplicates part of `test_source` within the same row** | 2–4 KB | none |
| `error` | failures | identical for a stable failure | 1–3 KB | none |
| `steps`, `step_events` | every run | structure identical, only durations vary | 2–5 KB each | none |
| `console_logs` | runs with warn/error output | often identical | unbounded | none (URL rewrite only) |
| `browser` | every run | identical for a fixed project config; duplicates the adjacent `browser_name` scalar | 200–400 B | — |
| `test_annotations` | every run | identical | small | — |
| `page_state` | every run | mostly identical | 1–3 KB | capped (`sanitize.ts`) |

A passing execution row is ~3–10 KB; a failing one ~20–70 KB. A test that fails the same way for 100 runs stores ~100 copies of the same ARIA tree, source snippet, frames, and stack.

Counter-examples already in the codebase showed the right patterns: `trace_blobs` (SHA-256 content-addressing per project, idempotent upsert, implicit refcount on delete), `locator_snapshots` (upsert per call site, purge on pass), `network_requests` (verticalized out of a JSON blob, capped), `failure_clusters.sample_error` (one exemplar per fingerprint).

### 3.2 Growth and retention

- **No automatic retention.** The only pruning is the manual admin endpoint (Settings → Storage), which deletes runs older than N days on demand.
- **`notification_deliveries` is never deleted** — the outbox sweep only flips row status; one row per event × channel accumulates forever.
- **`failure_diagnosis_versions`** appends a snapshot on every re-diagnose with no cap.
- **Space reclamation was broken twice over:** the cleanup endpoint ran `PRAGMA incremental_vacuum` via `db.run(...)`, which throws on PostgreSQL (no `.run()` on the postgres-js client, and `PRAGMA` is not SQL there) and is a silent no-op on SQLite because `auto_vacuum` was never enabled at database creation.
- **Trace-resource GC is coarse:** shared resources are reclaimed only when a project's blob count reaches zero, so a project that always retains at least one trace never frees orphaned resources.
- HTML reports, screenshots, and videos are stored per run with no content dedup (traces are the only deduplicated artifact).

### 3.3 Foreign-key enforcement and orphaned rows

The schemas declare `ON DELETE CASCADE` throughout, but the SQLite client never issued `PRAGMA foreign_keys=ON`, so cascades do not fire at runtime on SQLite; all delete paths rely on explicit child deletion. The manual cleanup endpoint deleted files, case rows, and runs — but not `network_requests`, `entity_links`, or execution-scoped `failure_diagnoses`, leaving orphans on SQLite. PostgreSQL enforces the same FKs natively, so the two backends silently disagreed about what a delete leaves behind.

### 3.4 Missing indexes

- `test_runs_cases.created_at` — the project test-cases page and test-case detail run correlated subqueries per test case ordered by `created_at` (`shared/handlers/projects.ts`, `shared/handlers/test-cases.ts`); with no index this is O(cases × executions) per page view.
- `files.blob_id` — the trace refcount check (`SELECT count(*) … WHERE blob_id = ?`) scans `files` on **every** trace deletion.
- Cascade/`SET NULL` targets with no child index: `locator_snapshots.last_seen_run_id`, `failure_diagnosis_versions.test_runs_case_id`, `notification_deliveries.subscription_id`, `account_tokens.user_id`, `test_cases.suite_id`, `cluster_merge_suggestions.cluster_b_id`, `entity_links.created_by`, `project_assignments.created_by` — each turns a parent delete into a child-table scan.
- Filter columns with no index: `test_runs.status`, `failure_clusters.status` (project triage lists).
- Deliberately **not** indexed after analysis: bare `test_runs_cases.status` and `test_runs_cases.created_at` (low selectivity / covered by the composite below; a fifth index on the hottest insert path isn't free), `failure_diagnoses.status` (tiny per-key cardinality).

### 3.5 Query-layer waste

- `getProject` loaded **all** runs of a project with no limit, and derived the distinct browser list by selecting and JSON-parsing the wide `browser` column of every case row of every run — when the scalar `browser_name` column (added "for index efficiency") already exists.
- `getTestRun` re-computed wasted-wait time by pulling `step_events` JSON for every case on every read; the stored `wasted_time_ms` column is authoritative whenever the wasted-wait patterns are at their defaults (the recompute exists only to serve customized patterns).
- Flakiness/slow-test/spec-health analytics load the last N runs' case rows into JS per request. Acceptable at current scale; a materialized flakiness rollup is a future option (see §6).

### 3.6 Dialect drift (SQLite ↔ PostgreSQL)

The two schema files are hand-maintained in parallel and had drifted:

1. **`failure_diagnoses` unique indexes** — SQLite has `(cluster_id, scope)` **and** `(test_runs_case_id, scope)`; PostgreSQL only had the latter. The AI-diagnosis concurrency guard deliberately relies on the `(cluster_id, scope)` unique constraint to catch a SELECT/INSERT race, so PostgreSQL could insert duplicate `running` diagnoses. The PG schema even carried a comment referencing the index it didn't have.
2. `test_runs_cases.started_at` — `integer` (SQLite) vs `bigint` (PG); intentional (ms epoch), allowlisted.
3. Boolean columns (`users.email_verified`, `notification_channels.verified`, `subscriptions.active`) — boolean-mode integers on SQLite vs plain integers on PG.
4. `entity_links` is the only PG table using timezone-aware timestamps and `defaultNow()`.
5. Four columns store JSON as plain `text` in both dialects (`failure_clusters.embedding`, `locator_snapshots.element_attrs/alternatives/used_args`) rather than `jsonb` on PG.
6. The two migration journals are independent and index-misaligned (the same logical change lands at different sequence numbers), which makes manual cross-checking error-prone — drift #1 is exactly the class of bug this produces.

There was no automated check comparing the two schemas.

### 3.7 Change blast radius (evolvability)

A change to `test_cases`/`test_runs_cases` touches: both schema files, two generated migration sets, the demo seed generator (replays SQLite migrations; literal row data), the shared handlers, and ~14 direct MCP query sites. This is workable but demands guardrails: the drift test (§3.6) and conventions (AGENTS.md checklists) carry that weight.

## 4. Design decisions and rationale

### 4.1 Content-addressed payload storage (`case_payloads`)

Large failure evidence (`aria_snapshot`, `test_source`, `test_source_frames`) moves to a content-addressed table modeled on `trace_blobs`: `(project_id, hash, content, size)` with a unique `(project_id, hash)` index, referenced from `test_runs_cases` via three nullable `*_payload_id` columns. The server hashes at ingest (SHA-256 via the existing browser-safe `sha256Hex`), so **no reporter release is required** and third-party submitters benefit automatically.

- **Why not "latest-only" upserts** (the `locator_snapshots` pattern): consumers need per-run history. Any historical execution page, the execution-scoped AI diagnosis, and MCP evidence tools must show the payloads *as of that execution* — a test that failed with source S1 in run 40 and S2 in run 55 must still show S1 on run 40.
- **Why not "NULL means same-as-previous"**: reads would need per-field walk-back subqueries, and retention deleting the base row would destroy the value for every newer row that pointed at it.
- **Why `error` stays inline**: it is read by wide, hot list paths (run case lists, cluster ops, MCP truncated messages); moving it join-amplifies the hottest reads for modest savings. It gets an ingest cap instead, and `failure_clusters.sample_error` remains the one full exemplar per root cause.
- **Why `steps`/`step_events` are not content-addressed**: durations vary per run, so hashes would never collide. They get count caps; a structure-vs-timings split is future work (§6).
- **Back-compat**: the inline columns are kept and readable (reads coalesce `payload.content ?? inline column`); old rows are never rewritten; the demo seed keeps writing inline columns, permanently exercising the fallback branch.
- **GC**: run deletion collects candidate payload ids, then deletes payloads with no remaining references (partial indexes on the three ref columns make the reachability probes cheap); project deletion cascades via `project_id`; a bounded orphan sweep acts as a safety net.

Effect: 100 identical failures ≈ 1 ARIA snapshot + 1 source snippet + 1 frames blob + 100 integer refs, instead of 100 × 10–60 KB. Identical payloads across browsers/retries within one run dedupe too.

### 4.2 Ingest caps, separate from AI prompt limits

Storage caps (`PIWI_INGEST_MAX_*`, `shared/ingest-limits.ts`) bound what is persisted forever; the existing `PIWI_AI_MAX_*` limits bound what enters a prompt. They are deliberately separate registries with consistent field naming, and storage defaults sit at or above the AI-limit maxima so AI limits remain the binding constraint for prompts. Caps apply in the single ingest choke point (`persistRunCases`), after error fingerprinting so clustering is unaffected.

### 4.3 Retention: opt-in for run data, on-by-default for housekeeping

Deleting test history is destructive, so `PIWI_RETENTION_DAYS` is **off unless set**. Pruning delivered/failed notification outbox rows (default 30 days) and capping diagnosis version history (default 20 per diagnosis) are bounded housekeeping and default on. The sweep runs as a Nitro scheduled task; the manual admin endpoint remains, now sharing the same util, with an explicit `vacuum` option for reclaiming space on pre-existing SQLite databases.

### 4.4 Foreign keys: enforce AND keep explicit deletes

`PRAGMA foreign_keys=ON` is enabled for SQLite (parents are always inserted before children in ingest; the intentionally-non-FK columns on `failure_clusters` are unaffected), **and** the retention util performs explicit ordered child deletes. Correctness does not depend on the pragma — it is belt and braces, and it converges SQLite behavior with PostgreSQL.

### 4.5 Drift guard as a unit test

A schema-drift test introspects both Drizzle schemas (`getTableConfig`) and asserts identical tables, columns (null-ability, PK, defaults), FK edges (including `onDelete`), and index inventory (name, columns, uniqueness, partial predicates), modulo an explicit type-equivalence map and a `KNOWN_DIALECT_DIFFS` allowlist. It also asserts every FK child column is covered by an index prefix. Bug-class §3.6.1 cannot recur silently.

## 5. Improvement program

| Phase | Commit | Contents |
|---|---|---|
| P1 | `fix(db)` | PG `(cluster_id, scope)` unique index + duplicate cleanup migration; stale comment fix; **schema drift guard test** |
| P2 | `fix(db)` | SQLite FK enforcement; `auto_vacuum` on fresh DBs; dialect-aware `reclaimSpace`; retention util with explicit child deletes + orphan sweep; cleanup endpoint made dialect-safe + `vacuum` flag |
| P3 | `feat(app)` | Ingest storage caps (`PIWI_INGEST_MAX_*`) for console/steps/aria/error/source frames + `sample_error` cap |
| P4 | `perf(db)` | Index pass: composite `(test_case_id, created_at)` swap, `files.blob_id`, cascade targets, status filters; `browser_name` backfill migration |
| P5 | `perf(app)` | `getProject` run window + scalar browser aggregation; skip wasted-time recompute when patterns are default |
| P6 | `feat(app)` | Scheduled retention sweep (`PIWI_RETENTION_DAYS`, `PIWI_RETENTION_NOTIFICATION_DAYS`, `PIWI_RETENTION_DIAGNOSIS_VERSIONS`) |
| P7 | `feat(db)` | `case_payloads` content-addressed dedup + ref columns + coalescing reads + GC |

## 6. Deferred follow-ups (not in this program)

- **Reporter-side snippet consolidation**: widen the innermost source frame to ~30 lines and stop sending the legacy `test_source` string (server keeps accepting it from old reporters indefinitely). Ship after `case_payloads` proves out in production.
- **`steps`/`step_events` structure-vs-timings split**: store the per-test step template once (content-addressed) and per-run duration arrays separately. Only worth it if step payloads dominate after P3/P7 — measure first.
- **Report/screenshot content dedup**: extend the blob pattern to HTML reports and screenshots (many are pixel-identical across runs).
- **Flakiness/analytics materialization**: incremental per-test rollups updated at run finish instead of per-request JS aggregation over the last N runs.
- **Finer trace-resource GC**: manifest-based reference counting instead of the project-blob-count-zero heuristic.
- **PG jsonb migration** for the four text-encoded JSON columns, if in-DB JSON querying is ever needed.

## 7. Verification approach

- `tests/unit/schema-dialect-drift.test.ts` fails on any new cross-dialect divergence (proved by failing on §3.6.1 before its fix).
- Dedup proof: submitting the same failing run twice yields one `case_payloads` row per payload with two referencing executions, and read paths (execution page, AI context, MCP) render both pre-migration (inline) and post-migration (ref) rows.
- Retention proof: deleting aged runs on a seeded database leaves zero orphaned `network_requests`/`entity_links`/diagnoses/payloads.
- Full unit + Playwright suites, demo seed regeneration, and typecheck/lint gate the branch.
