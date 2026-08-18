---
title: 'Piwi in four parts: the demo, the desktop app, auto-heal PRs, and AI steps'
date: 2026-08-18
author: Fabien Ménager
excerpt: A closer look at four parts of Piwi that solve their problem in a way the feature list doesn't show — the in-browser demo, the local-only desktop app, auto-heal pull requests, and AI steps.
sidebar: false
---

# Piwi in four parts: the demo, the desktop app, auto-heal PRs, and AI steps

Piwi keeps every Playwright run instead of letting the HTML report die with the CI artifact, then groups the failures by root cause, scores the flaky tests, and points at the locator you should have used. That is the one-paragraph version.

This post goes one level down, into four parts of the project worth a closer look — not the biggest features, but the ones that solve their problem in a way you can't see from a bullet list. Each has its own documentation page; this is the reasoning behind them.

## How Piwi started

<!--
  TODO (Fabien): expand this section from the original build session.
  The Claude Code session that kicked the project off is here:
  https://claude.ai/code/session_01WyRiNoDwToyBMpfhcyyfgr
  I couldn't read it automatically (the session is private), so drop the
  highlights in yourself: the very first prompt, the initial scope, and the
  early decisions that shaped everything after. Delete this comment when done.
-->

Piwi began as a tool for my own team. Every Playwright HTML report we produced lived and died as a CI artifact: a test failed on Tuesday, the report was gone by Thursday, and "has this been flaky before?" had no answer at all. The first version did exactly one thing — keep the runs. Everything below grew out of that single decision.

_(The full origin story — how the first prototype came together — goes here.)_

## 1. The demo is the real app, with a service worker for a backend

The [live demo](https://piwitests.github.io/demo/) has no install, no signup, and no backend you connect to. Open the link and a full dashboard is running, streaming a test run in test by test, clustering its failures, scoring its flakes. The obvious assumption is that it's a recording or a mockup. It isn't.

It's the real application, unchanged. The only thing swapped out is the transport: a **service worker** hosts an in-browser copy of the API, and the app's HTTP calls are rewritten into that worker's scope — the same request path a real reporter's calls take through a real server. A small simulator then replays the exact wire protocol a Piwi reporter speaks during a live run — `setup → begin → events → finish` — against that in-browser API, so what you watch is a genuine run arriving over the genuine ingestion path, across parallel workers, with retries and performance data, on a seeded `e2e-checkout` project.

The reason to build it this way is drift. A hand-built product tour is a second implementation of the UI that rots the moment the real one changes. Because the demo _is_ the product with only its backend relocated into the browser, it can't fall out of step with what you'd actually run.

::: tip What the demo is not
It's seeded data in a single browser tab: it resets on reload and nothing you do there is saved. It's there to look around, not to store your results — for that you run the [Docker image](/deployment) or the desktop app below.
:::

## 2. The desktop app runs the whole dashboard, local-only

The [desktop app](/desktop) is not a thin client that talks to a server somewhere. It bundles the **same server that ships as the Docker image**, wraps it in a native window, and keeps your data in a local folder — SQLite plus a storage directory for reports and traces. Everything binds to `127.0.0.1`; nothing is exposed to the network. It's the single-developer path to permanent history, flaky scoring, clustering, and locator healing without standing up a server.

Three parts of it are more considered than they look:

- **Zero-config discovery.** While the app runs, it publishes its address and access token to a file in your home directory. The reporter reads that file **only** when your config and environment set no `serverUrl` and no `apiKey` — so a project already pointed at a shared dashboard, or a CI job with `PIWI_API_KEY` set, is never silently redirected to your laptop. The convenient default can't override an explicit one.
- **Run locally.** A failing run is one click from a retry. **Run locally** re-runs the failed tests on your machine using your project's _own_ Playwright and the app's bundled Node — nothing extra to install — and the results stream straight back into the same dashboard through that discovery file, exactly as if you'd run them from the terminal.
- **It does the MCP wiring.** The app detects installed assistants — Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Gemini CLI — and connects each to its [MCP server](/mcp) with one click, writing a single entry into the client's own config and keeping a backup. Claude Desktop, which only accepts command-started servers, is pointed at a built-in stdio bridge instead, so no token is ever written into its config.

::: warning Honest limits
The installers are **unsigned** until code-signing certificates are in place, so the first launch needs a click-through, and they're built for Windows and Apple-silicon macOS only — on Linux or an Intel Mac, use [Docker or `npx`](/deployment). Accepting results from _other machines_ is deliberately not supported in the desktop build; that's what the server deployment is for.
:::

## 3. Auto-heal PRs: the dashboard opens the fix, carefully

Locator healing records an element's attributes on passing runs, so when a selector breaks later it can rank replacements that actually existed on the page. [Auto-heal PRs](/auto-heal) take the next step: when a locator breaks on your default branch and the evidence is strong enough, Piwi opens the fix as a pull request itself — a branch, a one-line locator edit per broken call site, and a body showing the change, the score, where the replacement came from, and the command that verifies it.

Writing to your repository is the strongest thing the dashboard does, so almost all of the work here is restraint:

- It's **off by default**, and even once enabled it acts only on projects you explicitly list.
- It triggers **only on a full run on the default branch** — never a feature branch, and never a run reported from a heal branch, which would let it feed on itself.
- The edits are **deterministic one-line rewrites** taken from a passing run's captured snapshot. No model-generated code is ever in the write path.
- Each edit must clear a configurable **stability score** (default 80) or be a locator you confirmed yourself in the picker.
- Before committing, Piwi **re-reads each file at the branch head** and writes only the lines it can still match exactly. A line that has drifted is dropped, not guessed.

This is also my answer to the sharpest question the project has been asked — that a silently "healed" locator can paper over a real UI regression that a test _should_ have failed on, loudly. It still fails loudly: the CI gate runs on the auto-heal PR like any other, so the failure is surfaced, not suppressed. What Piwi adds next to that red build is a **draft PR you review** — you decide whether the UI change was intended (merge the locator fix) or a genuine regression (close it, fix the app). The dashboard never merges anything.

## 4. AI steps: the LLM is a compiler, not a runtime

[AI steps](/ai-steps) let you locate elements and drive flows in plain English:

```typescript
await page.piwiLocator('the email address field').fill('ada@example.com')
await page.piwiRun('sign in as {email}', { email: 'ada@example.com' })
```

The usual objection to natural-language tests is that they trade determinism for convenience — a model in the hot path means slow, flaky, non-reproducible runs, and a network dependency in CI. AI steps are built around avoiding exactly that, and the whole design follows from one line: **the LLM is a compiler, not a runtime.**

The first time a prompt is seen, an agent resolves it **once** into a committed JSON artifact that lives next to your spec in git. Every run after that _replays_ that artifact with ordinary Playwright calls — zero model calls and zero network in the default `replay` mode. Your CI stays fast, offline, and reproducible; the model is only ever involved while authoring, on your machine, against a disposable environment.

What makes the replay trustworthy is that the artifact is **data, never code**:

- **Deterministic bytes.** The model only ever _names_ an element — its ARIA role and accessible name. A separate, non-AI scorer turns that name into the committed locator, so model sampling never changes the file: two runs that reach the same conclusion produce byte-identical JSON.
- **No evaluation.** Every locator method and action is checked against an allowlist before it touches the page, so a malformed or tampered artifact can never become arbitrary execution.
- **A drift guard and a postcondition oracle.** Each step records what the element was at author time; on replay, if the page shows it has been renamed, the flow stops before acting rather than clicking the wrong thing. And every flow ends with an assertion the agent chose, so a subtly wrong flow fails loudly instead of passing green.

Parameter values are masked out of everything sent to the model, and `piwi ai check` runs offline as a CI lint to catch a prompt that was deleted, renamed, or that collides with another. Replay being plain Playwright, there is nothing extra to install or run in CI — you commit the artifacts and your existing test job replays them.

## Where to look next

- **Try it:** the [browser demo](https://piwitests.github.io/demo/) — seeded data, no signup.
- **Read the docs:** [desktop app](/desktop), [auto-heal PRs](/auto-heal), [AI steps](/ai-steps), and the [reporter](/reporter).
- **Read the code:** [github.com/PiwiTests/platform](https://github.com/PiwiTests/platform) — MIT, self-hosted, zero telemetry.

Piwi is pre-1.0 and moves quickly; if your team's broken-locator or flaky-test workflow does something this doesn't, that's the feedback I most want to hear.
