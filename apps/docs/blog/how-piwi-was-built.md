---
title: How Piwi was built
date: 2026-08-17
author: Fabien Ménager
excerpt: 'The parts of Piwi that were actually hard to build: running the whole app in a browser, grouping failures by cause, healing broken locators without taking the test out of your hands, and treating the LLM as a compiler. A technical tour, not a changelog.'
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

Piwi started on SQLite, but I knew from the start it would have to support Postgres too: "self-hosted" had to mean either a single file or a real database, with nothing in between forced on the user. That made an ORM like Drizzle the right choice. I am comfortable with migration systems, but keeping two of them (SQLite and Postgres) in lockstep turned out to be fiddly. The blunt fix arrived in June: I collapsed all twenty-five migrations into a single clean baseline. The lasting fix was smaller, finding the words that finally got the LLM to keep the two dialects in step on every change afterward. A drift test now fails the build if they fall out of step again.

## Grouping forty failures into three causes

When a shared dependency breaks, one bug shows up as forty red tests. Error fingerprinting normalizes each failure into a stable identity, so those forty collapse into the three root causes actually behind them, triaged once instead of forty times. The fingerprint is deterministic first; on top of it sits embedding-based reconciliation for failures that fingerprint slightly differently but are the same bug, with LLM adjudication and a human-in-the-loop merge for the calls it isn't confident about. The hard part is calibration: aggressive enough to be useful, never so aggressive that it merges two genuinely different bugs into one.

## Healing a broken locator, then opening the PR

Every time I hear locator healing described, it is either magical or dumb, and I agree with both objections. I do not want a tool changing my tests without my say, and I do not want one quietly patching a selector so the test rots and drifts from what it was meant to check. So I built it around one rule: the decision to update a locator, or not, belongs to the developer, never to the system.

The mechanism follows from that rule. Like any healing, a locator needs reference data to know what "working" looked like, so Piwi gathers it while the test passes: every successful action and every passing web-first assertion records the element's attributes and a ranked set of alternative locators, stamped with the call site. (That same capture is what led to the browser extension and to the failure-time picker.) When the locator later breaks, Piwi works back from the failure and finds the element again through a ladder of matches: the same call site first, then a renamed-or-moved element, then a locator-signature match, then another test that exercised the same element. It proposes replacements ranked by stability, and two things matter in that ranking. It prefers what Playwright itself prefers, a role or a test id over a structural CSS selector, and it keeps the *style* your suite already uses (`getByRole`, `getByLabel`, and the rest) rather than dropping a raw CSS locator into a codebase that never had one. And it is read-only: it surfaces the suggestion, applying it stays your edit.

The one place Piwi writes is [auto-heal PRs](/auto-heal), and even there the developer stays in charge. The edits are deterministic one-line rewrites taken straight from the captured snapshot (no model-generated code is ever in the write path); Piwi re-reads each file at the branch head and touches only the lines that still match exactly, so a line that has drifted is dropped rather than guessed, and it opens a *draft* you review and merge, or not. `@piwitests/core` was extracted so the reporter, the dashboard, the picker and the extension all score locators with the same logic.

## The browser extension

The capture-while-passing idea has a natural sibling. If the dashboard can score locators, so can a tool that runs on any page, with no test and no run involved. [Piwi Picker](/extension) is a Chrome and Edge extension that picks ranked, stable Playwright locators straight from the page in front of you, scored by that same `@piwitests/core` engine. It is fully standalone: nothing leaves the browser by default, and it works with no Piwi instance at all.

The interesting part is the locator generation. Every candidate is re-checked live against the page as it is right now, and a locator that matches more than one element is ranked below any that resolves to exactly one, so a parent-scoped chain like `getByTestId('product-43').getByRole('button')` beats a bare `getByRole('button')` that hits every card on the page. Parents are anchored on whatever stable hook they actually carry (a test id, an id, a landmark role, or an app-specific `data-*`), framework bookkeeping like `data-v-4f2a1b` is skipped, and an element with no role at all is scoped through its text. It can also record a flow across several pages into a runnable TypeScript spec, and, if you connect it to an instance, collapse those recorded steps into calls to your own page-object functions, matched live as you record.

## AI steps: the LLM as a compiler, not a runtime

The objection to natural-language tests is determinism: a model in the hot path is slow, flaky, non-reproducible, and a network dependency in CI. [AI steps](/ai-steps) avoid all of that by running the model exactly *once*, at authoring time, and even then it only ever *names* an element (its ARIA role and accessible name). A deterministic scorer compiles that name into a committed JSON artifact, and every run afterwards replays the artifact as ordinary Playwright: zero model calls, zero network. Determinism comes from the model never touching the committed bytes; safety comes from the artifact being data that is never evaluated (every action is checked against an allowlist), a drift guard that stops before acting on a renamed element, and a postcondition the agent picks so a subtly wrong flow fails loudly instead of passing green.

## The desktop app

Not everyone wants to run a server. The [desktop app](/desktop) bundles the exact same server that ships as the Docker image inside a [Tauri](https://tauri.app/) shell, in a native window, bound to `127.0.0.1` with its data in a local folder. It is the single-developer path to permanent history, clustering and healing with nothing to deploy.

The part I am happiest with is how the reporter finds it. While the app runs it writes its address and access token to a file in your home directory, and the reporter reads that file *only* when your config and environment set no server URL and no API key, so a project already pointed at a shared dashboard, or a CI job with a key set, is never silently redirected to your laptop. Beyond that it re-runs your failed tests locally with its own bundled Node, imports a Playwright blob report or trace dropped onto the window, and wires up an MCP client (Claude Code, Cursor, and the rest) in one click. The installers are unsigned for now, and built for Windows and Apple-silicon macOS only; on Linux or an Intel Mac, the Docker image or `npx` is the way in.

## A few more, in brief

Not every hard part earns its own chapter:

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
