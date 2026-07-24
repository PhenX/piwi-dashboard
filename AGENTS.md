# Piwi Dashboard — Agent Instructions

> **Note:** Piwi Dashboard is **not affiliated with, endorsed by, or connected to Microsoft Corporation** in any way.
> The name "Piwi" was chosen as a playful, unrelated name. The project was originally called "Playwright Dashboard" and
> was renamed to avoid confusion with Microsoft's Playwright testing framework.

Root guide for any AI agent (Claude Code, opencode, Copilot, Cursor, …). It covers the whole monorepo: what lives where,
how to run and verify things, and the conventions that apply everywhere.

**Area guides — read the one covering the directory you are editing, in addition to this file:**

| Editing… | Read first |
|---|---|
| `application/` — the Nuxt dashboard (app, server, demo, MCP) | [`application/AGENTS.md`](application/AGENTS.md) |
| `reporter/` — the Playwright reporter package | [`reporter/AGENTS.md`](reporter/AGENTS.md) |
| `desktop/` — the Tauri desktop shell | [`desktop/AGENTS.md`](desktop/AGENTS.md) |
| `docs/` — the VitePress documentation site | [`docs/AGENTS.md`](docs/AGENTS.md) |

Reference material worth opening when you need the map rather than the rules:
[`application/ARCHITECTURE.md`](application/ARCHITECTURE.md) (dashboard) and
[`reporter/ARCHITECTURE.md`](reporter/ARCHITECTURE.md) (reporter).

## Project overview

A test results dashboard for **Playwright**, built with **Nuxt 4** and **Nuxt UI**. It ingests test results from a custom
reporter, stores them (SQLite or PostgreSQL), and adds analysis on top: flaky detection, failure clustering, AI diagnosis,
locator healing, notifications and an MCP server for AI agents. Self-hosted only — no SaaS, no other test frameworks
(see [`ROADMAP.md`](ROADMAP.md) for direction and non-goals).

## Repository layout

```
application/          Nuxt 4 dashboard — app (UI), server (API), demo SPA, MCP server
application/shared/   Types, constants & pure utilities shared app-wide (import via `#shared/...`)
packages/core/        @piwitests/core — private, zero-dependency logic shared by app AND reporter
packages/server/      @piwitests/server — published npm run-option (`npx @piwitests/server`)
reporter/             @piwitests/reporter — the Playwright reporter (TypeScript → bundled via tsup)
desktop/              Tauri desktop shell that bundles and runs the same server locally
docs/                 VitePress documentation site, published to GitHub Pages
integrations/nitro/   Backend-log instrumentation for Nitro apps
integrations/aspnetcore/  Backend-log instrumentation for ASP.NET Core (NuGet)
examples/             Standalone usage examples (Playwright fixtures)
plans/                Local working docs — gitignored, never committed
```

`plans/` holds two tracked-by-hand files: `plans/roadmap.md` (working priorities) and `plans/exploration-findings.md`
(a log of bugs, tech debt and inconsistencies found while exploring). Both are local-only. Public direction lives in the
committed [`ROADMAP.md`](ROADMAP.md).

## Quick start

Prerequisites: **Node.js 24+**, npm, Git. Commands run from `application/` unless noted.

```bash
cd application
npm install
npm run app:dev      # http://localhost:3000
```

The SQLite database and `.data/` storage are created automatically on the first API call — no configuration needed.

## Commands

From `application/`:

| Command | Purpose |
|---|---|
| `npm run app:dev` | Dev server |
| `npm run app:build` / `app:preview` | Production build / preview it |
| `npm run app:typecheck` | TypeScript check |
| `npm run app:lint` / `app:lint:fix` | oxlint |
| `npm run app:format` / `app:format:check` | oxfmt |
| `npm run app:test:unit` | Unit tests (Vitest) — add `:coverage` for coverage |
| `npm run app:test` | E2E tests (Playwright) — add `:ui` / `:report` |
| `npm test` | Everything: unit first, then E2E |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle, SQLite — append `:pg` for PostgreSQL |
| `npm run app:seed:demo` | Regenerate demo seed data (`public/demo/seed.sql`) |
| `npm run app:seed:dev` | Load the demo sample data into the local dev SQLite DB |
| `npm run app:generate:demo` / `app:check:demo` | Build / verify the demo SPA |
| `node scripts/db-query.mjs "<sql>" [--json]` | Query the local SQLite DB directly |

From `reporter/`: `reporter:build`, `reporter:dev` (watch), `reporter:typecheck`, `reporter:lint[:fix]`,
`reporter:format[:check]`, `reporter:test[:watch|:coverage|:integration]`.

Run typecheck, lint and tests **once at the end** before the final commit — not after every edit.

## Conventions that apply everywhere

### Code

- **Keep it simple.** This is a deliberately AI-friendly codebase: obvious code beats clever code.
- Full TypeScript; Nuxt 4 conventions and Nuxt UI components in the app.
- **American English** spelling throughout ("initialize", "organize", "color").
- **Extract a shared component/helper** when the same block exceeds ~10 lines and appears more than once.

### Comments

- **Never reference plans or specs.** No plan IDs (`A1`, `B3`), plan file names or plan titles in code. Strip all
  plan-track metadata before writing code — comments say what the code does, not where the requirement came from.
- **Never write before/after comparisons.** No "was X, now Y", "replaced A with B", "better than the old approach".
  Comments describe the current state only. Git holds the history.

### Commits & PR titles (MUST follow — CI lints every commit)

`commitlint.config.js` at the repo root is the source of truth; [`CONTRIBUTING.md`](CONTRIBUTING.md) has the full guide
and the type → release-bump table. release-please reads PR titles (squash-merge subjects) to compute version bumps.

Format `type(scope): subject`:

- **type** — `feat` `fix` `perf` `docs` `chore` `ci` `refactor` `test` `build` `style` `revert`
- **scope** — closed list, anything else fails: `app` `reporter` `db` `ui` `demo` `ci` `docs` `deps` `auth` `ai`
  `notifications` `release` (`main` is reserved for release-please). Optional but include the best fit; never invent one
  (a timeline component change is `fix(ui)`, not `fix(timeline)`).
- **subject** — lower-case start, imperative, no trailing period, full header ≤ 100 chars.

The `commitlint` CI check lints **every commit in the PR range**, so one bad message turns the PR red. Self-check with
`npx commitlint --from HEAD~<n> --to HEAD` from the repo root, and never bypass the husky `commit-msg` hook with
`--no-verify`.

### Cross-platform shell commands

Any command shown to a **user** (docs, `*.md`, in-app `CodeBlock` snippets) must work on Windows too. Prefer a portable
single command — `npm`/`npx`/`docker`/`git` behave the same everywhere, and
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` replaces `openssl rand -hex 32`. Avoid
bash `\` line continuations; write one line.

When no portable form exists, show both: in VitePress use `::: code-group` with ```bash [Linux / macOS] +
```powershell [Windows (PowerShell)] tabs; in GitHub-rendered `*.md` use two consecutive labeled fenced blocks.
Mappings: `$(pwd)` → `${PWD}`; `VAR=val cmd` → `$env:VAR='val'; cmd`; `rm -rf X` → `Remove-Item -Recurse -Force X`;
`\` → backtick. Linux-only Docker host operations (`chmod`/`chown` on bind mounts) need no PowerShell form — just note
they apply to Linux hosts. Convert first-touch `curl` examples (submit, auth setup/login) to an `Invoke-RestMethod` tab;
other `curl` examples may stay bash-only. `.env` file contents are not shell commands — leave them as-is.

### Documentation

- Update the affected doc **in the same commit** as the code change.
- User-facing docs live in `docs/` (VitePress → GitHub Pages); `README.md` is the landing page.
- API reference is **generated** — never hand-write endpoint docs. See [`docs/AGENTS.md`](docs/AGENTS.md).

### Tests

- **Vitest** for unit tests (pure functions, no server/browser): `application/tests/unit/*.test.ts` and
  `packages/*/tests/`, `reporter/tests/`.
- **Playwright** for E2E/integration (needs a server or browser): `application/tests/*.spec.ts`.
- A test that creates a project MUST use a static name from `#shared/test-project-names` (`PROJECT.YOUR_KEY`) and
  register it there alphabetically, so global-setup cleanup removes it. Never use `Date.now()` suffixes.

### Working with the user's requests

- **Capture global change requests**: when asked to apply a change across many files ("update all X to Y"), add the
  resulting convention as a rule to the relevant `AGENTS.md` so future edits follow it. Put it in the narrowest file
  that covers it — area guide first, this root file only if it truly applies everywhere.
- **Log what you find**: bugs, inconsistencies and tech debt discovered while exploring go to
  `plans/exploration-findings.md` (local, never committed) as:

  ```markdown
  ## [Date] — [Exploration type/area]

  ### Finding: [Brief title]
  - **File/Component**: location in codebase
  - **Issue**: what is wrong
  - **Impact**: severity and effect
  - **Suggested fix**: recommended action (omit if obvious)
  ```

  Reference notable findings from `plans/roadmap.md` under "Known Issues & Tech Debt" when they affect priorities.

## Troubleshooting

- **DB locked?** Stop other processes touching `.data/piwi.db` (the dev server holds it — `app:seed:dev` needs it down).
- **Port 3000 in use?** `PORT=3001 npm run app:dev` (Linux/macOS) or `$env:PORT=3001; npm run app:dev` (PowerShell).
- **Tests failing?** Make sure no dev server is on port 3000 — the Playwright config starts its own.
- **Reporter not found?** `npm link` in `reporter/`, then in the target project.
- **Migration not applying?** A hand-written migration file or `_journal.json` edit makes the Drizzle migrator skip it
  silently. Delete it, revert the journal entry, and re-run `npm run db:generate` (or `db:generate:pg`).
- **Command appears frozen?** It probably opened an interactive pager. Use `git --no-pager <cmd>` for `diff`/`log`/`show`
  and avoid anything that waits for input — non-interactive shells hang on them.
- **Never start the dev server in the foreground of a tool call.** `npm run app:dev` blocks until timeout. Playwright
  starts its own server via `webServer`; if you need one manually, run it in the background.
