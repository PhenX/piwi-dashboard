---
name: plan-management
description: Update, archive, and track implementation plans and the roadmap. Use when the user asks to update a plan, check plan progress, archive a completed plan, or sync the roadmap with shipped/planned work.
---

# Plan Management

This skill covers the end-to-end workflow for managing implementation plans in the Piwi Dashboard project. Plans live in `plans/`; the roadmap (`plans/roadmap.md`) is the single source of truth for product direction and status.

## When to Use

- User asks to "update the X plan" or "check progress on X plan"
- User asks to "archive" or "mark as shipped" a plan
- User asks to update the roadmap
- User asks to add/remove items from a plan's checklist
- After implementing features from a plan — sync its status

## Workflow

### 1. Read the plan and assess its state

Read the plan file from `plans/<name>.md`. If the plan has a "File-by-file checklist" or numbered checklist sections, those are the items to check.

For each checklist item, search the codebase to determine whether it's been implemented:

```bash
# Check if specified files exist
Test-Path "<path>"
# Search for key symbols introduced by the plan
rg "<symbol>" --include "*.ts" --include "*.vue" application/ reporter/
# Check type definitions, schema, API handlers, UI components, demo mirror, tests
```

Do NOT use `Get-ChildItem` for file existence — use `Test-Path` or `glob`/`grep` tools.

### 2. Determine plan status

A plan is **fully shipped** when ALL checklist items are confirmed implemented in the codebase. A plan is **partially shipped** when some sections are done and others remain.

### 3. If fully shipped — archive it

Move the plan to `plans/archive/`:
```bash
Move-Item -LiteralPath "plans\<name>.md" -Destination "plans\archive\<name>.md"
```

Then update `plans/roadmap.md` in TWO places:

**A) "Shipped — archived plans" table** (near the top): Add a new row with a brief description and the archive link.

**B) "Detailed plans" table** (near the bottom): Add a row or update existing row with `✅ Shipped (YYYY-MM-DD)`.

Format:
```markdown
| Brief feature description | [`<name>.md`](archive/<name>.md) |
```

### 4. If partially shipped — update the plan in place

- Mark completed items as `[x]` (or `✅`) in the plan's checklist.
- Add completion dates if the plan convention uses them (e.g., `✅ shipped 2026-07-01`).
- If the unshipped remainder should be deferred/split into a new plan, note it.
- Update the roadmap's "Detailed plans" table to reflect partial status (e.g., `🟢 Track A shipped; Track B open`).

### 5. Roadmap conventions

The roadmap has these sections:

- **"Shipped — archived plans" table**: brief description + archive link for each fully-shipped plan.
- **"Detailed plans" table**: every plan (active, partially shipped, shipped) with status and link.
- **Thematic sections (§4–§14)**: cross-reference shipped plans by marking them as done (e.g., "✅ shipped").

When adding a shipped plan, update ALL relevant sections:
1. Shipped table → new row
2. Detailed plans table → `✅ Shipped` row
3. Relevant thematic section → mark item as `✅`

### 6. Capture findings

If the assessment reveals bugs, inconsistencies, or technical debt, append them to `plans/exploration-findings.md`:
```markdown
## [Date] — Plan audit: <plan-name>

### Finding: <title>
- **File/Component**: <location>
- **Issue**: <description>
- **Impact**: Low / Medium / High
- **Suggested fix**: <recommendation>
```

### 7. No commit needed

Plans are gitignored (`plans/` is in `.gitignore`) — they're local working documents. Do not commit plan changes or the archive move.

## Plan Structure Conventions

Plans in this project follow this structure:
- **Goal** at the top (one-line summary)
- **Current state** (findings/audit of what exists)
- **Decisions** (D1, D2, … table of architectural choices)
- **Workstreams** (numbered, each with sub-items like A1, A2, B1, B2, …)
- **File-by-file checklist** at the end (checkboxes grouped by workstream)
- **Verification steps** (numbered task list for manual QA)
- **Risks & notes**

## Key Code Locations to Check

| Area                     | Where to look                                                  |
|--------------------------|----------------------------------------------------------------|
| DB schema                | `application/server/database/schema.sqlite.ts`, `schema.pg.ts` |
| API endpoints            | `application/server/api/`                                      |
| Shared types             | `application/shared/types.ts`                                  |
| Shared handlers          | `application/shared/handlers/`                                 |
| Frontend types           | `application/types/api.ts`                                     |
| Frontend pages           | `application/app/pages/`                                       |
| Frontend components      | `application/app/components/` (organized by domain subfolder)  |
| Frontend composables     | `application/app/composables/`                                 |
| Settings metadata        | `application/app/utils/settings-metadata.ts`                   |
| Help content             | `application/app/utils/help-content.ts`                        |
| Layout (sidebar, footer) | `application/app/layouts/default.vue`                          |
| Env var registry         | `application/shared/piwi-env-vars.ts`                          |
| Reporter source          | `reporter/src/`                                                |
| Reporter tests           | `reporter/tests/`                                              |
| Demo API mirror          | `application/app/demo/api/`                                    |
| Demo simulator           | `application/app/demo/simulator.ts`                            |
| Demo seed script         | `application/scripts/generate-demo-seed.mjs`                   |
| Unit tests               | `application/tests/unit/`                                      |
| E2E tests                | `application/tests/`                                           |
| CI workflows             | `.github/workflows/`                                           |
| Docs                     | `docs/`                                                        |
| MCP tools                | `application/server/utils/mcp/tools.ts`                        |
| MCP tool defs            | `application/shared/mcp-tools.ts`                              |
