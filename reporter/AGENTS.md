# Reporter — agent guide

Rules for working inside `reporter/` (the published `@piwitests/reporter` package). Read
[`../AGENTS.md`](../AGENTS.md) first for repo-wide conventions, and **[`ARCHITECTURE.md`](ARCHITECTURE.md)** for the
full map: public/internal split, the two-process collect-and-submit data flow, the submit fallback ladder, and the
per-directory responsibilities.

## The contracts you can break

1. **Public API** — anything exported from `src/index.ts` (the single `.` entry). Changing it is a breaking change.
   Everything under `src/internal/` is private plumbing; change it freely.
2. **Wire types** (`src/types/wire.ts`) — the JSON exchanged with the server. A change here is a server-contract change
   and must land with the matching dashboard change; `application/tests/unit/wire-shared-drift.test.ts` pins the two
   together.
3. **Side effects** — `PIWI_*` env vars (`internal/config/env.ts`), `piwi-*` attachment names
   (`internal/capture/attachments.ts`), temp files in `os.tmpdir()`, and `[Piwi Dashboard]`-prefixed log output.

## Conventions

- The package is **strict-mode TypeScript**. Node built-ins are imported as `import * as x from 'node:x'`.
- Classes use `private readonly` constructor parameter-property DI.
- HTTP failures throw `HttpError` (carrying `status`) from `internal/transport/http-client.ts`.
- `catch (error)` is `unknown` — narrow with `instanceof`, format with `errorMessage` (`internal/support/errors.ts`).
- Shared pure logic (locator generation/scoring, ARIA fingerprints, wire leaf shapes) comes from **`@piwitests/core`**
  and is bundled in by tsup, so the published package stays self-contained. **Never re-implement a core function here**
  — `application/tests/unit/reporter-core-identity.test.ts` asserts the reporter re-exports the exact core functions and
  fails on a copy. **Never import `application/shared`** from the reporter.
- `internal/submit/serializer.ts` is the single source of truth for the wire field list: `toWireTestCase` for per-case
  fields, `serializeRun` for the run body (used by both `uploadJSON` and `uploadWithFiles`).

## Workflow

```bash
npm run reporter:build      # tsup → dist/ (.js + .d.ts); reporter:dev for watch mode
npm run reporter:typecheck
npm run reporter:lint       # :fix to auto-fix
npm run reporter:format     # :check to verify only
npm run reporter:test       # :watch, :coverage, :integration
```

Source is TypeScript in `src/`; `dist/` is generated — never edit it. To try the package in a real project, build then
`npm link` here and in the target project.

Adding a field that flows from Playwright to the dashboard touches both repos' halves — follow the ordered checklist in
[`../application/AGENTS.md`](../application/AGENTS.md#adding-a-field-to-test-run-data).
