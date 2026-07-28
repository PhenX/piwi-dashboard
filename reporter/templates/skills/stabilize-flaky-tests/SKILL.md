---
name: stabilize-flaky-tests
description: Find the flakiest Playwright tests from Piwi's flaky analysis and fix the root cause of the intermittency, ranked by impact. Use when the user asks to "fix flaky tests", "reduce flakiness", "why is this test flaky", or wants to clean up an unreliable suite.
---

# Stabilize flaky tests with Piwi

Piwi scores every test's flakiness over its whole run history and ranks it by impact, so you spend effort on the tests that actually cost the team — not whichever one failed most recently. This skill picks the worst offenders, fixes the *cause* of the intermittency, and confirms the score improves.

## How you reach Piwi

Prefer the **Piwi MCP server** if it is connected (`list_flaky_tests`, `get_test_stability_trend`, `get_test_case`, `get_spec_health`). Otherwise use the dashboard's **Flaky** tab for the project and work from what it shows plus the repo.

## Steps

1. **Rank the flaky tests.** Call `list_flaky_tests` for the project. It returns each test's flaky score, impact ranking, and a **root-cause category**. Take the top few by impact — do not try to fix the whole list at once.

2. **Understand one test's pattern.** For a chosen test, call `get_test_stability_trend` (is it getting worse, or already stable again?) and `get_test_case` (recent pass/fail history). Read a representative failing execution (`get_test_run_case` / `explain_failure`) for the error, steps, console, and network at the moment it flaked.

3. **Identify the cause.** Common categories and their fixes:
   - **Timing / race** — replace fixed waits and manual sleeps with Playwright web-first assertions (`await expect(locator).toBeVisible()`), await the network/UI state the test depends on, not a timeout.
   - **Locator instability** — a selector that resolves ambiguously or intermittently; heal it (see the `apply-locator-healing` skill) or scope it.
   - **Test-order / shared state** — leaking storage, cookies, or a shared backend row; isolate setup, use a fresh context, or a unique fixture per test.
   - **Slow / unreliable endpoint** — check `get_network_requests`; if a real endpoint is intermittently slow or 500s, that is a product bug, not a test bug — report it rather than papering over it with retries.

4. **Fix the root cause.** Make the change in the spec (or the app, when the flake is a real defect). Do **not** "fix" flakiness by adding retries or increasing timeouts — that hides it; the goal is a test that passes deterministically.

5. **Verify.** Re-run the test several times to shake out intermittency: `npx playwright test <file> --repeat-each=5` (raise the count for stubborn ones). It should pass every time. Over the next runs, confirm the flaky score falls in the dashboard (`get_test_stability_trend`).

6. **Report.** For each test you touched: the root-cause category, the change, and the repeat-run result. List any remaining high-impact flaky tests so the user can decide whether to continue.

## Guardrails

- Fix the cause, never the symptom — no blanket `test.retry`, no bumped global timeout, no `waitForTimeout` sprinkles.
- A test that flakes because a *real* endpoint is unreliable is a product finding; surface it instead of hiding it in the test.
- Stabilize a few high-impact tests well rather than lightly touching many. Prove each one with repeated runs before moving on.
