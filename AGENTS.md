# Piwi Dashboard — Agent Instructions

> **Note:** Piwi Dashboard is **not affiliated with, endorsed by, or connected to Microsoft Corporation** in any way.  
> The name "Piwi" was chosen as a playful, unrelated name — it has no connection to any existing product or brand.  
> Piwi Dashboard was originally called "Playwright Dashboard" and was renamed to avoid any confusion with Microsoft's Playwright testing framework.

This file provides project context for any AI agent (opencode, Copilot, Cursor, etc.).

## Project Overview

Piwi test results dashboard built with **Nuxt 4**, Nuxt UI dashboard template. Stores and displays Playwright test results organized by projects.

## Prerequisites

- Node.js 24+, npm, Git
- Commands run from `application/` unless noted

## Repository Structure

```
application/            — Nuxt 4 dashboard app
application/shared/     — Shared types, constants & utilities (import via `#shared/...`, not relative paths or `~~/shared/...`)
application/tests/      — Functional tests (Playwright)
packages/core/          — `@piwitests/core`: pure logic shared by the app AND the reporter (bundled into the reporter — see below)
plans/                  — Design docs, audit plans & roadmap (see below)
reporter/               — Custom Playwright reporter package (TypeScript → bundled JS via tsup)
```

> **Global tracking files:** 
> - `plans/roadmap.md` — single source of truth for product direction, priorities, and progress
> - `plans/exploration-findings.md` — log of bugs, tech debt, inconsistencies, and non-critical issues discovered during exploration (auto-appended by agents)
> 
> Detailed per-feature implementation plans live alongside them. (`plans/` is gitignored, so these are local working docs, not committed.)

## Quick Start

```bash
cd application
npm install
npm run app:dev      # http://localhost:3000
```

SQLite database auto-initializes on first API call.

## Architecture

### Shared types (`application/shared/types.ts`)
- `TestCasePayload`, `StreamEventPayload`, `TestRunFinishPayload` — API payload shapes
- `TestRunStatus`, `TestCaseStatus` — status type unions
- Server endpoints import directly from `#shared/types`
- The small wire **leaf shapes** (`BrowserConfig`, `TestStepEvent`, `SuiteConfigEntry`, `TestAnnotation`, `FilterDetails`) live in `@piwitests/core/wire` and are re-exported here — one source of truth shared with the reporter. The per-case payloads (`TestCasePayload`/`StreamEventPayload`) stay app-side and the reporter's `WireTestCase` stays reporter-side; the two are kept compatible by `tests/unit/wire-shared-drift.test.ts`.

### Shared core (`@piwitests/core`, `packages/core/`)
- Private, **zero-dependency**, browser/worker/server-safe workspace package holding pure cross-cutting logic: locator generation/scoring (`locator-generation`), ARIA parsing + element-match healing (`locator-fingerprint`), locator-healing types, the wire leaf shapes (`wire`), and the locator-builder method list (`locator-methods`).
- **Consumed two ways:** the app imports it via thin `application/shared/*` re-export shims so `#shared/...` paths never change; the reporter `import`s it and **tsup bundles it into `dist/`** at build time, so the published package stays self-contained (no `@piwitests/core` runtime dep, no monorepo path in the public `dist/index.d.ts`).
- Ships **TypeScript source** (no build step) — Vite/Vitest transpile it (`build.transpile`/`deps.inline`), the reporter's tsup inlines it.
- **Do not** put app-only (Nuxt/Drizzle/server) or reporter-only (Node-dependent) code here; keep it pure. `packages/core/tests/boundary.test.ts` enforces zero deps + no `node:`/cross-package imports, and `tests/unit/reporter-core-identity.test.ts` asserts the reporter re-exports the core functions rather than re-implementing them (replacing the old hand-mirror drift tests).

### Database
- **ORM**: Drizzle ORM (SQLite via libSQL, or PostgreSQL via postgres.js)
- **Schema**: `application/server/database/schema.ts`
- **Migrations**: `application/server/database/migrations/` (SQLite) or `migrations-pg/` (PostgreSQL, auto-run on startup based on `PIWI_DATABASE_URL`)
- **Tables**: `projects`, `test_runs`, `test_cases`, `test_runs_cases`, `failure_clusters`, `failure_diagnoses`, `app_settings`, `files`, `trace_resources`, `trace_blobs`, `tags`, `project_tags`, `users`, `api_keys`, `account_tokens`, `notification_channels`, `subscriptions`, `notification_deliveries`, `locator_snapshots`
- `locator_snapshots`: one row per locator call site (`test_case_id` + `location`), upserted each run with the latest element attributes + pre-computed ranked alternative locators; powers locator healing. `last_seen_run_id` FK `ON DELETE set null`. Unique index on `(test_case_id, location)`
- `users` has `email` (unique, nullable) and `emailVerified` (boolean) columns added
- `account_tokens`: single-use SHA-256-hashed tokens for reset/invite/verify; purpose enum; TTL enforced at query time
- `notification_channels`: email/slack/webhook/browser destinations; webhook secrets AES-256-GCM encrypted via `crypto.ts`
- `subscriptions`: links a user to a channel + optional project; `events` JSON array; `filters` JSON; `mode` realtime/digest; `mutedUntil` timestamp; `active` boolean
- `notification_deliveries`: outbox table; `dedupeKey` unique constraint for idempotency; `status` pending/sent/failed/skipped; `attempts` + `scheduledFor` for progressive retry (1/5/15/60/240 min backoff)
- **Audit**: See `plans/` for schema audit plans with findings and recommended changes

### Backend (server/api/)
Nuxt file-based routing:
- `GET /api/health` — Public health/readiness probe; verifies DB connectivity (200 ok / 503)
- `GET /_openapi.json` — Auto-generated OpenAPI 3.1 spec (enabled via `nitro.experimental.openAPI`)
- `GET /docs` — Interactive API reference UI (Scalar) generated from the OpenAPI spec
- `POST /api/test-runs/submit` — Submit JSON test results
- `POST /api/test-runs/upload` — Upload with HTML reports + traces
- `POST /api/test-runs/start` / `[id]/events` / `[id]/finish` — Streaming protocol (live runs)
- `POST /api/test-runs/[id]/case-files` — Upload one case's trace + attachments during a streaming run (streamToken auth, idempotent, publishes `case-files` SSE event)
- `GET /api/projects` — List projects with stats (heavy: runs, test case counts, reports, tags)
- `GET /api/projects/menu` — Slim project list for sidebar navigation (`id`, `name`, `label` only; one SELECT, no joins)
- `GET /api/projects/[id]` — Project details + runs
- `GET /api/test-runs/[id]` — Run details + cases
- `GET /api/test-cases/[id]` — Case details + steps, web vitals, network requests
- `GET /api/test-cases/[id]/traces` — Trace files for a test case
- `GET /api/test-cases/[id]/history` — Execution history across runs
- `GET /api/test-runs/[id]/cases/[caseId]/locator-healing` — Ranked alternative locators for a failing locator (locator healing); authorized by the **case's** own project (the `caseId` may belong to a run other than `[id]`, e.g. from the cluster page). Returns `source: 'none'` rather than 404 when no alternatives exist
- `GET /api/files/[...path]` — Download reports/traces
- `GET /api/projects/[id]/flaky-tests` — Cross-run flakiness analysis (retry-pass + alternation detection)
- `GET /api/failure-clusters/[id]/diagnosis` — Stored AI diagnosis + saved `manualBaseCommit` for a cluster
- `POST /api/failure-clusters/[id]/diagnose` — Run AI diagnosis synchronously; 503 if unconfigured; accepts `baseCommit`, `selectedCommitShas`, `additionalContext`, `images` in body
- `PATCH /api/failure-clusters/[id]/base-commit` — Persist a manual baseline commit SHA for a cluster
- `GET /api/failure-clusters/[id]/commits` — Recent commits for the cluster's repo with `limit` and `hasMore`; includes aggregate diff when `baseline` query param is provided
- `GET /api/failure-clusters/[id]/commit-diff` — Diff (files + patches) for a single commit SHA (`?sha=`)
- `GET /api/failure-clusters/[id]/context` — Preview the full AI context that would be sent; accepts `baseCommit` and `selectedCommitShas` query params
- `GET /api/ai/status` — Public AI configuration status (never returns the key)
- `GET /api/settings/ai` — Admin: full AI settings including `hasApiKey`, `envManaged`
- `PUT /api/settings/ai` — Admin: save provider/model/key/baseUrl/autoDiagnose
- `POST /api/settings/ai/test` — Admin: smoke-test the configured AI provider
- `GET /api/settings/smtp` — Admin: SMTP display config (host/port/user/from; never returns password); `envManaged: true`
- `POST /api/settings/smtp/test` — Admin: send test email to `{ to }` via env-configured SMTP
- `POST /api/auth/forgot-password` — Public, rate-limited (5/15 min/IP); sends reset email; always returns `{ success: true }` (no enumeration)
- `POST /api/auth/reset-password` — Public; accepts `{ token, password }`; accepts both `reset` and `invite` token purposes; single-use
- `POST /api/auth/change-password` — Authenticated; `{ currentPassword, newPassword }`
- `GET /api/auth/verify-email?token=` — Public; marks email verified; redirects to `/settings/account?verified=1`
- `POST /api/auth/send-verify-email` — Authenticated; mints a `verify` token and emails it
- `POST /api/users/[id]/invite` — Admin; sends invite email with a reset-password link (mode=invite)
- `PATCH /api/users/[id]` — Admin; update name, email, or role
- `GET /api/channels` — Authenticated; lists user's channels + global channels (admins see all)
- `POST /api/channels` — Authenticated; creates channel; admins can set `global: true`; webhook secrets encrypted at rest
- `DELETE /api/channels/[id]` — Authenticated; owner or admin
- `POST /api/channels/[id]/test` — Authenticated; sends a test delivery through the channel
- `GET /api/subscriptions?projectId=` — Authenticated; lists subscriptions with joined channel info; optional projectId filter
- `POST /api/subscriptions` — Authenticated; `{ channelId, projectId?, events[], filters?, mode, digestAt? }`
- `PATCH /api/subscriptions/[id]` — Authenticated; update events/filters/mode/digestAt/mutedUntil/active
- `DELETE /api/subscriptions/[id]` — Authenticated; owner or admin
- `GET /api/notifications/stream` — Authenticated; SSE stream for browser-channel notification deliveries (connection stays open even on hidden tabs)

### Frontend (app/)
- **Pages** (`app/pages/`):
  - `/` — Dashboard home with stats
  - `/projects` — Project list
  - `/projects/[id]` — Project detail
  - `/test-runs/[id]` — Run detail
  - `/test-cases/[id]` — Case detail (detailed revamp: traces, run context, AI fix prompt, timing comparison, improved error display)
- **Components** (`app/components/`): organized into domain subfolders; all auto-imported without folder prefix (Nuxt `pathPrefix: false`).
  - **`shared/`** — UI primitives used across multiple pages: `RunStatusBadge`, `TestStatusBar`, `RunReports`, `TagBadge`, `TagsSelect`, `BrowserBadge`, `CiEnvCard`, `SourceInfoCard`, `CodeBlock`, `MarkdownPreview`, `ScreenshotLightbox`, `LocatorHealingPanel` (fetches `/api/test-runs/:id/cases/:caseId/locator-healing`; renders ranked alternatives + recommended fix; used on the test-case and cluster pages)
  - **`run/`** — Test run detail page (`/test-runs/[id]`): `RunSummary` (summary card + CI/Source/Other metadata), `TestCasesList` (paginated table, sticky headers, row highlighting via `meta.class.tr`), `WorkersTimeline` (clickable bars, emits `selectTestCase`), `RunCompare` (self-contained, watches internal `compareRunA`), `SlowEndpoints` (fetches `/api/test-runs/:id/network-requests` internally), `FailureGroups`, `RunReports`
  - **`test-case/`** — Test case detail page (`/test-cases/[id]`): `TestCaseStatusCard` (title, location, duration, retries, worker, slowest step, timing vs avg), `TestCaseSummary`, `TestCaseRunContext` (environment, CI, branch, commit, browser), `TestCaseTracesCard`, `TestCaseErrorCard` (copy button, collapsible errors, cluster info row), `TestCaseConsoleCard`, `TestCaseAttachmentsCard`, `TestCaseHistoryChart`, `TestEvidenceSection`, `TestEvidenceScreenshots`, `TestEvidenceSignals`, `TestEvidenceTraces`
  - **`cluster/`** — Failure cluster detail (`/failure-clusters/[id]`): `ClusterSummary` (top summary: signature/metadata info card + inline Triage card, wrapped in `FoldableSummary`), `ClusterTestEvidence` (one tab per affected case, each with an "Open test run case" link, an evidence chip strip and reordered screenshots/traces/failing-steps/signals/source/ARIA blocks; caches each case's detail), `ClusterInvestigation` (baseline picker + SCM diff; its status line is derived from the shared `useScmStatusSummary` composable), `CommitPicker` (baseline selector with aggregate diff stats, caches per baseline), `CommitBrowserModal` (full-screen split modal: paginated commit list + per-commit diff), `ClusterExtractCasesModal`, `RegressionContext`. The page wraps the left-column sections (error, alternative locators, test evidence, what changed) in `CollapsibleSectionCard` (folded by default with a peek) and `provide`s a `clusterSectionLocator` (`useClusterSectionLocator`) so a diagnosis citation can unfold + scroll to the matching section.
  - **`diagnosis/`** — AI diagnosis panel (right column of the cluster page): `DiagnosisPanel` (header, context preview, additional context, diagnose/stream/result), `DiagnosisCoverageStrip` (compact chip row of which evidence sections will be sent + token estimate; click a chip to focus it in the context modal), `DiagnosisContextModal`, `DiagnosisResult` (result display; evidence citations open the context modal and, when the section maps to the page, offer a "show on page" affordance), `DiagnosisScreenshots`, `DiagnosisExportMenu`
  - **`project/`** — Project detail page (`/projects/[id]`): `PassRateChart`, `PerformanceTrendChart`, `TestRunsChart`, `FlakyTestsList` (score badges, retry-pass / alternation breakdown), `FailureClustersList`, `ScmChangesView`, `SubscribeBell` (notification subscribe popover; hidden when auth disabled)
  - **`layout/`** — App shell / navigation: `ProjectsMenu`, `UserMenu`, `GetStartedWizard`
  - **`demo/`** — Demo mode only: `DemoBanner`, `DemoInitScreen`, `DemoSimulator`
  - **Shared building blocks in `shared/`** (prefer these over re-implementing):
    - `SectionCard` — `UCard` with a standard header: optional `icon` (+ `iconClass`), `title`, optional `(count)` and `subtitle` (prop or `subtitle` slot). `actions` slot for header-right controls, `footer` slot forwarded to `UCard`. Use for any card that needs an icon/title (and optional description) header.
    - `CollapsibleSectionCard` — a `SectionCard` that folds to a single header row. Same header contract as `SectionCard` (`icon`/`iconClass`/`title`/`count`/`help`/`subtitle`/`actions`) plus a required `storageKey` (fold state persisted per user in a cookie, defaulting to folded) and a `#folded` slot for the one-line peek shown when collapsed. `actions` stay clickable while folded; exposes `setFolded(value)` so a parent can open it programmatically. Fold state is backed by the `useFoldedState(cookieKey, defaultFolded)` composable (also used by `useFoldableSummary`). Use for any left-column detail section that should default to a compact, scannable header.
    - `EmptyState` / `LoadingState` / `ErrorState` — centered empty/loading/error blocks (`ErrorState` has an `action` slot for a retry button). Default `py-8` padding, disable with `:padded="false"`.
    - `ChartLegend` — `{ color, label }[]` legend dots (use `dense` for inline charts).
    - `DiffPatch` (colored unified-diff lines) and `DiffFile` (file card: sticky header + `DiffPatch`). Use for any SCM patch rendering.
    - `HelpHint` — discreet inline-help affordance (muted `i-lucide-circle-help` icon → click popover with a short explanation + optional "Learn more" docs link). Pass a `topic` key from `app/utils/help-content.ts` (preferred) or inline `title`/`text`/`doc`. Use `i-lucide-circle-help` for help; reserve `i-lucide-info` for informational/empty-state callouts. NOTE: a topic's `title` becomes the trigger's accessible name `Help: <title>`, so avoid titles that are substrings of nearby action-button labels on the same view (e.g. don't title it "Subscribe" next to a "Subscribe" button) — Playwright's substring `getByRole('button', { name })` will match both. A topic may carry `envVars: PiwiEnvVarName[]` — the popover then lists each `PIWI_*` env var (with its description from the registry) as a click-to-copy `<code>` line plus a "Configuration reference" docs link, so a system admin knows which env var backs the setting.
    - `EnvManagedBadge` — lock icon with a tooltip naming the `PIWI_*` env var(s) that pin a field. Use on any field that is read-only because env wins (`:env-vars` typed `PiwiEnvVarName[]`).
    - `EnvManagedAlert` — standard top-of-card banner for env-pinned settings; replaces ad-hoc `UAlert`s. Lists the env var(s) and links to the configuration reference.
    - `SettingsField` — `UFormField` wrapper for the Settings pages: renders the label row with a `HelpHint` (incl. env var) and an `EnvManagedBadge` when `:env-managed`. Use for every editable settings field so the surface stays homogeneous.
    - `DocLink` — standardized "Learn more →" external docs link. Pass a docs path (page + optional `#anchor`); it runs through `docsUrl()` (`shared/docs.ts`) and opens in a new tab with `rel` hardening + external-link icon. Route all outbound docs links through this.
    - `ChartCard` — thin wrapper over `SectionCard` for `@unovis/vue` trend charts: standard header (`icon`/`title`/`subtitle`/`help`/`actions`) + optional `legend` slot. Use instead of ad-hoc `UCard + #header` so charts get headers and inline help.
    - `NavbarActions` — action row for `UDashboardNavbar` `#right` slots. Pass `:actions` (`{ label, icon, color?, variant?, to?, loading?, disabled?, onClick? }[]`); each renders as a `UButton` whose text label is hidden below `sm` (icon-only, label kept as `aria-label`/`title`) so page actions never crowd the breadcrumb on phones. Extra controls go in the `leading` (before) / default (after) slots. Use for **every** navbar action group instead of bare `UButton`s.
    - `BreadcrumbNav` — drop-in replacement for `<UBreadcrumb :items>`. From `sm` up it renders the full `UBreadcrumb` (custom per-item slots like `#project` are forwarded); below `sm` it collapses the ancestor levels into a dropdown and shows only the current page label. Use on any page whose breadcrumb has 3+ levels.
    - `TableScroller` — horizontal-scroll wrapper for wide content (tables, diffs, charts). Props: `minWidth` (e.g. `'60rem'`), `bleed` (default `true`, bleeds to the card edge below `sm`). Wrap any `UTable`/`<table>` that can't fit a phone width so it scrolls in place instead of stretching the page. Prefer a dedicated mobile card layout (see the responsive convention) for dense tables; use `TableScroller` when a card view isn't warranted.
    - `StatTile` + `StatTileGrid` — a stat tile (`label`/`value`/`hint`, `size` `sm`·`lg`, `valueClass`, `#label` slot for a `HelpHint`) inside an auto-fitting grid (`minTileWidth`, default `8.5rem`) that reflows from 2 columns on phones up with no per-page breakpoints. Use instead of ad-hoc `bg-gray-50 dark:bg-gray-900` tile markup.
    - `FilterToolbar` — wrap-friendly list-filter toolbar: a `start` group (counts, view toggles) and the default group (search, pills, selects) sit side by side on wide screens and stack + wrap on phones. Use for list/table filter rows so they never force horizontal page scroll.
  - **Responsive / mobile convention (MUST follow):** the app must be usable at ~375 px with **no horizontal page scroll**. Write mobile-first (stacked/narrow as the default; add `sm:`/`md:`/`lg:` for wider screens) and never hide *data* with `max-sm:hidden` — hide only decorations. Reuse the primitives above rather than re-inventing: `NavbarActions` for navbar actions, `BreadcrumbNav` for deep breadcrumbs, `StatTile`/`StatTileGrid` for stat blocks, `FilterToolbar` for filter rows, and for wide tables either a `md:hidden` card list + `hidden md:block` table (preferred for dense tables, see `ProjectTrendTable`) or a `TableScroller` wrapper. Many tabs collapse to a full-width `USelect` below `sm` while the tab strip (`:ui="{ list: 'overflow-x-auto', trigger: 'shrink-0' }"`) shows from `sm` up — see `DetailPageLayout` (tabs-as-switcher) and `projects/[id]/index.vue` (`UTabs`-with-content: mobile `USelect` + `:ui="{ list: 'max-sm:hidden' }"`, both bound to the same `activeTab`). On fixed-height detail layouts, mobile must scroll as one document (never `overflow-hidden` clipping a tall summary) — `DetailPageLayout` handles this (page scroll + sticky tabs + collapsible summary). Verify new/changed screens at 375 px before committing.
  - **Inline-help convention (MUST follow):** any new **block-level** shared component that renders a header MUST accept an optional `help?: HelpTopicKey` prop (typed from `app/utils/help-content.ts`) and render `<HelpHint v-if="help" :topic="help" />` in its header. Add help copy by adding one entry to the `HELP_TOPICS` registry — never hardcode hint strings at call sites. Document only non-self-explanatory blocks; skip self-explanatory ones (counters, search boxes, basic CRUD forms, theme switcher, plain metadata). When adding a hint, **remove any always-on prose it now carries** (subtitle/intro paragraph) so the page gets quieter, not busier. If the documented setting is overridable by a `PIWI_*` env var, set `envVars: [...]` on the topic (typed `PiwiEnvVarName[]` from `shared/piwi-env-vars.ts`) — the popover then surfaces the env var(s) for system admins.
  - **Settings surface convention (MUST follow):** the Settings pages are harmonized on `SectionCard` + `SettingsField` and driven by `app/utils/settings-metadata.ts` (`SETTINGS_PAGES` registry: page id, label, icon, route, required `roles`, and `fields` each carrying a `HelpTopicKey`). The nav (`useSettingsNav`) and env-state (`useSettingsEnvState`) are derived from this registry — admin-only pages are hidden for non-admins, and env-managed pages show a trailing lock badge. When adding a new Settings page or field: (1) add the env var to `shared/piwi-env-vars.ts`, (2) add/extend a `HELP_TOPICS` entry with its `envVars`, (3) add a `fields` entry to the page in `SETTINGS_PAGES`, (4) render the field with `SettingsField` (or `EnvManagedBadge`/`EnvManagedAlert` if read-only). Never hand-roll an env-managed `UAlert` or lock icon — use the shared primitives.
- **Composables** (`app/composables/`):
  - `useAiStatus.ts` — Fetches `GET /api/ai/status` once; shared across components to show/hide AI actions
  - `useCopy.ts` — `{ copy, copied }` clipboard helper (wraps VueUse `useClipboard`); `copy(text, { toast })`. Use instead of hand-rolling `navigator.clipboard` + a `copied` flag.
  - `useChartMarkers.ts` — Shared interactive SVG-marker + floating-tooltip logic for the `@unovis/vue` trend charts. Returns `{ tooltipData, tooltipPos, onRenderComplete }`; bind `:on-render-complete` on the `VisXYContainer`.
- **Pages** (`app/pages/`):
  - `/settings/account` — Email address + verification, change password, OAuth provider info (auth-gated)
  - `/settings/notifications` — SMTP status card (read-only from env), notification channels CRUD, subscription list with mute/delete
  - `/settings/ai` — AI diagnosis configuration (provider, model, API key, base URL, auto-diagnose toggle)
  - `/forgot-password` — Public, layout-free; no user enumeration in UI
  - `/reset-password` — Public, layout-free; handles both reset and invite (`?mode=invite`) flows
- **Utilities** (`app/utils/`):
  - `performance-hints.ts` — Generates performance warnings for slow/flaky tests
  - `index.ts` — Shared helpers: `formatDuration`, `getStatusColor`, `getFileApiPath`, `formatRelativeTime`, `createSortHeader`, `formatBytes`, `errorMessage` (unwrap `$fetch` errors), `filterCommits`, `scmFileStatusMeta`, `parsePatchLines`/`patchLineClass`, `clusterStatusColor`, `clusterErrorTypeColor`

### Reporter
> **Layout & conventions:** see **`reporter/ARCHITECTURE.md`** for the full map (public/internal split, two-process collect-and-submit data flow, fallback ladder, conventions). The package is `strict`-mode TypeScript; Node built-ins are `import * as x from 'node:x'`; classes use `private readonly` constructor parameter-property DI; HTTP failures throw `HttpError` (carrying `status`); `catch (error)` is `unknown` (narrow with `instanceof`, format with `errorMessage`).

- **Public API** — only what these expose is the supported surface:
  - `reporter/src/index.ts` — the package's single public entry (`.`): re-exports the reporter, `wrapConfig`, `createGlobalSetup`, `piwiFixtures`, `extendPiwiFixtures`, and the public types incl. `PiwiFixtures` (there is no `./fixtures` subpath — fixtures import from `@piwitests/reporter`)
  - `reporter/src/public/reporter.ts` — `PiwiDashboardReporter` (Playwright hooks + running counters; hands off to `RunSubmitter`)
  - `reporter/src/public/options.ts` — `PiwiDashboardOptions` interface + `PlaywrightTestConfig` re-export
  - `reporter/src/public/config-wrapper.ts` — `wrapConfig`; `reporter/src/public/global-setup.ts` — `createGlobalSetup`
- **`reporter/src/internal/`** — private plumbing, grouped by domain:
  - `submit/` — `run-submitter.ts` (the submit/fallback ladder: streaming → multipart → JSON → recovery), `uploader.ts` (JSON/multipart/streaming-file uploads), `serializer.ts` (`toWireTestCase`/`serializeRun`/`resolveOverallStatus` — single source of truth for the wire field list)
  - `transport/http-client.ts` — `HttpClient` (one `request()` core; login/postJSON/postFormData; throws `HttpError`)
  - `streaming/` — `stream-manager.ts`, `stream-buffer.ts`, `crash-recovery.ts`
  - `collect/` — `metadata-collector.ts` (CI/SCM/browser + suite metadata; owns all Playwright-internal suite access via `getSuiteInfo`/`getBrowserConfig`), `step-analyzer.ts`, `skip-classify.ts`, `error-text.ts`
  - `files/` — `file-handler.ts`, `compression.ts`
  - `capture/` — `capture-fixtures.ts` (Playwright fixtures for network/web-vitals/console/locator capture; runs in the worker), `locator-healing.ts` (re-exports the pure generation/scoring/types from `@piwitests/core`, and keeps the reporter-only runtime: `captureCallerLocation`, snapshot dedupe, the fixture-proxy method surface, and `suggestLocatorsFromAria`'s same-style rendering), `attachments.ts` (the `piwi-*` attachment names)
  - `config/env.ts` — `PIWI_ENV_KEYS`, `resolveOptions`, `applyOptionsToEnv` (the `PIWI_*` ↔ option map)
  - `support/` — `logger.ts` (`Logger`), `errors.ts` (`errorMessage`), `instance-id.ts`, `setup-file.ts`, `source-snippet.ts`, `cli-filters.ts`, `worker-index.ts`, `ci.ts`, `limiter.ts`
- **`reporter/src/types/`** — `wire.ts` (EXTERNAL server contract; leaf shapes re-exported from `@piwitests/core/wire`, the per-case `WireTestCase`/stream union kept here and pinned to the server payloads by `wire-shared-drift.test.ts`) and `collected.ts` (INTERNAL in-process model); `reporter/src/types.ts` is a barrel over both
- `reporter/package.json` — NPM package
- Source is TypeScript (`.ts` in `src/`); compile with `npm run reporter:build` to produce `.js` + `.d.ts` in `dist/`

## Key Features
- Auto-create projects on submission
- Stores: status, duration, errors, HTML reports (full directory with assets), trace files
- File storage: `.data/storage/` — paths stored relative to storage dir
- REST + multipart upload APIs
- Auto-generated OpenAPI 3.1 spec at `/_openapi.json` with interactive Scalar UI at `/docs`

## Code Style
- Keep it simple (AI-friendly codebase)
- Full TypeScript, Nuxt 4 conventions, Nuxt UI components
- Sentence case in UI (e.g., "Test runs"), relative dates with date-fns, human-readable durations
- Use American English spelling throughout (e.g., "initialize", "organize", "color")
- **Extract shared Vue components** when the same block of template exceeds ~10 lines and appears more than once — avoid duplicating markup with identical logic across components
- **Never duplicate logic between server and demo code.** Both `server/` and `app/demo/api/` mirror each other (same DB schema, same persist logic). Any new utility function that would otherwise need to live in both places must be extracted into a shared module — either in `server/utils/` (demo imports via `~~/server/utils/...`) or `shared/` — and imported by both. Exceptions only when the implementation fundamentally differs (e.g., error handling, auth).
- **Capture global change requests**: when I ask you to apply a change across multiple files (e.g., "update all X to Y"), add a new instruction rule to `AGENTS.md` documenting that pattern so future edits follow the same convention
- **Conventional Commits (MUST follow — CI lints every commit)**: every commit message and PR title MUST pass commitlint. `commitlint.config.js` (repo root) is the source of truth; `CONTRIBUTING.md` has the full guide and the type→release-bump table — release-please reads PR titles (squash-merge subjects) to compute version bumps and the changelog. The `commitlint` CI check lints **every commit in the PR's range**, so one bad message turns the PR red; if one slips through, amend/reword and force-push. Format `type(scope): subject` with:
  - `type` — one of `feat` `fix` `perf` `docs` `chore` `ci` `refactor` `test` `build` `style` `revert`
  - `scope` — **closed list, anything else fails**: `app` `reporter` `db` `ui` `demo` `ci` `docs` `deps` `auth` `ai` `notifications` `release` (`main` is reserved for release-please's own release PRs). Scope is optional (warn-only) but include the best-fitting one; never invent a new scope (e.g. a timeline component change is `fix(ui)`, not `fix(timeline)`)
  - `subject` — starts lower-case (sentence-case/Start Case/PascalCase/UPPER-CASE all fail), imperative mood, no trailing period; full header ≤ 100 chars
  - Self-check before pushing: `npx commitlint --from HEAD~<n> --to HEAD` from the repo root (or rely on the husky `commit-msg` hook — never bypass it with `--no-verify`)
- **Never embed plan/spec references in code**: comments must never reference plan IDs (A1, A2, B3, etc.), plan file names, or plan document titles. Code comments should describe what the code does, not where the requirement came from. When implementing a plan, strip all plan-track metadata before writing any code.
- **Never write "before/after" comparative comments**: comments must never describe what the code used to look like or how it changed (e.g., "was X, now Y", "replaced A with B", "better than the old approach"). Comments describe the current state only — the why and what, not the history. Git handles history.
- **Share types between server and shared on new computed sections**: when adding a computed evidence section (not a DB field) to the diagnosis context, the SectionId union in `ai-context.types.ts`, the `DIAGNOSIS_SECTIONS` array in `diagnosis-sections.ts`, and any new fields in `DiagnosisContextCoverage` in `types/api.ts` must all be updated in a single batch before implementing the section builder.
- **Cross-platform shell commands**: any shell command shown to the user (docs, README/`*.md`, in-app `CodeBlock` snippets) must be cross-platform, or provide both a Linux/macOS and a Windows (PowerShell) version. Concretely: prefer portable single commands when one exists — use `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` instead of `openssl rand -hex 32` for secrets, `npm`/`npx`/`docker`/`git` which behave the same everywhere, and avoid bash `\` line continuation (write the command on one line). When no single portable form exists, show two versions: in VitePress docs (`docs/*.md`) use `::: code-group` with ```bash [Linux / macOS] + ```powershell [Windows (PowerShell)] tabs; in GitHub-rendered `*.md` use two consecutive labeled fenced blocks (a `# Linux / macOS` bash block and a `# Windows (PowerShell)` powershell block). Mappings: `$(pwd)` → `${PWD}`; inline `VAR=val cmd` → `$env:VAR='val'; cmd` (or set it in `application/.env`); `rm -rf X` → `Remove-Item -Recurse -Force X`; `\` continuation → backtick `` ` `` in PowerShell. Linux-only Docker host operations (`chmod`/`chown` on bind mounts) need no PowerShell form — just note they apply to Linux hosts (Docker Desktop handles permissions on Windows/macOS). `curl` examples: convert first-touch ones (submit, auth setup/login) to a PowerShell `Invoke-RestMethod` tab (build the body as a hashtable piped through `ConvertTo-Json`); other `curl` examples may stay bash-only as long as the in-app [API docs](/docs) include a "Windows users: use Git Bash/WSL or Invoke-RestMethod" tip at the top. `.env` file contents (`PIWI_*=...`) are not shell commands — leave them as-is.
- **Flaky root cause classification**: Add new categories to `classifyFlakyRootCause()` in `server/utils/flaky-classify.ts`. Keyword arrays at the top of the file. New column `flaky_root_cause` on `test_cases` table. Include `rootCause` field in `FlakyTest` response type (`types/api.ts`). `FlakyTestsList.vue` renders it via `TagBadge` with root-cause color mapping.
- **Impact scoring**: Compute `wastedCiMinutes` and `impact` in `getProjectFlakyTests` (`shared/handlers/projects.ts`). Sort flaky tests by impact descending. Include `impact`, `wastedCiMinutes`, `avgFailedDurationMs` in `FlakyTest`. Color scale: green < 5min, amber < 30min, red >= 30min in UI.
- **Regression signals**: `isNewRegression` and `isNewFlaky` columns on `test_runs_cases` (integer, 0/1). Computed after run finish via `computeRegressionSignals()` (`server/utils/compute-regression-signals.ts`). Called from `finish.post.ts`. Included in `getTestRun` and `getTestRunCase` response mappers. `TestCasesList.vue` shows red "NEW" and purple "FLAKY" badges with checkbox filter toggles.
- **Failure clustering / fingerprints**: The grouping key is computed in `shared/error-fingerprint.ts` (`computeErrorFingerprint`) over error type + normalized message + masked locator — the **stack frame is intentionally NOT hashed** (kept as `topFrameFile` for display only) so the same root cause groups across spec files. Add new volatile-token masking inside `maskVolatile` (message) / `maskSelector` (locator). When you change normalization, bump `FINGERPRINT_VERSION` and keep the demo mirror in `scripts/generate-demo-seed.mjs#computeDemoFingerprint` in sync. A version bump is **non-destructive**: `reclusterFailureFingerprints()` (`shared/handlers/failure-cluster-recluster.ts`) re-fingerprints existing clusters from their stored `sampleError` on startup, updating in place or merging collisions via `mergeFailureClusters()` (`shared/handlers/failure-cluster-ops.ts`) so triage state survives. Re-run `npm run app:seed:demo` after any change.
- **Demo AI diagnosis is data-grounded, not canned prose**: the demo has no AI provider, but the diagnosis experience is fully wired. `app/demo/api/diagnosis-context.ts` rebuilds a real evidence context (sections + coverage + token estimate) from the seed DB; `app/demo/api/scm.ts` serves a canned repo history (commits, diffs, branches, source files) from `app/demo/demo-scm.ts`; `app/demo/api/ai.ts` generates a per-cluster streaming/non-streaming diagnosis from that cluster's *real* stats (`collectClusterEvidence`) whose suggested-fix patch is genuinely `validatePatch`-checked against the seeded source files; `app/demo/api/diagnoses.ts` serves version history + persists feedback. These are **demo-only** (kept out of `shared/handlers/` so the canned SCM never enters the server bundle) — the server has its own real endpoints. The version-snapshot row shape is the one place shared, via `shared/handlers/diagnosis-versions.ts` (`buildDiagnosisVersionValues`, used by both `server/utils/ai-diagnosis.ts#snapshotDiagnosis` and the demo force-refresh). Seeded diagnoses + prior versions live in `scripts/generate-demo-seed.mjs` (`FAILURE_DIAGNOSES` / `FAILURE_DIAGNOSIS_VERSIONS`), one per project keyed to the cluster's actual error; their patch hunks **must stay in sync with the source files in `app/demo/demo-scm.ts`** so `patchValidation` stays `applies`. Clusters without a seeded diagnosis are intentional — a visitor triggers a live simulated stream. Re-run `npm run app:seed:demo` after any change.
- **Spec health**: Endpoint `GET /api/projects/[id]/spec-health` groups by spec prefix. `SpecHealthTable.vue` renders a sortable `UTable` (pass rate, flaky rate, failures, tests, avg time per spec prefix; pass-rate dot + linked prefix). Add `spec-health` to `validTabs` and `tabItems` in project `index.vue` page.
- **API docs live in the in-app Scalar UI, not in VitePress docs**: The auto-generated OpenAPI spec (`/_openapi.json`) and interactive reference (`/docs`) in the running app or demo are the single source of truth for API documentation. There is no `docs/api.md` file in the VitePress docs site. Instead, the VitePress nav/sidebar links to the demo's `/docs` page (`https://piwitests.github.io/demo/docs`). When documenting features in VitePress `.md` files, reference `[API docs](/docs)` (for self-hosted) or the live demo link rather than inline endpoint descriptions, and never create a static API reference page.
- **Locator healing**: Capture happens in the reporter fixtures (`reporter/src/internal/capture/capture-fixtures.ts`, mirrored by the dogfood `application/tests/fixtures.ts`): a `Proxy` wraps the page-level locator methods in `LOCATOR_METHODS` and, after each successful action, records the element's attributes plus ranked alternatives (`generateAlternatives` in `reporter/src/internal/capture/locator-healing.ts`) stamped with `captureCallerLocation()`. The in-page probe also reports `hasLabel` (gates `getByLabel` — an accessible name approximated from placeholder/title must not produce one) and `selectorCounts` (querySelectorAll uniqueness counts; ambiguous testid/id/name/class alternatives are dropped). The live input `value` is deliberately never captured (secret leak). Snapshots are deduped by location (`dedupeSnapshotsByLocation`) before attaching. The snapshots ride the wire as the transient `locatorSnapshots` per-case field (`shared/types.ts`, never a column) → every ingest site (`submit`, `upload`, `[id]/events`, + the demo `app/demo/api/reporter.ts` mirror) passes it to `persistRunCases` → the **shared** `upsertLocatorSnapshots` (`server/utils/locator-healing.ts`, imported by both server and demo) upserts one row per `(test_case_id, location)` into `locator_snapshots`. **Two invariants live in that helper:** rows are deduped by `(caseId, location)` before the batch upsert (a repeated call site would otherwise make PostgreSQL reject the `ON CONFLICT DO UPDATE`), and the stale-location purge runs **only for cases whose run passed** (`purge` flag) so a run that failed before reaching later locators doesn't delete their valid prior-success rows. The probe additionally collects **structural context** (only when the element resolves a role): `rolePosition` (index/count among same-role elements document-wide, plus `levelCount` for headings) and up to 4 anchor-worthy `ancestors` (testid | id | explicit role | aria-label | container tag, with scoped/doc-wide uniqueness counts) — both are wire fields on `LocatorSnapshot.element` and MUST be folded into the `elementAttrs` JSON inside `upsertLocatorSnapshots` (that object is the storage whitelist; anything omitted there is silently dropped; no schema migration needed). The in-page probe (`probeElementAttrs`) is a single self-contained function serialized into the browser via `target.evaluate`; the dogfood fixture **imports and calls it** (with the shared `CAPTURED_ATTRS_ARG`) rather than re-inlining it. Because it can't reference module closures, it receives the ARIA role maps (`TAG_TO_ROLE`/`INPUT_TYPE_TO_ROLE`, the single source of truth used by `resolveAriaRole`) and the derived role-source selector as fields of that `evaluate` argument — do NOT re-declare those maps inside the probe. `generateAlternatives` uses them to emit rename-proof structural alternatives (testid-anchor chain 72 / id-anchor 64 / name-free unique role 58 / landmark-anchor 55; skipped when the element has its own unique testid). Chained alternatives carry the **leaf** method (`getByRole`) with flat args (`anchorTestId`/`anchorSelector`/`anchorRole`, **never a `name` key** — `fingerprintFromSnapshot` reads the element name from the first `getByRole` alternative's args). Heading `getByRole` args carry `{ level }` (from the h1-h6 tag or `aria-level`, which is in `CAPTURED_ATTRIBUTES`). Lookup (`getLocatorHealing`) runs a ladder: exact call-site location → `file:line` (path-suffix tolerant) → locator signature → cross-test (same signature captured by another test in the project, freshest wins) → element-match against the failing ARIA snapshot → ARIA fallback. The element-match (`elementMatchOutcome`, `shared/locator-fingerprint.ts`) narrows heading candidates by `[level=N]` (parsed into `AriaCandidate.level`) and, on a total rename (best Dice < 0.2), falls back to the stored `rolePosition` index — gated on the same-role count being unchanged. **Stale gating:** when the outcome is `no-match` and the stored fingerprint has a name (the old name is provably gone from the failing ARIA), `resolveStoredHit` sets `priorNameMayBeStale`, excludes the failing locator (`locatorIdentityEquals`) and old-name-derived alternatives (`alternativeUsesName`) from the recommendation pool (full list stays visible; empty pool → `recommendation: null`, never a stale pick), and populates `fromAriaSnapshot` as a failing-page supplement. `LocatorHealingPanel.vue` must NOT recompute a client-side recommendation when `priorNameMayBeStale` is set (it would resurrect the stale pick). A flaky failure on an unchanged page (`unchanged`) keeps the full pool — recommending the original locator is correct there. `recommendation.suggestAddTestId` is only meaningful for stability-scored sources (`prior-run`/`fingerprint`/`cross-test`) and is force-cleared otherwise. The locator signature must hash identically on both sides — capture via `locatorSignature(method, args)` and lookup via `locatorSignatureFromExpression(expr)` (`shared/locator-healing.ts`); the error's leaf selector is extracted by `extractLeafSelector` (`shared/error-fingerprint.ts`). Pure helpers live in **`@piwitests/core`** (`locator-generation`, `locator-fingerprint`, `locator-healing-types`) and are re-exported by the `shared/` shims (`locator-healing.ts`, `locator-fingerprint.ts`, `locator-generation.ts`, `locator-healing.types.ts`) for `#shared/...` imports; the reporter `import`s the same core modules and tsup bundles them in. There is no longer a hand-mirrored copy — `tests/unit/reporter-core-identity.test.ts` asserts the reporter re-exports the exact core functions (`generateAlternatives`, role maps, `CAPTURED_ATTRIBUTES`, `classifyCssStability`, `isAutoGenerated`, …), so a re-implementation fails the suite. `shared/locator-generation.ts` (the browser-side generator the dashboard's DOM-snapshot picker runs) is the same core module the picker calls. The picker enriches its in-iframe probe result with `accessibleName` (label text first, then `approximateAccessibleName`) and `selectorCounts` before calling `generateAlternatives` — without that enrichment no `getByRole(name)`/`getByLabel` alternatives are generated. Dashboard picks persist via the shared `saveLocatorPick` (`server/utils/locator-healing.ts`, used by both the `locator-pick` endpoint and the demo router mirror): the failing locator's identity (location + `usedArgsFp`) is re-derived server-side from the stored error with the same helpers the lookup ladder uses (never trust client-parsed args); an existing row keeps its captured element data and only gets the pick merged to the front of `alternatives`; a missing row is created from the pick (synthetic `pick:<fp>` location when the error carries no call site); a pick that can't be keyed returns `not-persisted` (surfaced as a toast) instead of being silently dropped. Any authenticated project member may save a pick — the endpoint deliberately carries no role list. Toggle with the `captureLocators` reporter option / `PIWI_CAPTURE_LOCATORS` env var (auto-off when `collectPerformanceMetrics` is false). Surfaced via `LocatorHealingPanel.vue` and the `locatorHealing` AI-diagnosis section. Re-run `npm run app:seed:demo` after changing the captured/stored shape.
- **Timed-out tests fold into `failedTests`**: There is no `timedOutTests` column on `test_runs`. Timed-out tests (per-case status `'timedOut'` from Playwright, camelCase; `'timedout'` lowercase in the declared `TestCaseStatus` union) are folded into `failedTests` so the run summary reconciles (`total = passed + failed + skipped + didNotRun`) and matches the UI (which already treats timed-out as failed in the status filter, color, and retry command). Every ingest site that writes `failedTests` MUST use `sumFailedAndTimedOut(body.failedTests, body.timedOutTests)` (for body-field sites: `finish.post.ts`, `submit.post.ts`, `upload.post.ts`, and the demo `app/demo/api/reporter.ts` mirror) or `countFailedFromTally(insertedStatusCounts)` (for per-status-tally sites: `events.post.ts` and the demo mirror). Helpers live in `shared/utils/test-counts.ts`. When adding a new ingest site, import and use these helpers — never write `failedTests: body.failedTests` directly. The reporter sends `timedOutTests` separately in the finish/submit body; `TestRunSubmitPayload`/`TestRunFinishPayload` declare it as optional.

## Environment
- `.env.example` in `application/` — `PIWI_SITE_URL` (optional)
- Works with no env vars set; `.data/` created automatically
- **Typed env-var registry**: `shared/piwi-env-vars.ts` is the single source of truth for every `PIWI_*` env var the app understands — each entry pairs the var name (object key → compile-time-checked literal) with a human description and category. `keyof typeof PIWI_ENV_VARS` (`PiwiEnvVarName`) is the typed union used everywhere a var is referenced, so a typo is a build error. The `HelpTopic.envVars` field is typed `PiwiEnvVarName[]`, and `app/utils/settings-metadata.ts` fields reference env vars by typed name. **When you add a new `PIWI_*` var to `nuxt.config.ts` or a server util, add it to `PIWI_ENV_VARS` in the same change** — a unit test (`tests/unit/piwi-env-vars.test.ts`) fails if a referenced `PIWI_*` name isn't registered. Helper exports: `getEnvVarMeta`, `envVarsByCategory`, `isRuntimeSetting`.
- `PIWI_SECRET_KEY` — master key for AES-256-GCM encryption of secrets stored in the DB (AI API keys, SCM tokens). Recommended in production even without auth enabled. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` (cross-platform) or `openssl rand -hex 32` (Linux/macOS). Falls back to an insecure default in development.
- AI diagnosis env vars (all optional — can also be set via Settings UI):
  - `PIWI_AI_PROVIDER` — `anthropic` or `openai`
  - `PIWI_AI_API_KEY` — API key (env takes precedence over DB; `envManaged: true` in status)
  - `PIWI_AI_MODEL` — model name (default: `claude-opus-4-8` for Anthropic)
  - `PIWI_AI_RESEARCH_MODEL` — optional cheaper/faster model for a pre-analysis pass before the main model writes the final diagnosis; empty → single-stage. The research stage analyzes a lean projection (high-signal sections only) for token efficiency; the final stage sees the full context. Two-stage breakdown is stored in `failure_diagnoses.details.pipeline` and shown as a "2-stage" badge in the UI.
  - `PIWI_AI_RESEARCH_PROVIDER` / `PIWI_AI_RESEARCH_BASE_URL` / `PIWI_AI_RESEARCH_API_KEY` — optional per-role overrides so the research stage can run on a different provider (e.g. a small local OpenAI-compatible model). Each falls back to the main `PIWI_AI_*` value when unset.
  - `PIWI_AI_BASE_URL` — base URL for OpenAI-compatible providers (e.g. `http://localhost:11434/v1`)
  - `PIWI_AI_AUTO_DIAGNOSE` — `true` to auto-diagnose new clusters on run finish
- AI diagnosis **context limits** — cap how much evidence (and tokens) go into each diagnosis. Defaults live in `shared/ai-context-limits.ts`; resolved as defaults ← stored settings (`ai_context_limits` in `app_settings`) ← env (`server/utils/ai-context-limits.ts#resolveContextLimits`). Editable in Settings → AI, or pinned via env (env wins, UI shows the field read-only). Env vars: `PIWI_AI_MAX_SAMPLE_ERROR_CHARS`, `PIWI_AI_MAX_SCM_PATCH_BUDGET`, `PIWI_AI_MAX_AFFECTED_TESTS`, `PIWI_AI_MAX_STEPS`, `PIWI_AI_MAX_CONSOLE_ENTRIES`, `PIWI_AI_MAX_CONSOLE_ENTRY_CHARS`, `PIWI_AI_MAX_NETWORK_REQUESTS`, `PIWI_AI_MAX_ARIA_SNAPSHOT_CHARS`, `PIWI_AI_MAX_TEST_SOURCE_CHARS`.
- SMTP email env vars (all required for email features; read-only in Settings UI — not stored in DB):
  - `PIWI_SMTP_HOST` — SMTP hostname
  - `PIWI_SMTP_PORT` — port (default: `587`)
  - `PIWI_SMTP_USER` — SMTP username
  - `PIWI_SMTP_PASS` — SMTP password (never returned by API)
  - `PIWI_SMTP_FROM` — from address (`noreply@example.com`)
  - `PIWI_SMTP_FROM_NAME` — display name (optional)
  - `PIWI_SMTP_SECURE` — `true` for port 465 TLS (default: `false`)
  - `PIWI_SITE_URL` — public base URL used in email links (e.g. `https://piwi.example.com`)

## Dev Commands (from `application/`)

| Command | Purpose |
|---------|---------|
| `npm install` | Install deps |
| `npm run app:dev` | Dev server |
| `npm run app:build` | Production build |
| `npm run app:typecheck` | TypeScript check |
| `npm run app:lint` | oxlint |
| `npm run app:lint:fix` | oxlint (auto-fix) |
| `npm run app:format` | oxfmt (format files) |
| `npm run app:format:check` | oxfmt (check formatting) |
| `npm test` | Run all tests (unit + Playwright) |
| `npm run app:test:unit` | Run unit tests (Vitest) |
| `npm run app:test` | Run Playwright E2E tests |
| `npm run db:generate` | Generate migration |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema (dev only) |
| `npm run db:studio` | Drizzle Studio |
| `npm run app:seed:demo` | Regenerate demo seed data |
| `npm run app:generate:demo` | Build demo SPA |
| `npm run app:check:demo` | Verify demo routes |
| `node scripts/db-query.mjs "<sql>"` | Query the local SQLite DB directly |

**DB query examples** (run from `application/`):
```bash
node scripts/db-query.mjs "SELECT key, value FROM app_settings"
node scripts/db-query.mjs "SELECT id, name FROM projects" --json
```

### Reporter commands (from `reporter/`)

| Command | Purpose |
|---------|---------|
| `npm run reporter:build` | Compile TypeScript (from `src/`) to `.js` + `.d.ts` (in `dist/`) |
| `npm run reporter:dev`   | Watch mode — auto-recompile on changes |
| `npm run reporter:format`| Format source code with oxfmt |
| `npm run reporter:test`  | Run unit tests with Vitest |
| `npm run reporter:test:watch` | Watch mode — re-run tests on changes |
| `npm run reporter:lint`     | Lint with oxlint               |
| `npm run reporter:lint:fix` | Lint with auto-fix             |

## Making Changes

...**Reporter**: Edit `.ts` files in `reporter/src/` → `npm run reporter:build` (from `reporter/`) → test with `npm link`

### Source files

| Area                          | Responsibility                              |
|-------------------------------|---------------------------------------------|
| `src/index.ts`                | Public entry (`.`) — reporter + helpers + fixtures + types |
| `src/public/`                 | Public API: `reporter`, `options`, `config-wrapper`, `global-setup` |
| `src/internal/submit/`        | `run-submitter` (fallback ladder), `uploader`, `serializer` |
| `src/internal/transport/`     | `http-client` (+ `HttpError`)               |
| `src/internal/streaming/`     | `stream-manager`, `stream-buffer`, `crash-recovery` |
| `src/internal/collect/`       | `metadata-collector`, `step-analyzer`, `skip-classify`, `error-text` |
| `src/internal/files/`         | `file-handler`, `compression`               |
| `src/internal/capture/`       | `capture-fixtures`, `locator-healing`, `attachments` (worker-side) |
| `src/internal/config/`        | `env` (`PIWI_*` ↔ options)                  |
| `src/internal/support/`       | `logger`, `errors`, `instance-id`, `setup-file`, `source-snippet`, `cli-filters`, `worker-index`, `ci`, `limiter` |
| `src/types/`                  | `wire` (server contract) + `collected` (internal model) |

See **`reporter/ARCHITECTURE.md`** for the full map and conventions.

## Key server utilities

| File | Purpose |
|------|---------|
| `server/utils/email.ts` | `getSmtpConfig()`, `isEmailConfigured()`, `sendEmail({to,subject,html,text})` (lazy transport, no-op if unconfigured), template renderers for reset/invite/verify/test/run-notification emails |
| `server/utils/account-tokens.ts` | `mintAccountToken(db, userId, purpose)` → plaintext (SHA-256 stored), `validateAccountToken`, `consumeAccountToken`; TTLs: reset=1h, verify=24h, invite=72h |
| `server/utils/rate-limit.ts` | `checkRateLimit(key, limit, windowMs)` — simple in-memory sliding-window rate limiter |
| `server/utils/notifications/match.ts` | `matchAndEnqueue(db, event, payload)` — queries active subscriptions, applies filters (branch/status/mute/threshold), inserts `notification_deliveries` rows with dedupeKey |
| `server/utils/notifications/dispatch.ts` | `sweepOutbox(db)` — dispatches pending deliveries to email/Slack/webhook; handles retry backoff; webhook uses HMAC-SHA256 `X-Piwi-Signature` |
| `server/utils/notifications/emit.ts` | `emitNotification(db, event, payload)` — gates on `isAuthEnabled`, calls matchAndEnqueue then kicks sweepOutbox fire-and-forget |
| `server/utils/notifications/run-notifications.ts` | `emitRunNotifications(db, runId)` — emits `run.finished` / `run.failed` / `run.failed.default_branch` / `cluster.new` after run finalization |
| `server/tasks/notifications/sweep.ts` | Nitro scheduled task (`notifications:sweep`) — calls `sweepOutbox(db)` every minute |
| `shared/notification-events.ts` | `NOTIFICATION_EVENTS` tuple, `NotificationEvent` type, payload interfaces, `renderEventSubject(event, payload)` |

## Authentication & Authorization

- **Roles are defined as a TypeScript string enum** (`Role` in `shared/types.ts`): `ADMINISTRATOR`, `REPORTER`, `USER`. Use `Role.ADMINISTRATOR` etc. everywhere — never raw string literals.
- **Auth is optional**: enabled by `PIWI_AUTH_ENABLED=true` env var. When disabled, `requireAuth()` returns a virtual admin user, so all endpoints work without auth.
- **Two auth methods** (when enabled): session cookie (browser) or API key (Bearer token or `X-API-Key` header, `pd_` prefix).

### Endpoint Auth Requirements (MUST follow)

All endpoints MUST call `requireAuth(event)` or `requireAuth(event, [roles])` at the top of the handler:

| Role array | Who can access | Used for |
|---|---|---|
| no arg (any authenticated) | Any logged-in user | Read endpoints: project list, run details, test cases, clusters, etc. |
| `[Role.ADMINISTRATOR, Role.REPORTER]` | Reporter + Admin | Submitting test results, uploading, streaming runs, trace checks, failure cluster triage |
| `[Role.ADMINISTRATOR]` | Admin only | User management, settings, project CRUD, tags, admin endpoints |
| `[Role.ADMINISTRATOR, Role.REPORTER, Role.USER]` | All roles | Self-service API key management |

- **Streaming protocol** endpoints (`begin`, `events`, `finish`, `case-files`) use **stream token** auth (not `requireAuth`) — the token is validated against the stored run's `streamToken`.
- **Public endpoints** (no auth required): `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/setup`, OAuth flow endpoints, `GET /api/ai/status`, `GET /api/health`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `GET /api/auth/verify-email`.

### Implementing Auth on a New Endpoint

```typescript
import { Role } from '#shared/types';
import { requireAuth } from '../../utils/auth';

export default eventHandler(async (event) => {
  await requireAuth(event, [Role.ADMINISTRATOR]); // or plain requireAuth(event)
  // ...
});
```

When the `User` type from DB has `role: string`, cast to `Role`: `user.role as Role`.

### OpenAPI Security Annotations

- Every endpoint has a `defineRouteMeta` block with `openAPI` metadata — this is non-negotiable.
- Auth/public distinction is documented via the `security` field:
  - **Public endpoints** (auth, ai/status): `security: []`
  - **All other endpoints**: inherit root-level `security: [{ bearerAuth: [] }, { sessionCookie: [] }]` defined in `nuxt.config.ts`.
- The root `nuxt.config.ts` defines `components.securitySchemes` with `bearerAuth` (API key) and `sessionCookie` (session) schemes. The `meta` is type-cast with `as any` to allow these extra OpenAPI fields — this is intentional.
- When adding a new endpoint, include `security: []` ONLY if it's truly public. All other endpoints inherit the default security automatically.

### Project-level Permissions

A **project assignment** layer sits atop the role system:

- **`ADMINISTRATOR`**: full access to all projects, never filtered, no assignment needed.
- **`REPORTER`** and **`USER`**: only see projects they're assigned to. Assignment can be **per-project** (list of project IDs) or **global** (all projects, `projectId = null`).
- **Default**: no assignments = no access. Existing users get backfilled with global access on upgrade.

Key implementation details:

- **Schema**: `project_assignments` table in both `schema.sqlite.ts` and `schema.pg.ts` with `userId` (FK users, cascade), `projectId` (nullable FK projects, cascade = global), `createdBy`, `createdAt`.
- **Authorization**: `server/utils/project-access.ts` — `getProjectScope(db, user)` returns `'all' | Set<number>`. `requireProjectAccess(event, projectId, roles?)` combines role + scope check. Admin/auth-off short-circuits to `'all'`.
- **List filtering**: Pass `scope` to shared handlers (`listProjects(db, scope)`, `getProjectMenu(db, scope)`, `getRecentTestRuns(db, scope)`, `searchProjectsTestRunsCases(db, q, scope)`). Empty set → `[]` immediate return.
- **Route verification**: For endpoints where the route `:id` IS the project id, parse it with `requireRouteId(event, 'id', label)` then call `requireProjectAccess(event, id, roles?)` directly. For endpoints scoped by a child entity (a cluster, run, case, test-run-case, or diagnosis id), use `requireResolvedProjectAccess(event, id, resolveXProjectId, notFoundLabel, roles?)` — it resolves the entity's project via one of the `resolveRunProjectId`/`resolveCaseProjectId`/`resolveClusterProjectId`/`resolveTestRunCaseProjectId`/`resolveDiagnosisProjectId` resolvers, 404s if the entity doesn't exist, then calls `requireProjectAccess`, returning `{ db, projectId, user }` so callers don't need a second `getDatabase()`. Both helpers live in `server/utils/project-access.ts` alongside the primitives they compose. Use plain `requireAuth` only for endpoints with no project scoping.
- **Write endpoints** (`submit`, `upload`, `start`, `setup`): Existing project → `scopeAllows(scope, projectId)`. New project creation → only if `scope === 'all'`.
- **Management API**: `GET/PUT /api/users/[id]/projects` (per-user) and `GET/PUT /api/projects/[id]/members` (per-project), both admin-only.
- **Backfill**: Runs idempotently after DB migrations in `server/database/index.ts`. Gives all existing `USER`/`REPORTER` rows a global `projectId = null` assignment.
- **403 everywhere**: Role refusal AND scope refusal both return 403 with an explicit message.

## Making Changes

- **DB fields**: Update `schema.ts` → `npm run db:generate` (or `db:generate:pg` for PostgreSQL) → review migration → restart
  ⚠ Never create migration files or edit `_journal.json` manually — always use `npm run db:generate`.
- **API endpoints**: Create file in `server/api/` → use `eventHandler()` + `getDatabase()`
- **OpenAPI annotations**: Add `defineRouteMeta({ openAPI: { tags, summary, parameters, security, ... } })` to each new handler to appear in the auto-generated spec at `/_openapi.json` and `/docs`. Include `security: [{ bearerAuth: [] }]` for auth-required endpoints, `security: []` for public ones.
- **Pages**: Create Vue file in `app/pages/` → use `<UDashboardPanel>` + `useFetch()`
- **Components**: Create Vue file in the matching subfolder of `app/components/` (`shared/`, `run/`, `test-case/`, `cluster/`, `project/`, `layout/`, `demo/`) → all auto-imported without path prefix (Nuxt `pathPrefix: false`) → follow existing patterns:
  - Self-contained data fetching is preferred for tab content (use `watch` + `$fetch` or `useFetch` with `lazy: true`)
  - Pass props from parent page only for data already fetched at the page level
  - Use `v-if` for tab-switched components to ensure clean mount/unmount
- **Navigation**: Edit `app/layouts/default.vue` links array
- **Tests**: Two test runners — **Vitest** for unit tests, **Playwright** for E2E/integration tests.
  - **Unit tests** (pure functions, no server/browser): Create `.test.ts` in `application/tests/unit/` → run `npm run app:test:unit`
  - **E2E/integration tests** (need server or browser): Create `.spec.ts` in `application/tests/` → run `npm run app:test`
  - `npm test` runs both (Vitest first, then Playwright).
  - If the test creates a project, **add its name to `shared/test-project-names.ts`** (alphabetically sorted) so the global setup cleanup deletes it before the next run. Tests must use static project names, not `Date.now()` suffixes.
  - Use `PROJECT.YOUR_KEY` from `#shared/test-project-names` in test code instead of raw string literals. This ensures every project name is tracked in one place.
- **Reporter**: Edit `.ts` files in `reporter/src/` → `npm run reporter:build` (from `reporter/`) → test with `npm link`
- **Shared types** (`application/shared/types.ts`): Wire contract between reporter and server. Server imports directly. The reporter shares the wire **leaf shapes** via `@piwitests/core/wire` (bundled in, so no monorepo path leaks into the published `.d.ts`); its per-case `WireTestCase` stays reporter-side and is pinned to the server payloads by `wire-shared-drift.test.ts`. Do NOT `import` `application/shared` from the reporter — use `@piwitests/core`
- **Entity links** (`shared/link-detect.ts`): Pure utility for detecting external URL provider (Jira, GitHub, etc.) and extracting keys. Uses domain regex matching, no dependencies. Provider enum includes `jira`, `github-issue`, `github-pr`, `gitlab-issue`, `gitlab-mr`, `bitbucket`, `confluence`, `slack`, `linear`, `notion`, `generic`.
- **Retry command** (`app/utils/retry-command.ts`): Pure function `buildRetryCommand(cases, opts?)` that builds a Playwright CLI command string. Three modes: `file-line` (default, most precise), `grep` (by title, survives line shifts), `file` (broadest, deduped files). Groups by project, escapes shell args, caps at 4096 chars with fallback modes.
- **Entity Links API** (`server/api/links/`): CRUD endpoints for attaching external URLs to runs, test-case runs, or test cases. Uses three nullable FK columns (`test_run_id`, `test_runs_case_id`, `test_case_id`) with `ON DELETE CASCADE` — matches the `files` table pattern. Provider auto-detected on create. `entityType` query param accepts `test_run`, `test_runs_case`, or `test_case`. Write requires `[ADMINISTRATOR, REPORTER]` role, read requires any authenticated role. Embed links in existing GET responses (`test-runs/[id]`, `test-cases/[id]`).
- **Adding a field to test run data**: Add to `shared/types.ts` payload(s) → add column to both `schema.sqlite.ts` and `schema.pg.ts` → `npm run db:generate && npm run db:generate:pg` → update `types/api.ts` (frontend types) → update all API handlers (`submit`, `upload`, `[id]/events`, `[id].get`, `[id]/stream.get`, `test-cases/[id].get`) → update server utils (`persist-run-cases.ts`) → **update reporter**: add the field to `reporter/src/types/collected.ts` (`CollectedTestCase`) and `reporter/src/types/wire.ts` (`WireTestCase`), accumulate it in `reporter/src/public/reporter.ts` `onTestEnd`/`onTestBegin`, and project it in `reporter/src/internal/submit/serializer.ts` `toWireTestCase` (per-case) or `serializeRun` (run-level). `serializeRun` is the single source of truth for the run body — both `Uploader.uploadJSON` and `Uploader.uploadWithFiles` call it, so a run-level field only touches one serializer now. → update demo (`scripts/generate-demo-seed.mjs`, `demo/api/reporter.ts`, `demo/api/test-runs.ts`, `demo/api/test-cases.ts`, `demo/simulator.ts`) → update UI components that consume the new field → `npm run app:seed:demo`

### Sharding Pattern

When implementing or extending sharding support:

- **runLabel**: Detected from CI env vars (`GITHUB_RUN_ID`, `CI_PIPELINE_ID`, etc.) by `MetadataCollector.detectCiRunLabel()` (reporter) and `detectCiRunLabel()` (helpers.ts). Users override via `PiwiDashboardOptions.runLabel`. Applied in `createGlobalSetup` too.
- **instanceId**: When `runLabel` is set, `computeInstanceId(projectName, runLabel)` uses `projectName|runLabel` instead of `hostname|projectName`. All shards share the same instanceId.
- **Per-shard tokens**: Each shard gets its own stream token. The server stores them in `RunEventBus.runStates[id].shardTokens` (`Set<string>`). Validated in `/events` and `/finish` endpoints as fallback when the main `streamToken` doesn't match.
- **Shard detection**: Reporter reads `config.shard` (from `--shard` CLI) in `onBegin`. Server detects sharded runs by `shardTotal > 1` in request bodies.
- **Server-side merge**: `/start`, `/setup`, and `/submit` reuse an existing run when `shardTotal > 1` and an active run with the same `instanceId` already exists. `/finish` accumulates counters via SQL `+` and sets final status only when `shardsFinished === shardTotal`. `cancelInstanceRuns()` skips sharded runs when `isShardedRun: true`.
- **DB columns**: `test_runs.shardTotal` (nullable integer) and `test_runs.shardsFinished` (integer, default 0).
- **New endpoint handler pattern**: Always validate shard tokens alongside the primary `streamToken`: check `cachedState.shardTokens?.has(body.streamToken)` as fallback. Use `validateAndReviveRun()` with the `isShardToken` callback.

## UI Patterns

- **UTable sticky headers**: Use the `sticky` boolean prop + `max-h-*` class on the table root element. Do NOT wrap tables in `overflow-y-auto` divs — UTable's own root handles overflow when `max-h` is set.
- **Row highlighting**: Use `:meta="{ class: { tr: 'highlight-class' } }"` on UTable, NOT `:row-attrs` (which is unsupported in Nuxt UI v4).
- **Tab panels with summary**: Use `DetailPageLayout` — renders the summary + tab bar + tab panels as direct flex children of the page body. From `lg` up: fixed summary, only the panel content scrolls (proper flex height propagation that `<UTabs>` content slots cannot provide). Below `lg`: the whole panel scrolls as one document (no clipping of a tall summary), the tab bar is sticky, the summary is collapsible via a "Hide summary" toggle, and the tab bar becomes a full-width `USelect` below `sm`.
  ```vue
  <DetailPageLayout v-model="activeTab" :tab-items="tabItems" :tab-panel-class="tabPanelClass">
    <template #summary>
      <!-- FoldableSummary or any summary content — rendered shrink-0 -->
      <RunSummary ... />
    </template>
    <template #tab-test-cases>
      <!-- Tab content — rendered inside flex-1 min-h-0 panel -->
      <TestCasesList ... />
    </template>
  </DetailPageLayout>
  ```
  The `tabPanelClass` prop lets tabs with self-scrolling content (UTable with `sticky`, etc.) use `overflow-hidden flex flex-col` instead of the default `overflow-y-auto` (applied at `lg`+ only; below `lg` the panel flows into the page scroll).
- **Data fetching in children**: For self-contained components rendered conditionally (e.g., tab content), use `watch` + `$fetch` with reactive triggers rather than `useFetch` with `lazy: true`, since `useFetch` may not fire until the component is mounted.

### UTable conventions (MUST follow)

- **Always use template slots for cell rendering** — NEVER use `cell:` callbacks with `h()` or `resolveComponent()` in column definitions. The only exception is `createSortHeader<T>()` in `header:`.
- **Mobile (MUST follow)**: a multi-column `UTable` overflows a phone. Give any table with ≥5 columns a `md:hidden` card list alongside a `hidden md:block` table (preferred — see `ProjectTrendTable`), or at minimum wrap it in `TableScroller` so it scrolls in place instead of stretching the page. Never leave a wide table to squeeze/overflow at 375 px.
- **Slot naming**: `#${accessorKey}-cell="{ row }"` for data cells (e.g. `#errorType-cell`, `#lastSeenAt-cell`). For `id`-only columns use `#${id}-cell`. Header slots: `#${accessorKey}-header` or `#${id}-header`.
- **Sort headers**: Use `createSortHeader<T>('Label')` (from `app/utils/index.ts`) for every sortable column. Non-sortable columns (actions, badges without natural ordering) use a plain string.
- **Actions column pattern**:
  ```ts
  { id: 'actions', header: 'Actions' }
  ```
  ```html
  <template #actions-header><div class="text-right">Actions</div></template>
  <template #actions-cell="{ row }">
    <div class="flex justify-end gap-2">
      <UButton :to="`/.../${row.original.id}`" size="sm" variant="outline" trailing-icon="i-lucide-arrow-right">View</UButton>
    </div>
  </template>
  ```
- **No `import { h, resolveComponent }` in table components** — if a component needs it for something other than a table cell, that's fine, but table cells must use slots.

## UI Best Practices
- Sentence case headings/labels
- Relative dates via date-fns (full timestamp on hover)
- Human-readable durations (exact ms on hover)
- Add `title` attribute on any button/control whose purpose isn't immediately obvious from its label alone. This provides a hover tooltip for clarity.

## Documentation (keep in sync with code)
- `docs/` — VitePress site published to GitHub Pages
- `README.md` — Landing page
- Update the relevant doc in the same commit as code changes (see `docs/` files for what each covers)
- **Backend logs** are documented in `docs/backend-logs.md`
- **Suite hierarchy (describe blocks)** and **test annotations** are documented in `docs/reporter.md` and the in-app [API docs](/docs).

### Replacing demo screenshots (in-app attachment thumbnails)

Demo screenshots live in `application/public/demo/screenshots/*.png` and are committed to the repo. They appear as attachment thumbnails on cluster detail pages. To replace them with fresh real-app captures:

1. **Start a plain dev server** (no `PIWI_DEMO_MODE`) on a free port:
   ```bash
   cd application
   NUXT_IGNORE_LOCK=1 npx nuxt dev --port 3002
   ```
   Auth is disabled by default — no login needed.

2. **Seed the dev DB** from the demo SQL (stop the server first to avoid a DB lock, or use a separate terminal while the server is running if it's not writing):
   ```bash
   node scripts/seed-dev-from-demo.mjs
   ```
   This reads `public/demo/seed.sql` and runs `INSERT OR IGNORE` into `.data/piwi.db`. It is idempotent.

3. **Restart the dev server** (it may have a stale DB on first boot):
   ```bash
   NUXT_IGNORE_LOCK=1 npx nuxt dev --port 3002
   ```

4. **Capture screenshots** with Playwright:
   ```bash
   node scripts/take-demo-screenshots.mjs
   ```
   This writes `public/demo/screenshots/*.png` directly. The script targets `localhost:3002` and uses the Chromium at `/opt/pw-browsers/chromium`.

5. **Commit the new PNGs** — they are committed to the repo so the demo SPA can serve them.

### Demo trace + video (committed binary evidence)

The demo's sample Playwright trace ZIP (`application/public/demo/traces/`) and failure video (`application/public/demo/videos/`) are real artifacts recorded by **`scripts/record-demo-media.mjs`** against a tiny self-contained checkout page on a throwaway local HTTP server — never a real app (traces embed full page snapshots). Regenerate with `node scripts/record-demo-media.mjs` (from `application/`) and commit the binaries. The seed generator wires them to the **highest trc id** of failure cluster 1 — this must match how `shared/handlers/failure-clusters.ts` picks `recentTestRunsCaseId` (`max(test_runs_cases.id)` per test case). In demo mode, trace-viewer links point at the **static asset URL** (not `/api/files/`) because the viewer's own service worker bypasses the demo API SW; the demo plugin pre-registers the viewer SW so the first "View trace" click works without a reload. DOM-loaded evidence (img/video) must build URLs via `fileApiUrl(path, contentType, baseURL)` so requests stay inside the demo SW's `/demo/` scope.

**Important caveats:**
- **Do not use `PIWI_DEMO_MODE=true`** for screenshot capture. The demo service worker does not install reliably in headless Chromium (cloud environment), so `#__nuxt` stays blank — you'll get empty pages.
- **Run IDs ≥ 21** have test cases. Runs #1–20 have 0 cases (the seed's `INSERT INTO __new_test_runs_cases` statements target a migration-only table that doesn't exist in the dev schema).
- **Cluster IDs with data**: #3, #4, #5, #7, #8. Use `/failure-clusters/4` for cluster detail.
- **Project #2** is the one with failure clusters (`/projects/2?tab=failure-clusters`).
- Playwright must be loaded via `require('/home/user/platform/node_modules/playwright/index.js')` from `createRequire(import.meta.url)` — ESM `import` from outside the workspace fails.

### Regenerating dashboard screenshots (light/dark split)

Marketing screenshots in `docs/public/screenshots/*.png` (used by `README.md` and `docs/index.md`) are **1280×720**. The hero shots use a diagonal **light-top-left / dark-bottom-right** split. Reproduce one with the `playwright-cli` skill against the **live demo** (it already has seed data — no local server needed):

1. **Capture both themes at the same viewport and scroll position** so they align pixel-for-pixel:
   ```bash
   playwright-cli open && playwright-cli resize 1280 720
   playwright-cli goto "https://piwitests.github.io/demo/"
   # Hide the demo banner for a clean shot (position:fixed, reflows cleanly when hidden):
   playwright-cli eval "(()=>{const s=document.createElement('style');s.id='hero-clean';s.textContent='.demo-banner{display:none!important}';document.head.appendChild(s)})()"
   playwright-cli screenshot --filename=hero-light.png
   # Switch to dark — color mode is the localStorage key 'nuxt-color-mode'; reload to apply, then re-hide the banner:
   playwright-cli localstorage-set nuxt-color-mode dark && playwright-cli reload
   playwright-cli eval "(()=>{const s=document.createElement('style');s.id='hero-clean';s.textContent='.demo-banner{display:none!important}';document.head.appendChild(s)})()"
   playwright-cli screenshot --filename=hero-dark.png
   ```
2. **Composite the diagonal split.** `playwright-cli` blocks `file://` and `run-code` has no `require`, so serve the repo over a throwaway local HTTP server and load an overlay page (the dark image is clipped to the bottom-right triangle, plus an SVG seam line):
   ```html
   <!-- hero-composite.html, alongside hero-light.png / hero-dark.png -->
   <div id="stage" style="position:relative;width:1280px;height:720px">
     <img src="hero-light.png" style="position:absolute;inset:0;width:1280px;height:720px">
     <img src="hero-dark.png"  style="position:absolute;inset:0;width:1280px;height:720px;clip-path:polygon(100% 0,100% 100%,0 100%)">
     <svg width="1280" height="720" style="position:absolute;inset:0;pointer-events:none">
       <line x1="1280" y1="0" x2="0" y2="720" stroke="rgba(0,0,0,.35)" stroke-width="4"/>
       <line x1="1280" y1="0" x2="0" y2="720" stroke="rgba(255,255,255,.85)" stroke-width="1.5"/>
     </svg>
   </div>
   ```
   ```bash
   node -e "const h=require('http'),f=require('fs'),p=require('path'),t={'.html':'text/html','.png':'image/png'};h.createServer((q,r)=>{const fp=p.join(process.cwd(),q.url.split('?')[0]);f.readFile(fp,(e,d)=>e?(r.writeHead(404),r.end()):(r.writeHead(200,{'content-type':t[p.extname(fp)]||'application/octet-stream'}),r.end(d)))}).listen(8799)" &
   playwright-cli goto "http://127.0.0.1:8799/hero-composite.html"
   playwright-cli screenshot "#stage" --filename=docs/public/screenshots/home.png
   ```
3. **Clean up** the temp PNGs/HTML and the server; `playwright-cli close`. For a non-split refresh, skip step 2 and use a single capture.

## Demo Data Requirements

When adding features with database columns, API response fields, or UI-visible changes, the demo data must be updated in four places:
1. **`scripts/generate-demo-seed.mjs`** — seed the new columns in the generated SQL
2. **`app/demo/api/`** — mirror any new server API response fields in the demo API handlers
3. **`app/demo/simulator.ts`** — emit any new streaming event fields in simulated runs
4. **`docs/`** — update the relevant documentation file

The OpenAPI spec (`.output/public/_openapi.json`) is generated by Nitro itself during `nuxt generate`: `nitro.openAPI.production: 'prerender'` in `nuxt.config.ts` makes Nitro register and prerender its built-in `/_openapi.json` route as a static file — no manual regeneration needed.

Always regenerate the seed SQL after changes: `cd application && npm run app:seed:demo`

## Troubleshooting
- DB locked? Stop other processes accessing `.data/piwi.db`
- Port 3000 in use? Use `PORT=3001 npm run app:dev` (Linux/macOS) or `$env:PORT=3001; npm run app:dev` (Windows PowerShell)
- Tests failing? Ensure no dev server on port 3000 (tests start their own)
- Reporter not found? `npm link` in `reporter/` then in target project
- Migration not applying? If a migration file or `_journal.json` was created by hand (not via `npm run db:generate`), the Drizzle migrator may silently skip it — delete the hand-written migration, revert the journal entry, run `npm run db:generate` (or `db:generate:pg` for PostgreSQL), and manually run `ALTER TABLE ... ADD COLUMN` on the existing database if needed.
- Command appears frozen / no output? It probably launched an interactive pager. Use `git --no-pager <cmd>` for `diff`/`log`/`show`, and avoid commands that open an editor or wait for input (non-interactive shells hang on them).
- **Don't start the dev server interactively** — `npm run app:dev` / `nuxt dev` runs as a foreground process and blocks all subsequent commands. The tests handle server startup automatically via `webServer` in `playwright.config.ts`. If you need to start the server manually, do it as a background PowerShell job or use `Start-Process`. Starting it directly in a bash tool call will leave you stuck until the tool times out.

## Testing API

```bash
curl -X POST http://localhost:3000/api/test-runs/submit \
  -H "Content-Type: application/json" \
  -d '{"projectName":"my-project","status":"passed","startTime":"2024-01-01T12:00:00Z","duration":120000,"totalTests":10,"passedTests":9,"failedTests":1,"skippedTests":0,"testCases":[{"title":"should login","status":"passed","duration":1500,"location":"tests/login.spec.ts:10:5"}]}'
```

## Demo Mode

The app can be built as a fully client-side SPA (no server needed) by setting `PIWI_DEMO_MODE=true`. The demo build:

1. **`npm run app:seed:demo`** — Generates `public/demo/seed.sql` (SQLite dump with 4 projects, 43 test cases, 61 test runs, 698 test-run-case rows, 8 failure clusters) and `public/demo/seed.version.json` (SHA-256 hash of the SQL content + timestamp). **`public/demo/seed.sql` is NOT committed** — it is gitignored and regenerated on demand (and in CI, `docs.yml` runs `app:seed:demo` before the demo build), so don't commit or stage it. Only `seed.version.json` is tracked. After editing `scripts/generate-demo-seed.mjs`, re-run `npm run app:seed:demo` and commit the generator + the updated `seed.version.json` (the regenerated `seed.sql` stays local).
2. **`npm run app:generate:demo`** — Builds the SPA with `ssr: false` and PWA service worker that intercepts `/api/` calls, serving them from in-browser sql.js (WASM SQLite) via Drizzle ORM.
3. The SQLite database is persisted in IndexedDB across page loads and re-seeded only when no persisted data exists.
4. **Staleness detection**: The build injects `demoDataVersion` (the SHA-256 hash from `seed.version.json`) into `runtimeConfig.public`. At runtime, the layout compares it against the version stored in IndexedDB and shows a "New demo data available" button in the sidebar footer. Clicking it wipes IndexedDB and reloads the page.
5. The service worker (`app/service-worker/demo-sw.ts`) handles API fetches via `app/demo/api/router.ts`. Both SW and main thread share `app/demo/db.client.ts` for DB initialization.
6. **Run simulator**: the demo banner hosts a "Simulate a test run" menu (`DemoSimulator.vue` + `useDemoSimulator`) that replays the reporter streaming protocol (setup → begin → events → finish) through `$fetch` against in-browser endpoint ports (`app/demo/api/reporter.ts`). Scenarios live in `app/demo/simulator.ts` and target the seeded `e2e-checkout` project so history/cluster features light up. Live updates flow over a BroadcastChannel (`app/demo/run-events.ts`) instead of SSE: `useRunStream` and the test-run detail page subscribe to it in demo mode.

## MCP Tool Conventions (MUST follow)

MCP tools (`server/utils/mcp/tools.ts`) return JSON consumed by AI coding agents. Consistency across tools saves the agent from guessing.

### Authorization & handler signature

- Every handler has the signature `(db, params, ctx)` where `ctx: McpContext = { user, scope }`. `server/routes/mcp.post.ts` resolves `scope = getProjectScope(db, user)` once and passes it in.
- **Every project- or entity-scoped tool MUST enforce scope**: call `assertProject(ctx, projectId)` when the route arg *is* a project id, or `checkEntityScope(db, ctx, id, resolveXProjectId)` (returns `'not-found'` → handler returns null/empty, throws when out of scope) for run/case/cluster/diagnosis ids. Cross-project feeds (`list_recent_activity`, `list_open_clusters`, `search`, `list_projects`) filter by `ctx.scope`.
- **Write/triage tools** (`set_cluster_status`, `run_cluster_diagnosis`, `set_cluster_base_commit`, `submit_diagnosis_feedback`) MUST call `assertWriteRole(ctx)` (reporter or admin) *and* scope-check the target.
- Prefer calling a **shared handler** (`#shared/handlers/*`) over re-querying. When a REST endpoint has inline logic an MCP tool also needs (e.g. `getProjectSpecHealth`, `getTestCaseStabilityTrend`), extract it to a shared handler and have both the endpoint and the tool call it — never duplicate.

### Field naming

| Field name | Meaning | Usage |
|-----------|---------|-------|
| `id` | The primary key of the **main entity** being returned (run ID, cluster ID, project ID) | Use only for the top-level entity |
| `testCaseId` | Stable test case identity (`testCases.id`) | Use everywhere for referencing a test case |
| `executionId` | Per-run execution record (`testRunsCases.id`) | Use for per-run case references (was `caseId` in some tools) |
| `testRunsCaseId` | Same as `executionId` — internal naming | Use in `affectedTestCases` and `locatorHealing` entries |
| `filePath` | Source file path from `testCases.filePath` | Always `filePath`, never `file` |
| `startedAt` | ISO 8601 timestamp of when something started | Always `startedAt`, never `start` or `runStart` |
| `runId` | Foreign key to `testRuns.id` | Use for run references in sub-entities |

### Response shape

- List tools (`list_runs`, `list_failed_cases`, `list_clusters`, `list_flaky_tests`, `get_test_case.recentExecutions`) return `{ items: T[], nextCursor: string | null }`.
- Paginated sub-lists inside detail tools (`get_project.runs`) also use `{ items, nextCursor }`.
- `dropNulls()` strips `null`, `''` (empty string), and `[]` (empty array) from every object before serialization.
- All error text is truncated to **400 characters** via `trunc(msg, 400)`.

### Shared types

- Tool definitions live in `shared/mcp-tools.ts` — `MCP_TOOL_DEFS` array + `McpToolName` union.
- `PaginatedResponse<T>` is defined there too (`{ items: T[]; nextCursor: string | null }`).
- Handler behavior lives in `server/utils/mcp/tools.ts`; the route in `server/routes/mcp.post.ts`.

### Validation

- Use `numericParam(raw, name)` for every numeric param — throws on `NaN`.
- Use `numericCursor(raw)` for numeric cursors — returns `undefined` for empty and throws a clean error (not a SQL failure) on garbage. Never `Number(cursor)` inline.
- Use `clampPageSize(raw)` — returns 1–50, default 10.
- Use `paginatedItems(items, pageSize, getCursor)` to wrap a `pageSize + 1` fetch into `{ items, nextCursor }`. **`getCursor` must read the POST-map field name** (e.g. `r.executionId`, not the pre-map `r.caseId`) — reading a field the mapper renamed yields a `"undefined"` cursor that crashes the next page.
- In-memory-filtered list paths (e.g. `list_runs` branch filter) MUST still apply the cursor in memory on the same axis as the emitted cursor, or paging loops on the first page.

## Important Notes
- DB auto-initialized on first API call
- Projects auto-created on first submission
- Dates stored as Unix timestamps in SQLite
- Run typecheck, lint, and tests only at the end before final commit (not after every task)

### Exploration & Audit Findings

When exploring the codebase or performing audits (schema reviews, dependency checks, code quality scans, etc.), log any bugs, inconsistencies, tech debt, or non-critical issues discovered in **`plans/exploration-findings.md`**. Use a structured format:

```markdown
## [Date] — [Exploration Type/Area]

### Finding: [Brief title]
- **File/Component**: location in codebase
- **Issue**: Description of the bug or inconsistency
- **Impact**: Severity and effect (e.g., "Low", "May affect performance", "Blocks feature X")
- **Suggested fix**: Recommended action (optional if the fix is obvious from the issue)
```

**Do not commit these findings to git** — they're local working notes. The roadmap (`plans/roadmap.md`) should reference notable findings under a dedicated "Known Issues & Tech Debt" section if they impact ongoing work or priorities.
