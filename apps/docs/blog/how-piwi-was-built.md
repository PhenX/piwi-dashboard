---
title: How Piwi was built
date: 2026-08-17
author: Fabien Ménager
excerpt: A retrospective from the git history — the first eight months of Piwi, from a Nuxt template dropped in on a Sunday in December to a self-hosted platform that explains test failures. Three AI collaborators, a 70-day silence, and an idea that narrowed as it grew.
sidebar: false
---

# How Piwi was built

This is where Piwi came from, reconstructed from the git history of `PiwiTests/platform` — from the first commit on **7 December 2025** to **1 August 2026**, its first eight months. Everything here is sourced from actual commits, diffs and tags. Where a commit message was vague ("Rename project", "Various fixes"), I read the diff to find out what actually happened. A short note at the end brings it up to today.

## The numbers

|  |  |
|---|---|
| **Span** | 7 Dec 2025 → 1 Aug 2026 — **238 days**, just under 8 months |
| **Commits** | 1,673 total (1,293 real commits + 380 merges) |
| **Merged pull requests** | 338 |
| **Releases tagged** | 41, from `v0.0.1` to `v0.23.0` |
| **Files tracked (1 Aug)** | 1,556 |
| **Database migrations** | 46 (after one full reset) |
| **Names it went through** | Playwright Dashboard → Piwi Dashboard → Piwi (org: PhenX → PiwiTests) |

Who wrote it, by non-merge commits:

| Contributor | Commits | Active period |
|---|---:|---|
| Claude | 588 | Jun 22 → Aug 1 |
| Me (across four git identities) | 468 | Dec 7 → Aug 1 |
| GitHub Copilot SWE agent | 229 | Dec 7 → Jun (tapering after Apr) |

That handover is one of the real stories of this project: it was **Copilot-built in December**, **hand-driven from April to June**, and **Claude-built from late June onward** — with me as the architect throughout.

## Act 0 — The seed (7 December 2025, one Sunday)

The repository opens with two commits both called *"Initial commit"*: first a `.gitignore` and a one-line README — an empty room — then the **Nuxt UI Dashboard template**, dropped in wholesale. It arrived with all the starter furniture still in place: a `customers/` module, an `inbox/`, a fake sales homepage, a teams menu, invented stats. None of it had anything to do with tests yet.

Then, the same Sunday, I opened my first Copilot task — and one PR turned that template into a product skeleton in a single day:

- a Drizzle schema and a SQLite database
- `server/api/` endpoints for projects, test runs and test cases
- a `POST /api/test-runs/submit` ingest endpoint
- **the reporter package** — the Playwright reporter that pushes results
- upload/download APIs for HTML reports and traces
- upload of the *entire* Playwright HTML report as a zip, assets and traces included

By the end of day one the core loop already existed: **run tests → reporter uploads → dashboard shows history**. That loop never changed. Everything for the next eight months was built on top of it.

Two decisions from that first day survived to today: the projects switcher that replaced the template's teams menu, and storing **relative** file paths rather than absolute — a small thing that made the whole storage layer portable later.

## Act 1 — The Copilot sprint (8–27 December 2025)

Six working days across December, almost entirely Copilot PRs with me reviewing, merging and cleaning up behind — 114 Copilot commits that month against my 57.

- **8 Dec** — flaky-test statistics, and the schema refactor that made test cases *shared between runs* instead of duplicated: the thing that makes "has this test always been flaky?" answerable at all. Plus a test-case catalog per project and zstd compression.
- **13 Dec** — the project sidebar with counters and status; Playwright tests wired into CI. *The dashboard started testing itself* — and never stopped.
- **21 Dec — the big infrastructure day.** Four things landed that defined the product's shape: **authentication** (scrypt hashing, user management); **Drizzle migrations**; a **storage abstraction with S3 support**, so local disk stopped being the only option; and the **Docker image workflow**, which made self-hosting real.
- **22 Dec** — `better-sqlite3` swapped for Node's native SQLite via `@libsql/client`, forcing the Node 22+ floor. `v0.0.1` through `v0.0.5` all shipped this day — a rapid-fire debugging session against the Docker Alpine build.
- **25 Dec** — a Christmas Day refactor: zstd ripped back out for native zlib, the old paths deleted rather than kept around.

December was about proving the thing could exist and be deployed. Auth, storage, Docker and migrations in one week is a "this is going to be a real product" statement.

## Act 2 — The winter lull (January – March 2026)

The history goes quiet. Windows build fixes on 2 Jan; a lone "code cleanup" on 24 Jan; CI/git metadata collection on 1 Feb — and then nothing for 70 days. Eleven commits in three months. The project was parked.

## Act 3 — The reawakening (12 – 26 April 2026)

It restarts the way these things do: with an "Update packages" commit — a 10,800-line lockfile diff. Housekeeping as a way back in. Then it doesn't stop.

**12 April — performance tracking, shipped in numbered phases.** The first time the history shows a *plan* being executed rather than features added ad hoc: the reporter collects metrics, schema and types follow, then endpoints, then the frontend and run comparison, then tests. Network-request tracking and **web vitals** land right after. The dashboard stopped being a pass/fail log and started being a performance record.

**25 April — a single enormous day** (30 commits): **multi-report support** (Monocart, Allure and blob reports alongside HTML), and **demo mode for GitHub Pages** — the decision that later became the project's best front door. A tagging system iterated three times in one day. Storage stats and bulk cleanup — the first acknowledgement that keeping everything forever has a cost.

**26 April — going public** (49 commits, the second-biggest day of the project): the **VitePress documentation site**; the reporter **published to npm**; **API keys** for reporter authentication; S3 tested for real against MinIO in CI. Allure support was added and dropped within 24 hours — the first visible scope *cut*.

## Act 4 — Live, durable, portable (May 2026)

May is when the dashboard learned to run in three places at once: on Postgres, live, and entirely inside a browser.

- **24 May — PostgreSQL support.** From here the schema is maintained twice (`schema.sqlite.ts` / `schema.pg.ts`) with dual migration folders — a real, deliberate tax paid for the rest of the project's life, so that "self-hosted" could mean either a file or a real database.
- **26 May — live streaming.** Runs started appearing as they happened. The same day, the polling composable was thrown away and replaced with **SSE through a single global stream**.
- **28 May — the demo becomes the real app.** One commit puts **SQLite in the browser** (`sql.js`, a Drizzle proxy, OPFS for storage); the next replaces a `$fetch` monkey-patch with a proper **service worker**, so the browser build intercepts real HTTP calls. The live demo stopped being a mock and became the actual application running on seeded data with no backend. That is still true today.
- **29–31 May** — a full UI/UX audit, spelling normalised to American English, and a long list of paper cuts closed.

## Act 5 — The rename, and the pivot (June 2026)

June is the hinge month — 502 commits, more than December through May combined. Two things happen: the project gets its identity, and it stops being a dashboard.

### The rename (3 June)

**Playwright Dashboard → Piwi Dashboard**, with a disclaimer written straight into the README — *not affiliated with, endorsed by, or connected to Microsoft Corporation* — to avoid any confusion with Microsoft's Playwright framework. The npm package and Docker image were renamed to match. A new logo followed on 13 June.

### Foundations, re-poured (1–14 June)

The environments feature end to end in one commit; `AGENTS.md` created and the Copilot instructions deleted — an explicit change of AI collaborator. Run comparison and a workers timeline. The reporter **ported to TypeScript**, Oxfmt adopted, **OAuth** implemented, full multi-browser support with Firefox in the pipeline.

Then **14 June — the reset day.** A commit titled **"Reset all migrations, from scratch 🔥🔥🔥"** collapses 25+ SQLite and Postgres migrations into one clean baseline. The same day: **npm workspaces**, **oxlint + oxfmt** as the lint/format stack, a repo-wide reformat, a pre-commit hook, and **Docker Hub publishing**. Fifty-four commits. I cleared the decks.

### The pivot: from *storing* failures to *explaining* them

This is the conceptual turn the whole product now rests on.

- **10 June — failure clustering.** A new `error-fingerprint.ts`: forty red tests collapse into the three root causes behind them. Cluster UI and triage follow within 24 hours.
- **13 June — AI diagnosis.** A settings page for a provider *you* configure, a diagnose endpoint per cluster — and, notably, **a mocked AI path in the demo from day one**, so the feature was demonstrable to strangers immediately.
- **14 June — git context.** A commit picker and an abstracted SCM layer, so the diagnosis could read your actual diff.
- **21 June — the MCP server.** 622 lines of tool definitions, so a coding agent could ask the dashboard about test health. Same day: secrets encryption, notifications and subscriptions, and regression tracking.
- **22–23 June — the diagnosis quality campaign**, again in numbered phases: deterministic fingerprinting, enriched context (compared-to-last-pass, retry progression), a redesigned result UI, a transparency layer (coverage map, citations), and a **two-stage pipeline with a separate research model**. In parallel: per-role AI providers, embedding-based near-duplicate reconciliation, and human-in-the-loop merge suggestions.
- **23 June — wasted-time tracking** — the idea that a flaky test has a measurable cost in CI minutes, which became the "fix the expensive ones, not the annoying ones" pitch.

### And then, on 28 June: locator healing

Captured locator snapshots from passing runs, a healing engine, panels on both the cluster and test-case pages, and the healing result fed into the AI context. Within the same day it was gated behind a flag for cost, taught to heal *chained* locators, given a convention-preserving recommendation, and extended to suggest fresh locators when an element is simply renamed or moved.

This is the moment Piwi stops being a reporting tool. It now hands back a fix.

*(Also at the end of June: the move to the **PiwiTests** GitHub organisation, packages becoming `@piwitests/*`; and the first Claude-authored commit, on 22 June. From there to the end, Claude writes roughly two commits for every one of mine, and on 25 June the Claude PR-assistant and code-review workflows made that collaboration part of CI.)*

## Act 6 — Industrialisation (1–19 July 2026)

The product exists; July's first half is about making it trustworthy and legible.

- **1–4 Jul** — docs realigned with the actual product; the MCP server audited and its scope enforced; AI diagnosis taught to fetch **full source files** and to **validate its own suggested patches** before showing them.
- **8 Jul — the testing-debt day.** Pure-logic unit tests across app and reporter, a **wire-contract drift guard**, coverage tooling, and E2E coverage for heartbeat, SSE streaming and diagnosis.
- **9 Jul — `release-please` adopted** for file-authoritative versioning. From here the cadence goes from sporadic to roughly weekly, and the CHANGELOG becomes real.
- **11 Jul** — capture fixtures documented with a runnable example; the fixtures renamed to `piwiFixtures` (the project's first deliberate breaking change); videos promoted to first-class evidence.
- **12 Jul — the evidence explosion.** Nine features in a day, all pointed at giving the diagnosis more to work with: environment diff vs the last pass; LCP/CLS/INP tiles; a lazy visual diff of failure vs last-pass screenshot; sanitised DOM snapshots from trace blobs; captured page state; structural healing for renamed labels.
- **13–14 Jul — the locator picker.** The reporter learned to open Playwright Inspector on the failing page and then to run a **failure-time locator picker** — anchors, snapping, live match counts — so a human can point at the element and have the pick flow back into healing. `@piwitests/core` was extracted to share the locator logic between reporter and app.
- **15–16 Jul** — an ARIA tree view; multi-frame call stacks with real source; the test-run-case page rebuilt as a **diagnosis-first flow**; source paths that open in your local IDE; the API reference rendered in-app instead of from a CDN. Plus ingest caps, a retention sweep, and content-addressed dedup.
- **17–19 Jul** — a try-it console in the API docs; the **cross-project analytics dashboard**; trace stack and network parsing with their own evidence cards; a pass-rate heatmap; the reporter publishing the dashboard run URL back to the CI runner; **`@piwitests/server`** on npm so the dashboard runs without Docker; and an env-var registry that generates the configuration reference, so docs can't drift from what the app reads.

## Act 7 — Piwi becomes a platform (20 July – 1 August 2026)

The last twelve days are the densest of the project — roughly 300 commits.

- **20–21 Jul** — OpenTelemetry-style server traces end to end: backend spans attached to the requests that caused them. Then timeout hygiene — surfacing reducible timeouts and the CI time you'd reclaim.
- **22 Jul — the desktop app.** A **Tauri** shell bundling the local server, with a loopback access guard, tray controls, autostart, and the reporter taught to submit to it.
- **24–25 Jul — the positioning rewrite.** Agent instructions split into scoped guides, the docs site restructured **around the reader's journey**, the README rewritten around a single line. And then, in one two-day burst, the features that made Piwi part of the development *loop* rather than a place to look afterwards: **import of past runs** from blob reports and bare traces; **test tags and ownership** derived from CODEOWNERS; **pull-request feedback** separating new failures from pre-existing ones; the **CI gate**; **fix verification**; **quarantine with an exit ramp**; and **fix plans for agents**.
- **26 Jul** — offline HTML/Markdown export; the CI suite built once and sharded six ways; **one-click deploy templates** for Railway, Render, Fly, Koyeb and Coolify, generated from the same env registry as the docs; and five desktop features in a row (local runs, drag-and-drop import, one-click MCP configuration, in-app updates, tray badge).
- **28 Jul — the browser extension.** The picker overlay extracted into `@piwitests/picker-dom`, and on top of it the **Piwi Picker extension** — a locator console, multi-pick pattern derivation, a lint overlay, and an assertion suggester. Alongside: `piwi init` with agent skills.
- **29 Jul** — the extension learned to record actions across pages, matched live against your own test functions; smarter locator generation (app-specific `data-*` anchors, `filter({ hasText })` for repeated containers).
- **30 Jul — the monorepo reorg**: everything moved into `apps/` and `packages/`. 1,368 files touched, almost all pure renames.
- **31 Jul — closing the loop.** Run tests locally from the dashboard, with a persistent runs tray and live progress. And the beginning of the next chapter: a **deterministic replay core for natural-language AI steps**, with an author-verify-commit loop.

## Where it stood (1 August 2026, v0.23.0)

```
apps/
  application   the Nuxt dashboard (app, server, demo, MCP)
  extension     the Piwi Picker browser extension
  docs          the VitePress site
  desktop       the Tauri shell
packages/
  reporter      the Playwright reporter
  core          shared locator logic
  picker-dom    the shared picker overlay
  server        the npm-installable dashboard server
integrations/   ASP.NET Core + Nitro backend instrumentation
examples/       a runnable capture-fixtures project
```

The README's line, December vs today:

> December: *"a self-hosted web application for collecting, storing, and visualizing Playwright end-to-end test results over time."*
>
> Today: *"Your Playwright results, kept and explained."*

**Collecting → explaining.** That's the whole arc in two words.

## Since then (August 2026)

The retrospective above stops at 1 August. In the two weeks after, at **v0.25**, the "hand back a fix" idea took its most literal step yet — [auto-heal PRs](/auto-heal): when a locator breaks on the default branch and the evidence is strong enough, Piwi opens the fix as a draft pull request itself, off by default and behind a per-project allowlist. [Public share links](/share-links) landed alongside it — a read-only URL for one failure that anyone can open without an account — with first-admin browser setup and auth rate limiting rounding out the security posture. The project is still pre-1.0, and the next milestone is [1.0 stabilization](https://github.com/PiwiTests/platform/blob/main/ROADMAP.md): settling the wire format and API surface, then committing to semver stability.

## Six things the history shows

**1. The idea narrowed as it grew.** Eight months of feature work, and the roadmap now states the product in three ranked sentences — *keep the history, explain the failures, hand back a fix* — with the explicit rule that a feature not serving one of them is an argument against building it. That clarity is dated late July. It was earned, not designed up front.

**2. Three AI collaborators, three eras.** Copilot's agent built December's skeleton from `copilot-instructions.md`. I deleted those instructions on 1 June and wrote `AGENTS.md` instead. Claude's first commit is 22 June; by July it's writing the majority of the commits while I review and merge. The project is, among other things, a record of what agent-assisted development looked like across that year — which is why I don't hide it.

**3. Things I added and then deleted.** Allure support (added and removed within 24h). zstd (replaced by zlib two weeks later). `better-sqlite3` (→ libsql). Polling (→ SSE the same day it shipped). The standalone API-docs page (removed, rebuilt in-app). All 25 database migrations (reset to zero). The willingness to throw work away is visible on almost every page of this history.

**4. The demo is the product.** Choosing to build a GitHub Pages demo, and then to make it *the actual app running on SQLite in the browser*, meant every feature after that had to be demonstrable to a stranger with no install. That constraint shows up in dozens of commits, and it's why the project has a front door.

**5. It tests itself.** From 13 December, Piwi's own CI runs Playwright tests against Piwi. Every capability — sharding, environments, flakiness, wasted time, the CI gate — was dogfooded on the project's own suite before it shipped.

**6. The pauses didn't kill it.** The 70-day silence between February and April didn't. The rename didn't. The org move didn't. The thing that restarted it in April was an `npm update`.

## Release timeline

| Date | Version | What it carried |
|---|---|---|
| 22 Dec 2025 | v0.0.1 – v0.0.5 | first Docker images, native SQLite |
| 23–25 Dec 2025 | v0.0.6 – v0.0.7 | zlib compression |
| 13 Apr 2026 | v0.0.8 | performance tracking |
| 26 Apr 2026 | v0.1.0 – v0.1.3 | docs site, npm reporter, API keys, demo mode |
| 14 Jun 2026 | v0.2.0 – v0.2.1 | rename to Piwi, workspaces, Docker Hub |
| 23 Jun 2026 | v0.3.0 | failure clustering + AI diagnosis |
| 24 Jun 2026 | v0.4.0 – v0.4.4 | move to the PiwiTests org |
| 28 Jun 2026 | v0.5.0 | locator healing |
| 2 Jul 2026 | v0.6.0 | MCP hardening, context pipeline |
| 8–9 Jul 2026 | v0.7.0 – v0.9.1 | test-coverage push, release-please |
| 11–12 Jul 2026 | v0.10.0 – v0.12.0 | piwiFixtures, evidence explosion, visual diff |
| 18–19 Jul 2026 | v0.13.0 – v0.15.0 | analytics, trace parsing, `@piwitests/server` |
| 22–23 Jul 2026 | v0.16.0 – v0.18.2 | timeout hygiene, the desktop app |
| 26–27 Jul 2026 | v0.19.0 – v0.20.0 | imports, CI gate, PR feedback, one-click deploy |
| 30–31 Jul 2026 | v0.21.0 – v0.23.0 | extension, monorepo reorg, local runs, AI steps |

---

*Reconstructed from 1,673 commits. Nothing above is inferred from a commit message alone where the message was ambiguous — in those cases I read the diff.*
