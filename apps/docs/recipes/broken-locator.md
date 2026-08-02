---
title: Fix a broken locator
lang: en-US
---

# A locator broke after a UI change — what should I use instead?

Someone renamed a button, moved a `data-testid`, or wrapped a row in one more `div`, and a handful of
tests now fail on `locator.click: Timeout … waiting for getByRole('button', { name: 'Save' })`. The fix
is rarely hard; finding a replacement that won't break again next sprint is the actual work.

Piwi captures what the element looked like **on the last run where the test passed**, so the
replacement is proposed from a page that worked rather than from the broken one in front of you.

## 1. Open the failing execution's alternative locators

On a failing test case, the **Alternative locators** panel lists candidate replacements ranked by
stability, with one marked as the recommended fix.

<figure>
  <img src="/screenshots/locator-healing.png" alt="Alternative locators panel with ranked replacement locators and a recommended fix">
  <figcaption>Ranked replacements captured from the last passing run — the recommendation favours locators that match the conventions already in your suite.</figcaption>
</figure>

The ranking prefers what Playwright itself prefers — role and test-id over structural CSS — and leans
toward the style your existing specs already use, so the suggestion doesn't drag a second convention
into the codebase.

## 2. Jump to the line and change it

Every source path in the dashboard is clickable, including the failing call stack. Hover the path and
use **open in IDE** to land on the exact line. That mapping is configured
[per browser](../ide-integration) and stored locally — your checkout path is never sent to the server.

No IDE integration set up? The path and line number are plain text on the page; the fastest route is
usually copying them.

## Requirements, honestly

Locator healing needs the [capture fixtures](../capture-fixtures) in your test setup. The reporter alone
uploads results without touching your test code, but it cannot see the DOM — the ranked alternatives
come from [locator snapshots](../concepts#locator-snapshot) the fixtures record while the test runs.

It is one file:

```typescript
// tests/fixtures.ts
import { test as base } from '@playwright/test'
import { extendPiwiFixtures } from '@piwitests/reporter'

export const test = extendPiwiFixtures(base)
export { expect } from '@playwright/test'
```

Import `test` from that file in your specs. A spec that still imports from `@playwright/test` directly
runs and reports fine — it just isn't captured.

Snapshots are only recorded going forward, so the first healing suggestions appear once a passing run
has been captured with the fixtures in place.

## If you can't add the fixtures

Some suites can't take the code change — a vendored test pack, a repo you don't own, a migration you
don't want mid-release. Three routes that don't need it:

**Pick against the live page.** The [browser extension](../extension) scores locators with the same
engine the dashboard uses, directly on the page you're looking at. Picking and recording are fully
standalone — nothing is sent anywhere, and it works without a Piwi instance at all. The cost: it isn't
in the Chrome Web Store yet, so you install an unpacked build.

**Read the failure evidence you already have.** Without fixtures you still get the trace, the
screenshot, and the failing call stack. Playwright's trace viewer is bundled and served by your own
instance — the DOM snapshot at the moment of failure usually shows what the element became.

**Ask your agent.** `get_locator_healing` over the [MCP server](../mcp) returns the recommended fix and
the full alternatives list for a failing case, so a coding agent can apply it without you opening the
dashboard. This one does still depend on captured snapshots — it reads the same data the panel does.

## See also

- [Capture fixtures](../capture-fixtures) — everything else the fixtures unlock
- [Reporter](../reporter#locator-healing) — configuration and how the scoring works
- [Browser extension](../extension) — picking and recording locators against a live page
