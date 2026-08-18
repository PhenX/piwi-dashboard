---
title: How Piwi was built
date: 2026-08-17
author: Fabien Ménager
excerpt: The parts of Piwi that were actually hard to build — running the whole app in a browser, grouping failures by cause, healing broken locators, and treating the LLM as a compiler. A short technical tour, not a changelog.
sidebar: false
---

# How Piwi was built

Piwi started as one loop — run the tests, the reporter uploads the results, the dashboard keeps them — built in a day on a Nuxt template, one Sunday in December 2025. That loop never changed. What changed over the next eight months was the ambition stacked on top of it: from *storing* Playwright results, to *explaining* the failures, to *handing back a fix*.

<!-- ✍️ STORY 1 — WHY YOU STARTED IT.
     One honest paragraph on the itch. Was there a specific moment — a flaky
     test that burned an afternoon, a report you needed that CI had already
     deleted? See question 1 in the chat. -->

This post skips the chronology and picks out the parts that were actually hard to build.

## Running the whole application in a browser

A dashboard needs a server and a database. A demo that needs a backend is a demo almost nobody tries — so the [live demo](https://piwitests.github.io/demo/) has neither. The backend was moved *into the browser*: SQLite compiled to WebAssembly behind a Drizzle proxy, persisted to the browser's own OPFS storage, with a service worker intercepting the application's real HTTP calls. The same frontend code runs unmodified, and a small simulator replays the exact wire protocol a reporter speaks during a live run — `setup → begin → events → finish` — into that in-browser API.

The payoff is that the demo can't drift from the product, because it *is* the product with only its backend relocated. The cost is that every feature built afterwards had to be made to work with no server — which shows up in a long tail of "make this real in the demo too" work.

<!-- ✍️ STORY 2 — THE DEMO DECISION.
     What pushed you to make the demo the *real app* rather than a recorded
     mockup? Was it obviously worth it, or a gamble? See question 2. -->

## One product, two databases

"Self-hosted" had to mean either a single file or a real database, with nothing in between forced on the user. So from May the schema is maintained twice — SQLite and Postgres — with two migration folders, and a wire-contract test that fails the build if the two dialects drift apart. The blunt version of that maintenance arrived in June: twenty-five accumulated migrations collapsed into one clean baseline in a single commit, titled *"Reset all migrations, from scratch."*

<!-- ✍️ STORY 3 — THE DUAL-DB TAX (optional).
     Was maintaining two databases worth it in hindsight? And the migration
     reset — nerve-wracking, or an obvious clearing of the decks? See question 3. -->

## Grouping forty failures into three causes

When a shared dependency breaks, one bug shows up as forty red tests. Error fingerprinting normalizes each failure into a stable identity so those forty collapse into the three root causes actually behind them — triaged once, not forty times. The fingerprint is deterministic first; on top of it sits embedding-based reconciliation for failures that fingerprint slightly differently but are the same bug, with LLM adjudication and a human-in-the-loop merge for the calls it isn't confident about. The hard part is calibration: aggressive enough to be useful, never so aggressive that it merges two genuinely different bugs into one.

## Healing a broken locator — then opening the PR

Locator healing captures an element's attributes on *passing* runs, so when the selector breaks later there is a record of what the element used to be, and replacements can be ranked from it. The genuinely hard part isn't the ranking — it's doing this safely enough to write to your repository. [Auto-heal PRs](/auto-heal) use deterministic one-line edits taken straight from the captured snapshot (no model-generated code is ever in the write path), re-read each file at the branch head and touch only the lines that still match exactly — a line that has drifted is dropped, not guessed — and open a *draft* the human reviews. `@piwitests/core` was extracted specifically so the reporter and the dashboard score locators with byte-identical logic.

<!-- ✍️ STORY 4 — THE HEALING PUSHBACK.
     This is the feature people challenge: "a healed locator can quietly hide
     a real UI regression." Your answer, in your own words, is the best part
     of this section. See question 4. -->

## AI steps: the LLM as a compiler, not a runtime

The objection to natural-language tests is determinism: a model in the hot path is slow, flaky, non-reproducible, and a network dependency in CI. [AI steps](/ai-steps) avoid all of that by running the model exactly *once*, at authoring time — and even then it only ever *names* an element (its ARIA role and accessible name). A deterministic scorer compiles that name into a committed JSON artifact, and every run afterwards replays the artifact as ordinary Playwright: zero model calls, zero network. Determinism comes from the model never touching the committed bytes; safety comes from the artifact being data that is never evaluated (every action is checked against an allowlist), a drift guard that stops before acting on a renamed element, and a postcondition the agent picks so a subtly wrong flow fails loudly instead of passing green.

## Three assistants, three eras

The other unusual thing about this history is who wrote it — and one part of that isn't visible in the commits. GitHub Copilot's agent built the December skeleton. The spring *looks* hand-driven, because those commits are under my name, but it wasn't: that was a more surgical phase — smaller, focused changes made with DeepSeek V4 Flash, which impressed me enough with its speed, and its judgement *at* that speed, that I kept reaching for it. Then Claude wrote most of the code from late June on. Three different assistants across one year; I was the architect throughout, and the design decisions, the scope cuts and the reviews stayed constant while the tool underneath changed.

<!-- ✍️ STORY 5 — AGENT-ASSISTED DEVELOPMENT (the big one).
     Your honest take on building this way, across three assistants:
     Copilot (wholesale) → DeepSeek V4 Flash (surgical, committed under your
     name) → Claude. What each was good at, where they failed, what you refuse
     to hand off. This is also the strongest reply to the "AI slop" reaction.
     Sub-question: if the commit-count breakdown goes in, note that the commits
     "under my name" include the DeepSeek-assisted spring — so they aren't
     really solo. How do you want that framed? See question 5. -->

## Where it is now

Eight months, and the mission fits in three ranked sentences: keep the history, explain the failures, hand back a fix — with the rule that a feature serving none of them is an argument against building it. That clarity was earned, not designed up front. Piwi is at v0.25 and still pre-1.0; the most recent step, [auto-heal PRs](/auto-heal), is the most literal form yet of that third sentence.

<!-- ✍️ STORY 6 — CLOSING OPINION (optional).
     One thing you learned, or one thing you'd tell someone starting a similar
     project. See question 6. -->
