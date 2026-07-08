# Test Audit & Improvement Plan — Piwi Dashboard

**Scope:** the custom Playwright **reporter** (`reporter/`) and the **application** (`application/`), covering both **unit** (Vitest) and **E2E** (Playwright) tests.
**Date:** 2026-07-08

> **Out of scope by request:** cross-matrix coverage of **storage backends** (local / S3) and **databases** (SQLite / PostgreSQL). A separate branch is moving CI to a `storage × db` matrix, so this audit does **not** flag "run test X against Postgres/S3 too" gaps. `postgresql.spec.ts`, `s3-storage.spec.ts`, and `storage-abstraction.spec.ts` are treated as already-handled.

---

## 1. Executive summary

| Surface | Source files | Test files | Headline |
|---|---|---|---|
| Reporter | 35 `.ts` | 13 spec (`~241` tests) | Good coverage of pure helpers; **`capture-fixtures.ts` (658 LoC) and `global-setup.ts` (126 LoC) are entirely untested**; several small pure modules untested. |
| App — unit | — | 20 test (`~202` tests) | Strong on fingerprint/patch/locator/oauth; **`app/utils/index.ts` (22 pure helpers), `sanitize.ts`, `link-detect.ts`, `computeErrorFingerprint` core have zero unit tests**. |
| App — E2E | 118 endpoints / 24 pages | 38 spec | ~40 endpoints have no dedicated E2E hit; several **shallow/misnamed** specs give false confidence. |

**Top findings**

- 🔴 **Useless test:** `tests/unit/aria-truncation.test.ts` tests a **copy-paste re-implementation** of `selectAriaForBudget`, not the real function (the file's own comment admits it). It cannot catch drift in production code.
- 🔴 **Shallow/misnamed test:** `tests/insights-and-spec-health.spec.ts` (1 test) only asserts 404/400 status codes and **never touches `spec-health` at all**.
- 🟠 **Core clustering key `computeErrorFingerprint` has no unit test** — only exercised indirectly through E2E. Given the `FINGERPRINT_VERSION` bump / demo-mirror discipline in `AGENTS.md`, this is the highest-value missing unit test.
- 🟠 **No coverage tooling** (`@vitest/coverage-v8` not configured) and **no component/composable test environment** (`vitest.config.ts` runs in node, not `environment: 'nuxt'`) — 22 of 23 composables and all Vue components are only reachable through E2E.
- 🟡 **Low-value/brittle:** `reporter/tests/build-output.spec.ts` asserts substring presence in compiled `dist/*.d.ts` — duplicates what `tsc` already guarantees and breaks on harmless renames.

---

## 2. Methodology

1. Enumerated every source module and mapped it to the test file(s) that import it.
2. For E2E, extracted every `/api/...` path referenced across the 38 specs and diffed against the 118 endpoint handlers.
3. Read the suspicious/low-value specs in full to confirm what they actually assert.
4. Classified each finding as **Missing**, **Redundant**, or **Useless/Low-value**, with a priority (P0 = high-value/low-effort, P2 = nice-to-have).

---

## 3. Reporter (`reporter/`)

### 3.1 Coverage map

| Module | Tested by | Status |
|---|---|---|
| `internal/config/env.ts` | `config.spec.ts` | ✅ |
| `internal/support/{ci,cli-filters,instance-id,limiter,setup-file,source-snippet,worker-index}.ts` | `helpers.spec.ts` | ✅ |
| `internal/support/logger.ts` | `logger.spec.ts` | ✅ |
| `internal/transport/http-client.ts` | `http-client.spec.ts` | ✅ |
| `internal/capture/locator-healing.ts` | `locator-healing.spec.ts` (74 tests) | ✅ strong |
| `internal/collect/metadata-collector.ts` | `metadata-collector.spec.ts` | ✅ (thin — 6 tests for 225 LoC) |
| `internal/collect/skip-classify.ts` | `skip-classify.spec.ts` | ✅ |
| `internal/collect/step-analyzer.ts` | `step-analyzer.spec.ts` | ✅ strong |
| `internal/submit/serializer.ts` | `serializer.spec.ts` | ✅ |
| `internal/submit/uploader.ts` | `serializer.spec.ts` (partial) | 🟡 partial |
| `internal/streaming/{stream-manager,stream-buffer,crash-recovery}.ts` + `internal/files/file-handler.ts` | `stream-manager.spec.ts` | ✅ |
| `internal/submit/run-submitter.ts` + `public/reporter.ts` | `submit-ladder.spec.ts` | 🟡 fallback ladder only |
| `public/config-wrapper.ts` | `config-wrapper.spec.ts` | ✅ |
| **`internal/capture/capture-fixtures.ts` (658)** | — | ❌ **none** |
| **`public/global-setup.ts` (126)** | — | ❌ **none** |
| **`internal/collect/error-text.ts` (45)** | — | ❌ none |
| **`internal/files/compression.ts` (37)** | — | ❌ none |
| **`internal/support/errors.ts` (11)** | — | ❌ none |
| `internal/capture/attachments.ts` (constants) | — | ⬜ n/a (constants only) |

### 3.2 Missing (reporter)

| # | Target | Why it matters | Priority |
|---|---|---|---|
| R1 | `internal/collect/error-text.ts` → `buildErrorText()` | Produces the error string that feeds fingerprinting/clustering. Pure over a `TestResult` — easy to fake. Test: single error, multiple errors joined, error with no message, snippet/stack presence. | **P0** |
| R2 | `internal/files/compression.ts` → `compressDirectory()` | Gzip/tar of report dirs is on the upload critical path. Test with a temp dir: round-trips a nested tree, empty dir, returns a `Buffer`. | **P0** |
| R3 | `internal/support/errors.ts` → `errorMessage()` | Trivial but used in every `catch`. Test: `Error`, string, `HttpError`, `undefined`, object without `message`. | **P1** |
| R4 | `public/global-setup.ts` → `createGlobalSetup()` | Registers the run **before** `globalSetup`; sharding/runLabel logic lives here. Test with a mocked `HttpClient`: registers once, applies `runLabel`, swallows failures without throwing (must never break a user's suite). | **P1** |
| R5 | `internal/capture/capture-fixtures.ts` | Largest untested file. Full worker/browser wiring needs a real page, but the **pure** pieces (snapshot dedup by location, network filtering/capping, the in-page probe's `hasLabel`/`selectorCounts` shaping, the "never capture `value`" guarantee) should be extracted and unit-tested. At minimum add a fixtures **integration** spec that runs the reporter against a tiny fixture project and asserts the `piwi-*` attachments produced. | **P1** |
| R6 | `internal/collect/metadata-collector.ts` (deepen) | 225 LoC / 6 tests. Missing: CI provider detection per env-var set (GitHub/GitLab/etc.), `detectCiRunLabel()` per provider, SCM remote sanitization, browser config extraction. | **P2** |
| R7 | `internal/submit/uploader.ts` (deepen) | Currently only reached tangentially via `serializer.spec.ts`. Add direct tests for `uploadJSON` vs `uploadWithFiles` body assembly and the streaming-file path. | **P2** |

### 3.3 Redundant / low-value (reporter)

| # | Test | Assessment | Action |
|---|---|---|---|
| R-L1 | `build-output.spec.ts` (9 tests) | Reads compiled `dist/*.d.ts` / `*.js` and asserts substrings (`toContain('serverUrl')`, `toContain('collectPerformanceMetrics')`). This re-asserts what `tsc` emission + typecheck already guarantee and **breaks on harmless renames**. It also forces a build before unit tests can pass. | **Trim.** Keep only genuine packaging guards (`package.json` `main`/`types`/`exports` shape; "single entry, no `./fixtures` subpath"; fixtures re-exported from `index`). Delete the field-by-field `.d.ts` substring assertions. |

---

## 4. Application — unit (Vitest)

### 4.1 Coverage map (what IS tested)

`ai-context` sections (partial), `cluster-similarity`, demo SCM + seed diagnoses, `ai-diagnosis` unique-violation, `diagnosis-versions`, `locator-fingerprint`, `locator-healing` (+ `extractLeafSelector`), `oauth-helpers`, `patch`, `piwi-env-vars`, reporter↔shared drift, `retry-command`, `test-counts`, `text-format`, `useTimelineModel`, `trace-parser` (thin), `wasted-waits`, `flaky-classify`.

### 4.2 Missing (unit) — pure logic with zero coverage

| # | Target | Notes | Priority |
|---|---|---|---|
| U1 | **`shared/error-fingerprint.ts` → `computeErrorFingerprint`, `maskVolatile`, `condenseErrorText`, `stripAnsi`, `extractSelector`, `extractTopFrameFile`, `extractErrorSignature`** | The **failure-clustering grouping key**. Only `extractLeafSelector` is currently tested. Test: stable hash for equal errors, differing types → different fingerprints, volatile-token masking (uuids/timestamps/ports/hex), stack frame **not** hashed, `FINGERPRINT_VERSION` participates in the hash. **Add a demo-mirror drift test** (like `reporter-shared-drift.test.ts`) asserting `computeErrorFingerprint` == `scripts/generate-demo-seed.mjs#computeDemoFingerprint` for a fixture set. | **P0** |
| U2 | **`app/utils/index.ts` (22 exported helpers)** | `formatBytes`, `formatDuration`, `formatRelativeTime`, `getStatusColor`, `clusterStatusColor`, `clusterErrorTypeColor`, `errorMessage`, `filterCommits`, `scmFileStatusMeta`, `parsePatchLines`, `patchLineClass`, `renderAnsi`, `getFileApiPath`, `getTraceViewerUrl`, `copyPreview`, … Used across the whole UI, all pure, **none tested**. High value / low effort. | **P0** |
| U3 | **`server/utils/sanitize.ts` (6 sanitizers)** | Security-sensitive secret/PII redaction: `sanitizeUrl`, `sanitizeGitRemoteUrl` (strips creds), `sanitizeNetworkRequests`, `sanitizeWebVitals`, `sanitizeMetadata`, `sanitizeConsoleLogs`. Test that credentials/tokens are stripped and shapes are capped. A regression here leaks secrets. | **P0** |
| U4 | **`shared/link-detect.ts`** | `detectProvider` / `extractKey` / `getProviderIcon` across all 11 providers (Jira, GitHub issue/PR, GitLab, Bitbucket, Confluence, Slack, Linear, Notion, generic). Pure regex, trivial to table-test. | **P1** |
| U5 | `shared/utils/stats.ts` | `percentile` (empty, single, interpolation, p90/p50) and `durationStats` (nulls filtered, avg/p90). Pure math with edge cases. | **P1** |
| U6 | `shared/utils/route.ts` + `shared/utils/filter-network-requests.ts` | `normalizeRoute` (query/id normalization) and `filterAndCapNetworkRequests` (tracked types, cap). Both pure; feed slow-endpoints + network UI. | **P1** |
| U7 | `shared/utils/suites.ts` | `splitSuitePath` / `joinSuitePath` round-trip with the `\x1f` separator; empty/nullish. | **P2** |
| U8 | `shared/notification-events.ts` → `renderEventSubject` | Subject rendering per event type. Pure. | **P2** |
| U9 | `server/utils/cluster-naming.ts` | Deterministic cluster names from signatures. Pure. | **P2** |
| U10 | `server/utils/parse-location.ts` | `file:line:col` parsing incl. malformed input. Pure. | **P2** |
| U11 | `app/utils/performance-hints.ts` | Slow/flaky warning generation. Pure. | **P2** |
| U12 | `server/utils/trace-parser.ts` (deepen) | 422 LoC / 4 tests. Add malformed-trace, empty, and large-file cases. | **P2** |

### 4.3 Useless / redundant (unit)

| # | Test | Assessment | Action |
|---|---|---|---|
| U-X1 | **`tests/unit/aria-truncation.test.ts`** | 🔴 **Useless.** It re-implements `selectAriaForBudget` **inside the test file** and tests the copy — the real function in `server/utils/ai-context.ts` is never imported (it isn't exported). The file's own comment says *"we test via ... a local re-implementation."* Production drift cannot be caught. | **Fix:** export the real `selectAriaForBudget` from `ai-context.ts` and import it here; **delete the inline copy**. If exporting is undesirable, delete this file — it currently protects nothing. |
| U-X2 | `demo-scm.test.ts` **&** `demo-seed-diagnoses.test.ts` | 🟡 **Overlap.** Both assert "suggested-fix patch validates against seeded source files" (`demo-scm` §"stay in sync"; `demo-seed-diagnoses` "every suggested-fix patch validates"). Both cover **demo-only** scaffolding. | **Consolidate** the patch-validation assertion into one file; keep the other focused on its unique concern (SCM history shape vs diagnosis details shape). Low urgency. |

---

## 5. Application — E2E (Playwright)

### 5.1 Endpoints with **no dedicated E2E** hit

Confirmed by diffing all 118 handlers against every `/api/...` reference in the 38 specs:

| Endpoint | Area | Priority |
|---|---|---|
| `POST /api/test-runs/[id]/heartbeat` | Streaming liveness | **P1** |
| `GET /api/test-runs/[id]/summary` | Run summary projection | **P1** |
| `GET /api/projects/[id]/latest-run` | Project dashboard | **P1** |
| `GET /api/projects/overview` | Home dashboard aggregate | **P1** |
| `POST /api/failure-clusters/[id]/diagnose/stream` | **Streaming** AI diagnosis (only non-stream path is tested) | **P1** |
| `POST /api/failure-clusters/[id]/extract-cases` | Cluster case extraction | **P1** |
| `PATCH /api/failure-diagnoses/[id]/feedback` | Diagnosis 👍/👎 feedback | **P2** |
| `GET/PUT /api/projects/[id]/members` | Project-assignment membership | **P1** (authz-sensitive) |
| `GET/PUT /api/settings/ai/limits` | AI context limits | **P2** |
| `GET /api/settings/ai/usage`, `POST /api/settings/ai/models` | AI settings | **P2** |
| `GET/PUT /api/settings/wasted-waits` | Wasted-waits settings (pure logic is unit-tested; endpoint is not) | **P2** |
| `PATCH /api/links/[id]`, `POST /api/links/[id]/refresh` | Entity-link edit/unfurl-refresh (`entity-links.spec.ts` has only 2 tests) | **P2** |
| `GET /api/auth/verify-email`, `POST /api/auth/send-verify-email` | Email-verification flow | **P2** |
| `auth/oauth/[provider]/{login,callback,unlink}` | OAuth flow (helpers unit-tested; flow needs a stub provider) | **P2** |

### 5.2 Thin / shallow flows worth deepening

| Area | Current | Gap |
|---|---|---|
| `spec-health` | Named in `insights-and-spec-health.spec.ts` but **not tested at all** | Add real assertions on the grouping/pass-rate output of `GET /api/projects/[id]/spec-health`. |
| `insights` | 1 test, 404 only | Assert insight content for a run with known slow/flaky cases. |
| `flaky-classify` | 1 test, 400 only | Assert an actual classification result end-to-end. |
| `entity-links` | 2 tests | Add edit (`PATCH`), delete cascade, and unfurl refresh. |
| `stability-trend` | 404 only | Assert trend series for a case with history. |

### 5.3 Useless / low-value (E2E)

| # | Test | Assessment | Action |
|---|---|---|---|
| E-X1 | **`tests/insights-and-spec-health.spec.ts`** | 🔴 **Shallow & misnamed.** 1 test asserting only `404`/`400` for `insights`, `flaky-classify`, `stability-trend`. It **never calls `spec-health`** despite the filename, and never asserts behavior. False confidence. | **Rewrite:** split into real behavioral tests per endpoint (see 5.2), including the actual `spec-health` endpoint. |

---

## 6. Cross-cutting gaps

| # | Gap | Recommendation | Priority |
|---|---|---|---|
| X1 | **No coverage tooling.** Neither Vitest project configures `@vitest/coverage-v8`. Gaps are found by eye, not measured. | Add `coverage` (v8) to `vitest.config.ts` (app + reporter), wire `npm run app:test:unit -- --coverage`, and print a summary in CI. Set a soft threshold on `shared/` + `server/utils/` pure modules. | **P1** |
| X2 | **No component/composable test environment.** `vitest.config.ts` runs in node; `@nuxt/test-utils` is installed but unused. Only `useTimelineModel` is unit-tested; the other 22 composables (incl. `useClusterDiagnosis` 290 LoC, `useStreamingDiagnosis` 264, `useTimelineViewport` 224, `useRunStream` 163, `useRunComparison` 126, `useScmStatusSummary` 87) and all Vue components are reachable only via E2E. | Add a second Vitest project with `environment: 'nuxt'` (or happy-dom) for composables/components. Start with the pure-reactive composables (`useRunComparison`, `useScmStatusSummary`, `useTimelineViewport`) which need no network. | **P2** |
| X3 | **Reporter/shared structural mirrors** are only partly drift-guarded. `reporter-shared-drift.test.ts` covers locator-healing; add equivalent drift tests for the wire ↔ `shared/types.ts` contract and the fingerprint mirror (see U1). | Extend the drift-test pattern. | **P1** |

---

## 7. The plan (phased)

Effort key: **S** ≈ <½ day, **M** ≈ ½–1 day, **L** ≈ >1 day.

### Phase 1 — High-value, low-effort pure-logic units (P0)
> Biggest confidence gain per hour. All node-only Vitest, no infra changes.

1. **U1** `tests/unit/error-fingerprint.test.ts` — `computeErrorFingerprint` + maskers + demo-mirror drift. **M**
2. **U2** `tests/unit/app-utils.test.ts` — the 22 helpers in `app/utils/index.ts`. **M**
3. **U3** `tests/unit/sanitize.test.ts` — 6 sanitizers, focus on credential/secret stripping. **S**
4. **R1** `reporter/tests/error-text.spec.ts` — `buildErrorText`. **S**
5. **R2** `reporter/tests/compression.spec.ts` — `compressDirectory` round-trip via temp dir. **S**
6. **R3** `reporter/tests/errors.spec.ts` — `errorMessage`. **S**

### Phase 2 — Clean up the misleading tests (P0)
> Removes false confidence; small diffs.

7. **U-X1** Fix/delete `aria-truncation.test.ts` — export the real `selectAriaForBudget` and test it. **S**
8. **E-X1** Rewrite `insights-and-spec-health.spec.ts` into real behavioral tests (incl. actual `spec-health`). **M**
9. **R-L1** Trim `build-output.spec.ts` to genuine packaging guards. **S**
10. **U-X2** Consolidate the duplicated demo patch-validation assertion. **S**

### Phase 3 — Remaining pure units + reporter depth (P1)
11. **U4–U6** `link-detect`, `stats`, `route` + `filter-network-requests`. **S–M**
12. **R4** `global-setup.spec.ts` (mocked `HttpClient`). **M**
13. **R5** Extract + unit-test the pure pieces of `capture-fixtures.ts`; add a fixtures integration spec. **L**
14. **X3** Wire ↔ `shared/types.ts` drift test. **S**

### Phase 4 — E2E endpoint gaps (P1)
15. New/extended specs for: `heartbeat`, `summary`, `latest-run`, `projects/overview`, `diagnose/stream`, `extract-cases`, `projects/[id]/members` (authz). One `endpoints-coverage.spec.ts` or fold into the relevant domain spec. **M–L**

### Phase 5 — Infrastructure & long tail (P1–P2)
16. **X1** Add `@vitest/coverage-v8` to both Vitest configs; report in CI. **S**
17. **X2** Stand up a `environment: 'nuxt'` Vitest project; test the 3 pure-reactive composables first. **M**
18. **U7–U12, R6–R7** Remaining P2 pure/deepening units. **M**
19. Remaining P2 E2E (settings/ai/*, wasted-waits, links edit/refresh, verify-email, oauth flow). **M**

### Suggested new test files
```
application/tests/unit/error-fingerprint.test.ts     (U1)
application/tests/unit/app-utils.test.ts             (U2)
application/tests/unit/sanitize.test.ts              (U3)
application/tests/unit/link-detect.test.ts           (U4)
application/tests/unit/stats.test.ts                 (U5)
application/tests/unit/route-and-network.test.ts     (U6)
application/tests/unit/wire-shared-drift.test.ts     (X3)
application/tests/endpoints-coverage.spec.ts         (Phase 4)
reporter/tests/error-text.spec.ts                    (R1)
reporter/tests/compression.spec.ts                   (R2)
reporter/tests/errors.spec.ts                        (R3)
reporter/tests/global-setup.spec.ts                  (R4)
reporter/tests/capture-fixtures.spec.ts              (R5)
```

---

## 8. Appendix — priority index

| ID | Title | Type | Priority | Effort |
|---|---|---|---|---|
| U1 | `computeErrorFingerprint` + maskers + demo drift | Missing (unit) | P0 | M |
| U2 | `app/utils/index.ts` 22 helpers | Missing (unit) | P0 | M |
| U3 | `sanitize.ts` secret stripping | Missing (unit) | P0 | S |
| U-X1 | `aria-truncation.test.ts` tests a copy | **Useless** | P0 | S |
| E-X1 | `insights-and-spec-health.spec.ts` shallow/misnamed | **Useless** | P0 | M |
| R1 | reporter `buildErrorText` | Missing | P0 | S |
| R2 | reporter `compressDirectory` | Missing | P0 | S |
| R-L1 | reporter `build-output` `.d.ts` substring asserts | Low-value | P1 | S |
| U-X2 | demo patch-validation overlap | Redundant | P1 | S |
| U4–U6 | `link-detect`/`stats`/`route`/`filter-network-requests` | Missing | P1 | S–M |
| R3–R5 | reporter `errorMessage`/`global-setup`/`capture-fixtures` | Missing | P1 | S–L |
| X1 | coverage tooling | Cross-cutting | P1 | S |
| X3 | wire ↔ shared drift test | Missing | P1 | S |
| Phase 4 | ~7 untested endpoints | Missing (E2E) | P1 | M–L |
| X2 | composable/component test env | Cross-cutting | P2 | M |
| U7–U12, R6–R7 | pure/deepening long tail | Missing | P2 | M |
