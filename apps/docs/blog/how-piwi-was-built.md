---
title: How Piwi was built
date: 2026-08-17
author: Fabien Ménager
excerpt: 'The parts of Piwi that were actually hard to build: running the whole app in a browser, grouping failures by cause, healing broken locators, and treating the LLM as a compiler. A short technical tour, not a changelog.'
sidebar: false
---

# How Piwi was built

Piwi keeps every Playwright run instead of letting the HTML report die with the CI artifact. It then groups the failures by cause, scores the flaky tests, and points at the locator you should have used instead. It started as one loop (run the tests, the reporter uploads the results, the dashboard keeps them), built in a day on a Nuxt template one Sunday in December 2025. That loop never changed; what changed over the next eight months was the ambition stacked on top of it, from *storing* results to *explaining* the failures to *handing back a fix*.

## Why I built it

The idea of building my own Playwright dashboard had been running in my head for years, from before I found [CyborgTests](https://www.cyborgtest.com/). When I started, CyborgTests was essentially an aggregator for HTML reports and traces, and our trace files were enormous, because our tests were genuinely broken. It got slower and slower under them. That, plus a conviction that a dashboard like this could do a great deal more, was enough to push me to start my own. CyborgTests has moved on a lot since, but by then I was already far enough into Piwi to keep going.

There are commercial products in this space. I did not want to depend on a third party, and I took it as a personal challenge, so I built Piwi in my free time. I knew it would help at work, but that is not really why: I like building tools, for my team and for the community, which is most of what my [GitHub](https://github.com/PhenX) is. One thing led to another, and Piwi grew well past a dashboard, into a reporter, an MCP server, a desktop app, a diagnosis tool for humans and for AI assistants, a quality advisor.

This post skips the chronology and picks out the parts that were actually hard to build.

## Running the whole application in a browser

A dashboard needs a server and a database. A demo that needs a backend is a demo almost nobody tries, so the [live demo](https://piwitests.github.io/demo/) has neither. The backend was moved *into the browser*: SQLite compiled to WebAssembly behind a Drizzle proxy, persisted to the browser's own OPFS storage, with a service worker intercepting the application's real HTTP calls. The same frontend code runs unmodified, and a small simulator replays the exact wire protocol a reporter speaks during a live run (`setup → begin → events → finish`) into that in-browser API.

The payoff is that the demo can't drift from the product, because it *is* the product with only its backend relocated. The cost is that every feature built afterwards had to work with no server, which shows up in a long tail of "make this real in the demo too" work.

The decision to do this came very early, and from earlier experiments. I had built browser playgrounds for EF Core and FluentMigrator on Blazor WebAssembly, and running a real SQLite or PostgreSQL database inside the browser, driven by a C# app compiled to WASM, felt like magic. Doing the same for a Node app looked easy by comparison.

It imposes a discipline. An LLM tends to forget that the demo has to move with every feature change, even when the project's own instructions say so, so I still remind it by hand (not everything can be reused untouched, of course). I think it is worth it. A working app you can open with a few honest compromises, no reporter and no real authentication, which is why the top bar carries a profile chooser and some simulation, is exactly what I miss on most products I would like to try. I am lazy: I want to click a link and form my own opinion, not sign up first.

## One product, two databases

"Self-hosted" had to mean either a single file or a real database, with nothing in between forced on the user. So from May the schema is maintained twice, SQLite and Postgres, with two migration folders and a wire-contract test that fails the build if the two dialects drift apart. The blunt version of that maintenance arrived in June: twenty-five accumulated migrations collapsed into one clean baseline in a single commit, titled *"Reset all migrations, from scratch."*

<!-- STORY 3: THE DUAL-DB TAX (optional).
     Was maintaining two databases worth it in hindsight? And the migration
     reset, nerve-wracking or an obvious clearing of the decks? See question 3. -->

## Grouping forty failures into three causes

When a shared dependency breaks, one bug shows up as forty red tests. Error fingerprinting normalizes each failure into a stable identity, so those forty collapse into the three root causes actually behind them, triaged once instead of forty times. The fingerprint is deterministic first; on top of it sits embedding-based reconciliation for failures that fingerprint slightly differently but are the same bug, with LLM adjudication and a human-in-the-loop merge for the calls it isn't confident about. The hard part is calibration: aggressive enough to be useful, never so aggressive that it merges two genuinely different bugs into one.

## Healing a broken locator, then opening the PR

Locator healing captures an element's attributes on *passing* runs, so when the selector breaks later there is a record of what the element used to be, and replacements can be ranked from it. The genuinely hard part isn't the ranking. It's doing this safely enough to write to your repository. [Auto-heal PRs](/auto-heal) use deterministic one-line edits taken straight from the captured snapshot (no model-generated code is ever in the write path); they re-read each file at the branch head and touch only the lines that still match exactly, so a line that has drifted is dropped rather than guessed, and they open a *draft* the human reviews. `@piwitests/core` was extracted specifically so the reporter and the dashboard score locators with byte-identical logic.

<!-- STORY 4: THE HEALING PUSHBACK.
     This is the feature people challenge: "a healed locator can quietly hide
     a real UI regression." Your answer, in your own words, is the best part
     of this section. See question 4. -->

## AI steps: the LLM as a compiler, not a runtime

The objection to natural-language tests is determinism: a model in the hot path is slow, flaky, non-reproducible, and a network dependency in CI. [AI steps](/ai-steps) avoid all of that by running the model exactly *once*, at authoring time, and even then it only ever *names* an element (its ARIA role and accessible name). A deterministic scorer compiles that name into a committed JSON artifact, and every run afterwards replays the artifact as ordinary Playwright: zero model calls, zero network. Determinism comes from the model never touching the committed bytes; safety comes from the artifact being data that is never evaluated (every action is checked against an allowlist), a drift guard that stops before acting on a renamed element, and a postcondition the agent picks so a subtly wrong flow fails loudly instead of passing green.

## A few more, in brief

Not every hard part earns its own chapter:

- **The desktop app** bundles the whole server in a Tauri shell bound to loopback, and publishes a discovery file the reporter reads *only* when nothing else is configured, so it runs zero-config on your machine without ever hijacking a CI job or a project already pointed at a shared dashboard.
- **Live streaming** replaced polling with SSE through a single global stream the day it shipped: runs appear test by test while CI is still executing, and a run is marked `interrupted` after an hour of silence.
- **The evidence pipeline** rebuilds a failure from stored trace blobs (a sanitized DOM snapshot, a visual diff against the last passing screenshot, web-vitals tiles, a multi-frame call stack with real source), so the diagnosis has something concrete to reason about.
- **A wire-contract drift guard** in the test suite fails the build if the reporter and the server ever disagree on the shape of what passes between them.

## Three assistants, three eras

The other unusual thing about this history is who wrote it, and one part of that isn't visible in the commits. GitHub Copilot's agent built the December skeleton. The spring *looks* hand-driven, because those commits are under my name, but it wasn't: that was a more surgical phase, smaller and more focused changes made with DeepSeek V4 Flash, which impressed me enough with its speed, and its judgment *at* that speed, that I kept reaching for it. Then Claude wrote most of the code from late June on. Three different assistants across one year; I was the architect throughout, and the design decisions, the scope cuts and the reviews stayed constant while the tool underneath changed.

<!-- STORY 5: AGENT-ASSISTED DEVELOPMENT (the big one).
     Your honest take on building this way, across three assistants:
     Copilot (wholesale), then DeepSeek V4 Flash (surgical, committed under
     your name), then Claude. What each was good at, where they failed, what
     you refuse to hand off. This is also the strongest reply to the "AI slop"
     reaction. Sub-question: if the commit-count breakdown goes in, note that
     the commits "under my name" include the DeepSeek-assisted spring, so they
     aren't really solo. How do you want that framed? See question 5. -->

## Where it is now

Eight months in, the mission fits in three ranked sentences: keep the history, explain the failures, hand back a fix, with the rule that a feature serving none of them is an argument against building it. That clarity was earned, not designed up front. Piwi is at v0.25 and still pre-1.0; the most recent step, [auto-heal PRs](/auto-heal), is the most literal form yet of that third sentence.

<!-- STORY 6: CLOSING OPINION (optional).
     One thing you learned, or one thing you'd tell someone starting a similar
     project. See question 6. -->

---

The quickest way to see all of this at once is the [demo](https://piwitests.github.io/demo/), which runs entirely in your browser with no signup. The code is [on GitHub](https://github.com/PiwiTests/platform), MIT.
