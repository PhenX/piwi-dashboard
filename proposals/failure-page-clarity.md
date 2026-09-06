# Legible failure pages — a clarity plan

**Status:** proposal — nothing started · **Scope:** the execution page (`/test-run-cases/:id`), the failure cluster page (`/failure-clusters/:id`), the blocks they share, and the small server changes those blocks need · **Date:** 2026-09-06 · **Builds on:** [`ui-simplification.md`](ui-simplification.md) and [`failure-experience-audit.md`](failure-experience-audit.md)

The UI simplification gave both pages one column and one reading order: header → headline → clues → evidence → fix → history. It removed the folded cards, the right column and the jump chips, and it halved the height to the first screenshot. It did not make the pages *legible*. A developer who lands on either page still meets two or three boxes of equal weight before any explanation, three competing explanations of the same failure, a "Fix" card that is a menu rather than an instruction, and — on the cluster page — four status signals that contradict each other. The data is all there; the page still does not say what is wrong or what to do next.

This plan is about the top of both pages and about the one decision the page should make for the reader. Every finding marked **(seen)** was observed on a seeded instance (`npm run app:seed:dev`, Chromium, 2026-09-06, `v0.26.1`) at 1280 × 800 (the first screen), in 3 400 px captures (the whole page), at 390 px, and on every evidence tab, popover and disclosure of executions #37, #13, #587, #682 and clusters #10, #2, #5, #1, #8. The numbers in §1.5 come from a DOM measurement script run against the same pages (Appendix C).

---

## 0. The idea in one paragraph

The top of each page answers three questions in three lines, in one block: **what broke** (the headline), **what is going on** (since when, on which commit, in how many tests, who owns it, whether anyone is on it — one sentence), and **what to do now** (one action, chosen by a policy, with one line saying why). Below that block the page shows **one** explanation — a story that chains the clues and the diagnosis instead of listing them three times — then the evidence opening on the story, then a folded toolbox of every other way to fix, verify or reproduce. A cluster's state is one sentence with one verb (*still failing*, *fixed and verified*, *regressed*, *resolved*) and one control, not a segmented button, a badge, a sentence, a reconcile button and a snooze menu. Identity is said once: the breadcrumb already names the test, so the page's biggest line is the failure, not the title.

---

## 1. What was seen

### 1.1 The execution page (`/test-run-cases/37`, failing; #13, #587, #682) **(seen)**

1. **Two tops of equal weight.** The header card (status chip, title, `@fixme`, *Copy retry command*, a facts line, *Details*) and the headline card (the red sentence, the detail line, *The one clue*, a fact row, *Show raw error*) are two boxes of the same size stacked 16 px apart. The eye lands on the bold title in the header, then on the bigger red sentence below it; neither is subordinate to the other. The title is also the last crumb of the breadcrumb, 70 px above — it is on screen twice before the failure is stated once (`app/components/shared/DetailHeader.vue:36`, `app/pages/test-run-cases/[id].vue:588-784`).
2. **The facts are split across four places** — the header facts line (path, browser, duration, branch and commit, build, age), the headline fact row (*New regression*, *First failure in this run*, commit and author, *Same failure in 1 other test in this run (Open)*, owner), the *Details* popover (environment, CI provider and job, versions, worker, steps, slowest step, wasted time, locks, tags, links) and the History card's streak sentence at the bottom (*Failing for 1 consecutive run. Last passed in run #3*). The commit appears in the header and in the fact row. The reader assembles the story from four rows; the page never writes the sentence.
3. **Three tenses of the same fact.** *New regression* (badge), *First failure in this run* (chip), *Failing since run #4 (1 day ago)* (chip, on #13) and the History streak sentence all say when the failure started, in four wordings (`TestCaseHeadlineCard.vue:150-205`).
4. **The headline's explanation is styled as the truth and can be wrong.** On #37 and #13 *The one clue* is *The page structure changed near the failing locator — the button was renamed from "Pay" to "Pay now"*. The error itself says `locator resolved to <button disabled …>Pay now</button>` and `element is not enabled`: the locator resolved, so the rename cannot be the cause. The real story is spread over the *Other clues (4)* card underneath — *Strong: the element is present but disabled*, *Medium, t−1.5 s: console warning "price quote still pending after 20s — Pay stays disabled"*, *Medium, t−3.4 s: POST /api/checkout/quote was still in flight (28.4 s)* — and over the AI diagnosis in the Fix card, which says something different again (*the payment form renders slowly on CI and the click races the render*). One failure, three explanations, the wrong one on top. The ranking is by strength first, and `page-structure-changed` is emitted **strong** whether or not the locator resolved (`shared/failure-clues.ts:473`, ranking at `:719`).
5. **"The one clue" is a label nobody asked for.** The top clue's strength is not shown (the badge says *The one clue* in the strength's color, which nobody decodes); the card below is titled *Other clues (4)* with a help hint; the word *clue* appears three times on the first screen and means nothing to a first-time visitor (`TestCaseHeadlineCard.vue:126`, `CluesCard.vue`).
6. **The default evidence tab follows the top clue, so a weak or wrong clue chooses what the reader sees first.** #37 opens on *Screen* because the rename clue cites the page diff; the Screen tab starts with a broken screenshot thumbnail on the dev seed, a video player, a trace row, the visual diff, the ARIA snapshot and a raw DOM dump — 1 500 px of it. The *Timeline* tab, which is the best "what happened" view on the page (steps, requests and the console line interleaved around the failed step, the timeout inline), is never the default when any clue exists (`EvidenceTabs.vue:155-162`).
7. **The Fix card is a menu, not an instruction.** On the execution page it reads, top to bottom: FIX PLAN (two badges and *Open fix plan →*), DIAGNOSIS (one sentence and *Open →*), REPRODUCE (a twelve-line shell recipe with an OS toggle, then FIND THE BREAKING COMMIT with a three-line bisect script and a paragraph) — about 1 000 px, of which 700 px is a generic recipe that is identical on every execution. The concrete fix is never on this page: both links go to the cluster. On #682 (no diagnosis) the FIX PLAN section says *Assembled on the cluster page. Open fix plan →* — a pointer to nothing (`[id].vue:808-930`, `app/components/shared/FixCard.vue:26-34`, `ReproduceSection.vue:170,215`).
8. **The primary action is always *Copy retry command***, whatever the state. On #37 a validated patch exists for the cluster; on #587 a ranked locator replacement exists; on #682 nothing is known. The header offers the same button to all three (`[id].vue:600-611`).
9. **Chrome.** Eight help hints on the page (three above the fold), 38 interactive controls above the fold, four levels of headings (card title → uppercase section label → sub-block title → tab label), 2 125 px of open code blocks (ARIA YAML, the DOM dump, the recipe, the bisect) on a 3 600 px page (§1.5).

### 1.2 The failure cluster page (`/failure-clusters/10`, fix verified; #2, #5, #1, #8) **(seen)**

1. **Four status signals, six controls, no sentence.** Under the facts line: *Triage ⓘ [Open][Resolved][Ignored] ✎ · Fix verified · Fix verified in run #62 — open 1 day 2 hours · commit demo010 ⓘ · [Mark resolved]*, then *Snooze ▾* on a second row. *Open* is highlighted in orange next to a green *Fix verified*; the facts line says *last seen run #63 (about 9 hours ago)*. Is this cluster failing right now? Was it fixed? Should the reader do anything? The screen shows the atoms and lets the reader reconcile them (`app/components/cluster/TriageControl.vue:24-31,115-121,227-286`, `[id].vue:553`).
2. **The cluster is named twice in a row.** The H1 is the deterministic name (*toHaveCount mismatch on getByRole('row') in users.spec.ts*); 150 px below, the headline card says the same thing with numbers (*Expected 26 rows, found 51 — getByRole('row') toHaveCount*). The AI title — *Users table renders 50 rows instead of 25 — server-driven pagination shipped with the API default page size*, the best sentence on the page — is at 1 300 px inside the diagnosis (`[id].vue:432,559`, `DiagnosisResult.vue`).
3. **The one clue is irrelevant on three of five clusters.** #10: *The environment changed since the last pass — Playwright version, Color scheme* for a 26-vs-51 row count whose diagnosed cause (a `PAGE_SIZE` constant) sits 1 100 px lower with a patch that applies cleanly. #5: the same environment clue for a `.modal.is-open` timeout. #8: a 4 s image request "still in flight" for a page-closed crash. `environment-changed` is emitted **medium** whenever the diff has an entry other than the environment label, so a Playwright version bump is presented as the most likely cause of an assertion on content (`shared/failure-clues.ts:667`). Because the default evidence tab follows that clue, #10 and #5 open their evidence on **State** — URL, `localStorage` key names, cookie flags — the least useful view for either failure.
4. **Two loose rows between the cards.** *› Show raw error* and *from: Users table paginates 25 rows per page · run #63 · Open execution →* float as bare text between the headline card and the Evidence card. The second is the selector of the execution whose evidence is shown; it is separated from the card it controls, and from the *Affected tests* list at the bottom that lists the same tests again (`[id].vue:575-622,743`).
5. **The diagnosis is the page's most valuable block and it is at 1 183 px**, under the Fix card's DIAGNOSIS label, as a 900 px result: confidence ring, four badges and a help hint, title, paragraph, three evidence bullets with citation chips, *Suggested fix*, the patch with three icon buttons, *Other hypotheses*, *To confirm this diagnosis*, *Prevention tips*, thumbs, a token line. Directly under it: *AI is not configured ⓘ · Configure · Copy prompt* and *Query this cluster from your AI agent via the MCP server* — printed under a completed diagnosis because the line renders whenever no provider is configured (`DiagnosisPanel.vue:606-627`).
6. **The toolbox runs on for 2 000 px.** After the diagnosis: VERIFY (the command, a two-line paragraph), REPRODUCE (the same 700 px recipe and bisect as the execution page), FIX PLAN (*Copy as Markdown* and a sentence about MCP), then *What changed* (a baseline picker and *Unsupported SCM host* in red), *Affected tests (1)*, *History* (the facts line again plus *Diagnosed 3 times*). On #2 the Locator fix section alone is 1 100 px: the failing locator, a warning paragraph, the recommended diff, three alternatives with *Show all 4*, and eight *From the failing page* candidates (`LocatorHealingPanel.vue:633-670`). The `History` card has no occurrence sparkline — the UI plan promised one (§5.2 there) and the card ships as text (`ClusterHistory.vue`).
7. **No state colour on the title line.** `DetailHeader` omits the status chip for a cluster, so the only chip is the error type (*assertion*, *timeout*, *crash*, *unknown*) — a taxonomy word, not a state. #1 shows `unknown` as its first badge.
8. **"first seen run #70 (3 days ago) · last seen run #63 (about 9 hours ago)"** — run numbers running backwards against time is a seed artifact, but the design offers nothing that would survive it: *8 occurrences over 3 days, last 9 hours ago* is what the reader wants and it is never said.

### 1.3 Both pages

- **Help hints as decoration.** 8 on #37, 13 on #10, 15 on #1. Every card has one, the Fix card has two (*Fix*, *Reproduce*), the diagnosis result three more. Three or four sit above the fold, one of them on the headline itself.
- **Headings at four depths.** Card title (*Evidence*), uppercase section label (*DIAGNOSIS*), sub-block title (*Network requests (4)*), tab label (*Network 4*) — the last two say the same thing 40 px apart in every tab.
- **Code by default.** Two of the four open code blocks on #37 (the ARIA YAML and the DOM snapshot's escaped HTML and CSS) are never what a human reads first; the DOM dump is useful only through the locator picker, which renders it properly.
- **Contradictions on one screen.** *AI is not configured* under an AI diagnosis; *Open* next to *Fix verified*; *The environment is identical to the last passing run* (State tab, #37) two tabs away from a clue that the page structure changed; *This failure was fixed before and has come back* listed as a *Weak* clue although it is a fact about the cluster, not a hint about the cause (`shared/failure-clues.ts:707`).
- **At 390 px** the header is a full screen on its own (title, marks, path, browser, duration, branch, build, age, *Details*), the headline card is another, the cluster's triage row wraps into five lines, and the evidence tab strip into three.
- **The inbox and the run page already do the top better.** A Home inbox row is title / one-line explanation / project · owner · tests · age with two badges; a run-page cluster group is name · tests · status · *Open cluster →*. The detail pages should read as the zoomed-in version of that row; today they read as a different product.

### 1.4 Where the analysis misleads the top block

Three rules in `buildFailureClues` (`shared/failure-clues.ts`) decide what the first screen says, and each has a gap:

| Rule | Today | Gap |
|---|---|---|
| `page-structure-changed` (`:473`) | strong whenever the page diff shows the failing locator's node renamed or removed | a rename cannot explain a failure whose call log says the locator *resolved*; on #37 it outranks *element-present-but-blocked*, which is also strong, by declaration order |
| `environment-changed` (`:667`) | medium unless the only entry is the environment label | a Playwright or browser version bump is the top clue on any assertion that has no other clue (#10, #5) |
| `fixed-before` (`:707`) | a weak clue | it is a fact about the cluster (the earlier fix did not hold), belongs in the situation, and pads *Other clues (N)* |
| ranking (`:719`) | strength → proximity → rule order | ties among strong clues fall to declaration order; nothing relates clues to each other, so a request, a console line and a disabled element that together *are* the diagnosis render as three unrelated cards |

### 1.5 In numbers

Measured at 1280 × 800 with the script in Appendix C, default state, dev seed. *px to X* is the distance from the top of the panel to the top of block X.

| Measure | #37 (execution) | #10 (cluster) | #2 (cluster, locator) | Target |
|---|---|---|---|---|
| Blocks before the first evidence view | 3 (header, headline, other clues) | 5 (header, headline, raw-error row, from-row, evidence header) | 5 | 2 (situation, why) |
| Interactive controls above the fold | 38 | 51 | 49 | ≤ 15 |
| Help hints on the page / above the fold | 8 / 3 | 13 / 4 | 9 / 3 | ≤ 4 / ≤ 1 |
| px to the first evidence view | 999 | 551 | 724 | ≤ 700 |
| px to the concrete fix (patch or locator edit) | not on the page | ≈ 1 800 | ≈ 2 000 | on the first screen |
| Open code blocks (px) | 2 125 | 692 | 548 | ≤ 250 |
| Words rendered by default | 701 | 776 | 873 | ≤ 400 |
| Explanations of the same failure on screen | 3 | 3 | 2 | 1 |
| Cluster state signals / controls in the header | — | 4 / 6 | 3 / 5 | 1 sentence / 1 control |
| Wordings of "since when" on the first screen | 3 | 2 | 2 | 1 |
| Default evidence tab | Screen (page diff) | State | Timeline | the story's tab, else Timeline |
| Page height | ≈ 3 600 | ≈ 3 600 | ≈ 4 400 | ≤ 2 400 with the toolbox folded |

---

## 2. Rules the new screens follow

These extend the ten rules of the UI plan (§2 there); where they conflict, these win on the two pages in scope.

1. **Three questions, one block.** The first block states what broke, what is going on and what to do now, in that order, and nothing else is above the fold at 1280 × 800.
2. **One explanation.** A failure has one story on screen. Clues that support it are folded under it; a diagnosis, when it exists, leads it. The word *clue* does not appear on the first screen.
3. **One next step.** The page picks the primary action by a policy (§5) and says in one line why. Every other action lives in the toolbox or the More menu.
4. **A state is a sentence with one verb.** *Still failing*, *fixed and verified*, *regressed*, *resolved*, *ignored*, *snoozed* — with the one control that changes it. Never a badge next to a contradicting button.
5. **Identity is said once.** The breadcrumb carries the test title; the page's biggest line is the failure. A cluster's name is its AI title when one exists, else its deterministic name; the latest headline is a second line only when it adds a value.
6. **Evidence opens on the story.** The default tab is the one the story cites; else the Timeline when it can place two or more items; else the Screen when a screenshot exists; else the Source. Never State.
7. **One heading per card, one hint per card.** A tab's content has no heading that repeats the tab; a badge never carries a hint; a card carries at most one.
8. **Code is folded unless it is the next step.** The recipe, the bisect, the ARIA tree and the DOM open on demand; the one snippet the next step needs is open.
9. **A fact that nothing applies to is not a line.** *Assembled on the cluster page*, *AI is not configured* under a result, *No changes found* next to *Unsupported SCM host*, an environment diff that says the environment is identical — none of these earn a line on the first screen.
10. **The detail page is the zoomed-in inbox row.** Title, one-line explanation, one meta line: the same grammar as the Home inbox and the run page's cluster groups, so the reader recognizes the object.

---

## 3. The situation block

One component (`SituationBlock`) replaces `DetailHeader` + `TestCaseHeadlineCard` on the execution page and `DetailHeader` + `TriageControl` + `TestCaseHeadlineCard` on the cluster page. It has five lines; each is optional when it has nothing to say.

### 3.1 The execution page

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ‹ Home › e2e-checkout › Run #4 › should complete checkout with credit card   │
│                                        [Test history] [Share] [Export] [⋯]   │
├──────────────────────────────────────────────────────────────────────────────┤
│ ● Failed · should complete checkout with credit card · @fixme                │
│                                                                              │
│ Test timed out after 30 s while clicking getByRole('button', { name: 'Pay' })│
│                                                                              │
│ Most likely: the Pay button stayed disabled because POST /api/checkout/quote │
│ was still in flight (28 s); the console said so 1.5 s before the click gave  │
│ up.                                          Strong · 3 clues agree · 1 more ▸│
│                                                                              │
│ New regression — first failed in this run (1 day ago) on a1b2c3d by Alice    │
│ Chen. Same failure in 1 other test → cluster #1 (open, unassigned; fixed     │
│ once before, the fix did not hold). Owner @checkout-team.                    │
│                                                                              │
│ ▶ Next: apply the diagnosed fix — wait for the network before the click      │
│   (patch applies cleanly)   [Copy git apply] [Open patch ▸]   then [Retry ⧉] │
│                                                                              │
│ checkout.spec.ts:9 · chromium 1280×720 · 3.7 s (−15 %) · attempt 1/1 ·       │
│ main a1b2c3d4 · Build #1197 · 1 day ago · Details ▾ · Raw error ▸            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Line by line:

1. **Identity** — status chip, title, Playwright marks and *Quarantined*, in the weight of a kicker (`text-sm`), because the breadcrumb already carries the title. `@fixme` stays: it is a fact about the test the reader must know before fixing it.
2. **Headline** — the existing `FailureHeadline` parts at `text-xl`, the detail line (`element is not enabled`) folded into the story sentence when the story uses it, else kept under the headline in mono as today. This is the page's H1.
3. **Most likely** — the story (§4): one sentence, a strength chip (*Strong / Medium / Weak*), how many clues agree, and a disclosure for the rest. When the cluster has a completed diagnosis the sentence is the diagnosis title and the chip reads *Diagnosed · high confidence*; the clues become *supported by 3 clues*. When there is no story and no diagnosis the line is absent — not a placeholder.
4. **Situation** — one sentence built by `buildSituation` (§8.3) from `FailureVerdict.why`, `since`, `cluster`, `owner`, the cluster's status, assignee, fix verification and snooze. The three tenses of §1.1 (3) become one clause. The badge stays only for the exceptional why (*New regression*, *Passed on retry*, *Newly flaky*, *Infrastructure*) and leads the sentence.
5. **Next** — the policy's primary action (§5): one bold line, its reason in muted text, one or two buttons, and the retry command as the trailing *then*. The header's *Copy retry command* button goes; the command lives here and in the toolbox's Verify section.
6. **Facts** — the former header facts line, one size smaller, with *Details ▾* (unchanged content) and *Raw error ▸*, which reveals the ANSI error under the block exactly as the headline card's disclosure does today. The path keeps its open-in-IDE link; the attempts keep their links.

What is removed from the first screen: the second card, the *The one clue* badge, the fact-row chips, the duplicated commit, the always-on *Copy retry command*, and the *Other clues (N)* card (its content moves under *more ▸* in line 3).

### 3.2 The cluster page

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ‹ Home › Web Dashboard › Failure cluster #10                [Share][Export][⋯]│
├──────────────────────────────────────────────────────────────────────────────┤
│ Failure cluster #10 · assertion · Web Dashboard · @admin-team · PROJ-123     │
│                                                                              │
│ Users table renders 50 rows instead of 25 — server-driven pagination shipped │
│ with the API default page size.                                              │
│ Expected 26 rows, found 51 — getByRole('row') toHaveCount   latest, run #63  │
│                                                                              │
│ ▂▃▅▅▆▇▇█  8 occurrences in 1 test over 3 days · last 9 hours ago             │
│ ● Fixed in run #62 (demo010) and verified, still marked open.                │
│   [Mark resolved]                                          Triage ▾  Snooze ▾│
│                                                                              │
│ ▶ Next: apply the diagnosed fix — src/server/users.ts, PAGE_SIZE 50 → 25     │
│   (applies cleanly)   [Copy git apply] [Download .patch]   then [Retry ⧉]    │
│                                                                              │
│ Details ▾ · Raw error ▸ · Copy summary                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

1. **Identity** — `Failure cluster #N`, the error type, the project, the owner and the known issue, as a kicker. The error-type badge stops being the first coloured thing on the page.
2. **Name** — the AI title when one exists, else the deterministic name, as the H1. The **latest occurrence's headline** is the second line, small, with its provenance, and only when it adds a value the name lacks (an expected/received pair, a timeout, a "not found"); `describeCluster` gains a `headlineAddsValue(name, headline)` check so *Timeout on getByLabel('Email address')* is followed by *…was not found on the page — fill timed out after 10 s* and a bare `Error on getByRole('button')` is followed by the timeout headline, while a name that already says everything stands alone.
3. **Occurrences** — a sparkline of occurrences per run over the project's last 20 runs (§8.4), then *N occurrences in M tests over D · last X ago*. This replaces *first seen run #70 (3 days ago) · last seen run #63 (9 hours ago)* and the History card's repeat of it; the run links move to the sparkline's hover and to the affected-tests rows.
4. **State** — one sentence with one verb from `clusterState` (§8.4), a coloured dot, the one reconcile action when the human status and the machine verdict disagree, and two menus: *Triage ▾* (Open / Resolved / Ignored, assign, note) and *Snooze ▾*. The segmented control, the note icon, the verification badge, its sentence and its hint are gone.

   | `clusterState` | Sentence | Action |
   |---|---|---|
   | `failing` | *Still failing — last seen 9 hours ago in run #63, open, unassigned.* | — |
   | `failing-assigned` | *Still failing — Avery is on it since 2 days.* | — |
   | `quiet` | *Not seen for 6 runs (2 days), still open.* | *Mark resolved* |
   | `fix-verified-open` | *Fixed in run #62 (demo010) and verified, still marked open.* | *Mark resolved* |
   | `stopped-failing-open` | *Stopped failing in run #62 — no fix identified, still open.* | *Mark resolved* |
   | `regressed` | *Fixed by demo001, back since run #3 — the fix did not hold.* | *Reopen* when resolved |
   | `resolved` | *Resolved 2 days ago by Alice: "…note…".* | — |
   | `ignored` | *Ignored: "…note…".* | — |
   | `snoozed` | *Snoozed until Monday / until it recurs — open underneath.* | *Unsnooze* |
   | `quarantined` | *All 2 tests are quarantined; the cluster stays open until they are released.* | *Release* |

5. **Next** — the same policy as the execution page (§5), evaluated on the cluster.
6. **Facts** — *Details ▾* (owner and known-issue editing, as today), *Raw error ▸* (the sample error and the signature line, as today's disclosure), *Copy summary*.

What is removed: the `TriageControl` row, the `Snooze` row, the second card, the two loose rows (*Show raw error*, *from: …*), and the History card at the bottom (*Diagnosed N times · View versions* moves to the toolbox's Diagnosis section).

---

## 4. One explanation: the story

Today a failure is explained up to three times: the top clue in the headline, the other clues in their own card, and the diagnosis in the Fix card. The story replaces all three on the first screen.

### 4.1 Chaining rules

`buildFailureClues` gains a second pass that looks for *known combinations* of clues on one execution and emits a `story` — an ordered list of clue ids and one sentence template. The first version covers the combinations the seed already exhibits and the audit named (§6.C there):

| Story | Clues that form it (any order) | Sentence |
|---|---|---|
| **blocked by a pending request** | `element-present-but-blocked` + (`slow-request-overlapping-failure` \| `failed-request-before-failure`) [+ `console-mentions-target`] | *the {element} stayed {disabled/hidden} because {method} {path} {was still in flight (N s) / failed with N} [; the console said so t−N s before the {action} gave up]* |
| **renamed** | `element-renamed` + `page-structure-changed` | *the {role} the locator names was renamed from "{old}" to "{new}" since the last pass; it is reachable as {locator}* |
| **removed** | `page-structure-changed` (removed) [+ `element-renamed` absent] | *the {role} "{name}" is no longer on the page since the last pass* |
| **wrong page** | `wrong-page` + (`failed-request-before-failure` \| `dialog-open-on-failure`) | *the test ended on {url} instead of {expected} after {request/dialog}* |
| **polluted worker** | `worker-pollution` [+ `lock-holder-failed`] | *the previous test on worker N ("{title}") failed and left state behind* |
| **backend error** | `backend-error-attached` + (`failed-request-before-failure` \| `slow-request-overlapping-failure`) | *{method} {path} failed on the server: "{log line}"* |
| **timing** | `timeout-budget` + `slow-request-overlapping-failure` | *the step used N % of the timeout waiting on {path}* |
| **cross-shard lock** | `lock-cross-shard` | as today |

A story's strength is the strongest member's. When no rule matches, the story is the top clue alone, in its own words. When a completed diagnosis exists for the cluster, the diagnosis leads (its title is the sentence, its confidence is the chip) and the story becomes *supported by N clues* — the clues that the diagnosis's cited sections overlap, which is computable from the citations both sides already carry.

### 4.2 Ranking fixes

- `page-structure-changed` becomes **medium** when the parsed error's `isLocatorResolutionFailure` is false (the locator resolved; a rename is context, not cause), **strong** only when it is true.
- `environment-changed` becomes **weak** unless an entry is one of browser, viewport, locale, timezone, base URL or the environment label; tool versions alone never outrank a content clue.
- `fixed-before` leaves the clue list and becomes `since.fixedBefore` on the verdict, rendered in the situation sentence (*fixed once before, the fix did not hold*).
- Ties among equal strengths break on the story: a clue that is part of a story ranks above one that is not, before rule order.

The `CluesCard` survives as the *more ▸* disclosure under the story line: the same rows, without the card, retitled *All clues (N)*.

### 4.3 The cluster page

The cluster runs the same story on the latest occurrence (as it runs the clues today). With a completed diagnosis the story line reads the diagnosis; the full result (evidence bullets, hypotheses, checklist, prevention tips, feedback, versions) moves to the toolbox (§6) — open when it is the next step's source, folded otherwise.

---

## 5. One next step: a policy, not a menu

`computeNextStep` (`shared/next-step.ts`, pure, unit-tested) takes what both pages already fetch and returns `{ kind, title, why, primary, secondary }`. The first matching row wins:

| # | Condition | Title (the line) | Primary | Secondary |
|---|---|---|---|---|
| 1 | `status === 'didnotrun'` and `blockedByCase` | *Open the failure that blocked this test* | Open execution | — |
| 2 | cluster `fixVerification ∈ {diagnosis-verified, stopped-failing}` and status `open` | *Mark the cluster resolved — the fix held in run #N* | Mark resolved | Reopen if it comes back |
| 3 | locator-resolution failure with a healing recommendation | *Replace the locator* — the one-line diff, provenance first | Copy patch · Copy locator | Pick from snapshot · All alternatives ▸ |
| 4 | completed diagnosis with a patch that validates cleanly | *Apply the diagnosed fix — {file}, {one-line summary}* | Copy git apply · Download .patch | Open in IDE · Read the diagnosis ▸ |
| 5 | completed diagnosis, patch stale or absent | *Follow the diagnosis — {summary}* | Read the diagnosis ▸ | Re-diagnose |
| 6 | `fixVerification === 'regressed'` | *See what changed since the fix in {commit} — it did not hold* | What changed ▸ | Reopen (when resolved) |
| 7 | `why === 'passed-on-retry'` or `new-flaky` | *Compare the failing attempt with the passing one* | Attempts tab | Quarantine this test |
| 8 | `kind ∈ {crash, navigation}` (infrastructure) and CI re-run available | *Re-run in CI — this looks like the environment, not the test* | Re-run in CI | Reproduce locally ▸ |
| 9 | AI configured, no diagnosis | *Diagnose with AI — nothing deterministic explains this yet* | Diagnose with AI | Reproduce locally ▸ |
| 10 | otherwise | *Reproduce locally* — the recipe's run line, the rest folded | Copy recipe | Copy AI prompt · Configure AI |

Rules: exactly one primary; *Copy retry command* is the trailing *then* on every row where a code change is the step (3, 4, 5) and is the primary only on row 8 without CI; the desktop shell substitutes *Run locally* / *Reproduce here* for the copy actions where it can act. The policy is served on the execution and cluster endpoints (`nextStep`) so `explain_failure`, alerts and PR comments can print the same line (audit §6.H: meet the developer where the failure appears).

---

## 6. Evidence and the toolbox

### 6.1 Evidence

- **Default tab** per rule 6: the story's cited tab when the story is strong or medium; else *Timeline* when it can place two or more items; else *Screen* when a screenshot or video exists; else *Source*. *State* is never a default, and a weak clue never picks the tab.
- **Screen tab**: screenshot (with the *Visual diff* and *Page diff* toggles as today) → video → traces and attachments → **Page structure ▸**, a disclosure holding the ARIA snapshot and the DOM snapshot, the DOM rendered through the picker's renderer with *Open in picker* and *Copy HTML* — never as escaped text (`EvidenceTabs.vue:354-364`).
- **Headings**: the tab is the heading. *Network requests (4)*, *Console output (1)*, *App state at test end*, *Failure timeline* lose their titles inside the tab; their filter rows and legends stay, aligned right on the first line of the tab. Their help topics fold into one `case.evidence` topic on the Evidence card.
- **Empty tabs** keep the three-state message; the *Not placed on this axis yet* line under the timeline goes.

### 6.2 The toolbox

`FixCard` becomes `Toolbox`, titled *More ways to fix*, placed after the evidence, with every section **folded to one line** except the section the next step points at (which opens with the page). Sections, in this order: Diagnosis (the full `DiagnosisPanel`, with *Diagnosed N times · View versions* and the feedback row), Locator fix (the full panel, all alternatives), Verify (the command, *Re-run in CI*, *Run locally*, the last dispatch), Reproduce and bisect (the recipe and the bisect, one code block each, OS toggle), Fixed before, Blocked by this failure, Fix plan (*Copy as Markdown*, the MCP line). Each folded line states what is inside (*Reproduce locally — 5 commands, Linux/macOS or Windows*; *Locator fix — 3 alternatives, 8 candidates from the failing page*).

`DiagnosisPanel` renders the *AI is not configured* line **only when there is no result to show**; with a stored result and no provider it renders the result and a one-word *Re-diagnose (configure AI)* link in the section's header.

### 6.3 What changed (cluster page)

Moves up, directly under the story, because it answers *why*. It renders as **one line** when it has nothing (*What changed: not available — connect an SCM* / *no last passing run yet*) and opens as today's block when it has commits or a diff. Its baseline picker and commit browser stay inside the open block. The environment diff, when it has entries, appears here as a second line (*Environment: Playwright 1.51 → 1.52, color scheme light → dark*) and stays in the State tab; the identical-environment message is dropped (rule 9).

### 6.4 Affected tests as the evidence selector (cluster page)

`ClusterAffectedTests` moves **above** the Evidence card and becomes its selector: the same `TestRow`s with a selected state, sorted by their latest failure, each row showing the test, its file, runs failed and last seen; selecting a row switches the evidence (and the story) to that test's latest execution. The *from: … · Open execution →* row disappears: *Open execution →* becomes the row's trailing link. The bulk bar (*Move to a new cluster*, *Quarantine*) stays on the selection.

---

## 7. Mobile (390 px)

- The situation block keeps lines 1–5; the facts line collapses to the path and *Details ▾* on one row.
- The story sentence and the situation sentence stay prose (prose wraps; chips do not).
- The cluster's state line and its two menus fit one row; the sparkline drops to 12 runs.
- The toolbox is folded by definition, so the page below the evidence is one line per section.
- Target: at 390 px the headline, the story and the next step are on the first screen after the identity line; no horizontal scroll (the `AGENTS.md` rule).

---

## 8. Data and analysis

Everything the pages need that is not already on their endpoints, all in `shared/` as pure functions with unit tests, mirrored in `app/demo/api/`.

| # | Change | Where | Consumers |
|---|---|---|---|
| 8.1 | Clue ranking fixes and the story pass (§4) — `buildFailureClues` returns `{ clues, story, failureAt }` | `shared/failure-clues.ts` | both pages, the diagnosis prompt's clues section, `explain_failure` |
| 8.2 | `since.fixedBefore` on the verdict (`{ commit, runId, at }` when the cluster regressed) | `shared/failure-verdict.ts` | the situation sentence, alerts |
| 8.3 | `buildSituation(verdict, cluster, ownerAssignee)` → one sentence with link spans | `shared/situation.ts` (new) | the situation block, the inbox row's second line (optional), `explain_failure`, alerts |
| 8.4 | `clusterState` (§3.2) and `occurrenceSeries` (per run, last 20 project runs) on `FailureClusterDetail` | `shared/handlers/failure-clusters.ts`, `types/api.ts:943` | the cluster block, the inbox row's badge, `list_open_clusters` |
| 8.5 | `computeNextStep` (§5) served as `nextStep` on the execution and cluster endpoints | `shared/next-step.ts` (new), both `[id].get.ts` handlers | both pages, `explain_failure`, `get_fix_plan`, PR comments |
| 8.6 | `headlineAddsValue(name, headline)` | `shared/describe-cluster.ts` | the cluster identity |

No schema change: everything derives from stored rows. The MCP tools gain fields only (additive), and the demo mirror follows each in the same PR (`AGENTS.md` › Demo data requirements).

---

## 9. Shared building blocks

**Build**

| Component | Used by | Replaces |
|---|---|---|
| `SituationBlock` — identity, headline, story line, situation sentence, next step, facts line; `variant: execution \| cluster` | both pages | `DetailHeader` on these two pages, `TestCaseHeadlineCard`, `TriageControl`'s row, the loose rows |
| `StoryLine` — sentence, strength or confidence chip, *N clues agree*, *more ▸* over the existing clue rows | `SituationBlock` | *The one clue*, `CluesCard` as a card |
| `NextStepLine` — title, why, primary and secondary actions from `nextStep` | `SituationBlock` | the header's *Copy retry command*, the Fix card's pointer sections |
| `ClusterStateLine` — sentence, dot, reconcile action, Triage and Snooze menus | `SituationBlock` (cluster) | `TriageControl` |
| `OccurrenceSparkline` | `SituationBlock` (cluster), later the inbox row | the first/last-seen chips, `ClusterHistory` |
| `Toolbox` — folded sections with one-line summaries | both pages | `FixCard` |
| `PageStructureDisclosure` — ARIA tree and rendered DOM | Evidence › Screen | the two open snapshot cards |

**Change**: `EvidenceTabs` (default policy, headings, Screen tab), `DiagnosisPanel` (not-configured line only without a result; versions link in its header), `ClusterAffectedTests` (selector mode), `ClusterInvestigation` (one-line empty state, environment line), `LocatorHealingPanel` (renders inside the toolbox and as the next step's compact form), `ReproduceSection` (folded, the run line first), `describeCluster`, `buildFailureClues`, `useClusterSectionLocator` (citations open the toolbox section or the tab).

**Delete** (once both pages ship): `TestCaseHeadlineCard.vue`, `TriageControl.vue`, `ClusterHistory.vue`, `FixCard.vue`, the `case.headline`, `case.clues`, `case.fix`, `cluster.triage`, `cluster.fix-verification`, `cluster.fix-plan` help topics (folded into `case.evidence`, `cluster.state` and `fix.toolbox`), and the `DetailHeader` usages on these two pages (`DetailHeader` stays for the run page).

---

## 10. Delivery plan

PR-sized, each shippable alone, the server first so every UI PR renders real data.

### Phase 0 — measure (days)

1. Commit the measurement script as `scripts/measure-detail-pages.mjs` (Appendix C) with `--json`; register `execution-clarity` and `cluster-clarity` scenes at 1280 × 800 and 390 px on #37 and #10 so §1.5 can be re-measured after each phase.
2. Unit tests pinning today's clue output for #37, #13, #10 and #5 (the four cases in §1.4), so the ranking changes in Phase 1 are visible as diffs.

### Phase 1 — the analysis (one PR, server + shared + demo)

8.1–8.6 above. Accept when: on #37 the story reads *blocked by a pending request* and cites network, console and ARIA; on #10 no environment clue outranks the diagnosis and `nextStep.kind === 'apply-patch'`; on #2 `nextStep.kind === 'replace-locator'`; on #5 `nextStep.kind === 'replace-locator'` (ARIA-derived) and the environment clue is weak; `clusterState` on #10 is `fix-verified-open` and on #1 `regressed`; `explain_failure` returns `story`, `situation` and `nextStep`; the demo mirror returns the same fields; `tests/unit/failure-clues.test.ts`, `next-step.test.ts`, `situation.test.ts` cover every row of §3.2 and §5.

### Phase 2 — the execution page (one PR)

`SituationBlock` (execution), `StoryLine`, `NextStepLine`; delete the headline card and the *Other clues* card; retarget the section locator; header primary action removed. Accept when: at 1280 × 800 the first screen shows identity, headline, story, situation, next step and the facts line and nothing else; controls above the fold ≤ 15; help hints above the fold ≤ 1; *New regression* appears once; the raw error is one click away; `test-run-case-page.spec.ts`, `fix-plan.spec.ts`, `desktop-reproduce.spec.ts` updated; `failure-headline`, `failure-headline-mobile`, `gather-evidence` scenes updated.

### Phase 3 — the cluster page (one PR)

`SituationBlock` (cluster), `ClusterStateLine`, `OccurrenceSparkline`, affected tests as the selector above the evidence, *What changed* moved up with its one-line empty state; delete `TriageControl`, `ClusterHistory`, the loose rows. Accept when: #10's first screen states *Fixed in run #62 and verified, still marked open* with one *Mark resolved*; #1 states *back since run #3 — the fix did not hold*; the sparkline shows 8 occurrences on #10; selecting an affected test on #5 switches the evidence; controls above the fold ≤ 15; `cluster-page-layout.spec.ts`, `failure-clusters.spec.ts` updated; `ai-diagnosis`, `failure-clusters` scenes updated.

### Phase 4 — the toolbox and the evidence (one PR)

`Toolbox` replaces `FixCard` on both pages; `ReproduceSection` folded; `DiagnosisPanel` not-configured rule; evidence default policy; `PageStructureDisclosure`; tab-content headings and hints removed. Accept when: open code by default ≤ 250 px on #37 and #10; the default tab on #10 is *Timeline* and on #37 *Timeline* (the story cites network, console and ARIA; the timeline places all three); *AI is not configured* never renders under a result; help hints per page ≤ 4; `attempt-diff`, `page-diff`, `locator-healing`, `execution-history` scenes updated.

### Phase 5 — mobile, docs and the sweep (one PR)

The 390 px pass (§7); `apps/docs` pages `features/evidence.md` (*One execution, diagnosis-first*), `features/fix-plans.md`, `features/failure-clusters.md`, `guide/your-first-failure.md` rewritten to the three questions with regenerated screenshots (`app:screens:docs`); the retired-words test extended with *The one clue*, *Other clues*, *Fix plan* as an on-screen label and *Triage* as a heading; help topics pruned; `concepts.md` gains *story*, *situation*, *next step*.

### Cost and risk

| Risk | Where | Mitigation |
|---|---|---|
| Specs assert on labels that move | 29 specs reference the two routes; 5 assert on *Show raw error*, *Other clues*, *Open fix plan*, *Copy retry command*, *Mark resolved*, *Affected tests* (`cluster-page-layout`, `desktop-local-run`, `desktop-reproduce`, `fix-plan`, `test-run-case-page`) | each phase updates the specs it touches; `data-shot` anchors keep their names where the block survives |
| Committed docs screenshots | `failure-headline`, `failure-headline-mobile`, `gather-evidence`, `ai-diagnosis`, `failure-clusters`, `attempt-diff`, `page-diff`, `locator-healing`, `execution-history` | regenerated per phase; `app:screens:check` guards |
| The story sentence is wrong on a real failure | §4.1 templates | a story is only emitted for a matched combination; otherwise the top clue in its own words; the disclosure always shows every clue |
| The next-step policy picks a stale patch | row 4 requires `patchValidation.applies === true`; row 5 says the patch is stale | the policy is a pure function with one test per row |
| Demo and MCP shapes | `app/demo/api/`, `explain_failure`, `get_fix_plan` | additive fields only; `demo-seed-consistency` and the MCP tests extend |
| Share-link and export renderers | `server/utils/export-*.ts`, the share route | they print the headline and the error today; they gain the situation and next-step lines in Phase 2 and are not blocked by the layout |

---

## 11. What this plan does not do

- It does not change what the reporter captures, how failures cluster, or the diagnosis prompt beyond feeding it the story.
- It does not redesign the run page, the project page, Home or the inbox; the inbox row may adopt the situation sentence as its second line once §8.3 exists, in a separate PR.
- It does not touch the visual theme. The difference is fewer, better-ordered lines, not new colours.
- It does not remove any data from the pages: every block that leaves the first screen lands in *Details*, the story's disclosure, a tab or the toolbox.

---

## Appendix A — Removals and moves by file

| File | Action | Goes to |
|---|---|---|
| `app/pages/test-run-cases/[id].vue` | rewrite the top: `SituationBlock`; `Toolbox` after the evidence; History stays | §3.1, §6.2 |
| `app/pages/failure-clusters/[id].vue` | rewrite the top: `SituationBlock` (cluster); *What changed* under the story; affected tests above the evidence; `Toolbox`; History card deleted | §3.2, §6.3, §6.4 |
| `app/components/shared/DetailHeader.vue` | no longer used by these two pages; stays for the run page | — |
| `app/components/test-case/TestCaseHeadlineCard.vue` | delete | `SituationBlock` lines 2–4 and the *Raw error ▸* disclosure |
| `app/components/test-case/CluesCard.vue` | becomes the body of `StoryLine`'s disclosure | §4.2 |
| `app/components/cluster/TriageControl.vue` | delete | `ClusterStateLine` |
| `app/components/cluster/ClusterHistory.vue` | delete | `OccurrenceSparkline` + the Diagnosis section's versions link |
| `app/components/cluster/ClusterAffectedTests.vue` | selector mode, moves above the evidence | §6.4 |
| `app/components/cluster/ClusterInvestigation.vue` | one-line empty state; environment line | §6.3 |
| `app/components/shared/FixCard.vue` | becomes `Toolbox` (folded sections with summaries) | §6.2 |
| `app/components/shared/ReproduceSection.vue` | folded; the run line first | §6.2 |
| `app/components/shared/LocatorHealingPanel.vue` | compact form for the next step; full form in the toolbox | §5 row 3 |
| `app/components/diagnosis/DiagnosisPanel.vue` | not-configured line only without a result; versions link in the header | §6.2 |
| `app/components/test-case/EvidenceTabs.vue` | default policy; Screen tab with `PageStructureDisclosure`; no repeated headings | §6.1 |
| `shared/failure-clues.ts` | ranking fixes; story pass; `fixed-before` removed | §4 |
| `shared/failure-verdict.ts` | `since.fixedBefore` | §8 |
| `shared/situation.ts`, `shared/next-step.ts` | new | §3, §5 |
| `shared/handlers/failure-clusters.ts`, `types/api.ts` | `clusterState`, `occurrenceSeries` | §8 |
| `shared/describe-cluster.ts` | `headlineAddsValue` | §3.2 |
| `app/utils/help-content.ts` | six topics folded into three | §9 |
| `server/utils/mcp/tools.ts` | `explain_failure` and `get_fix_plan` gain `story`, `situation`, `nextStep` | §8 |
| `app/demo/api/test-cases.ts`, `failure-clusters.ts` | mirror the new fields | §8 |

## Appendix B — Words on screen

| Today | After |
|---|---|
| The one clue · Other clues (N) | **Most likely:** … · *N clues agree* · *more ▸* / *All clues (N)* |
| Failing since run #N · First failure in this run · New regression (chip) | one clause in the situation sentence; the chip leads it |
| Triage [Open][Resolved][Ignored] · Fix verified · Mark resolved · Snooze | the state sentence · *Mark resolved* / *Reopen* · *Triage ▾* · *Snooze ▾* |
| first seen run #70 (3 days ago) · last seen run #63 (9 hours ago) | ▂▃▅▇ *8 occurrences in 1 test over 3 days · last 9 hours ago* |
| Fix (card) · FIX PLAN · DIAGNOSIS · REPRODUCE · VERIFY (labels) | **Next:** … (one line) · *More ways to fix* (folded sections) |
| Show raw error (button, two places) | *Raw error ▸* on the facts line |
| from: {test} · run #N · Open execution → | the selected row of *Affected tests* |
| Copy retry command (header primary) | *then [Retry ⧉]* on the next-step line; the Verify section |
| History (cluster card) | gone — the sparkline and the Diagnosis section |
| AI is not configured · Configure · Copy prompt (under a result) | only without a result; *Re-diagnose (configure AI)* otherwise |

## Appendix C — Method

Captures (all on the dev seed, `npm run app:screens -- --route … --url http://localhost:3000`): #37, #13, #587, #682 and clusters #10, #2, #5, #1, #8 at 1280 × 800; #37, #13, #10, #2, #5, #1, #682 at 1280 × 2 600–3 400; #37 and #10 at 390 × 1 800; #37 on every evidence tab, the *Page diff* toggle, *Show raw error* open and the *Details* popover; #10 on Timeline, Screen and Network, *Show raw error* open and *Details* open; the run page (#2) and Home for the inbound rows. The clue endpoint was read directly for #37 and #13 to confirm the ranking in §1.4.

The numbers in §1.5 come from a Playwright script that, after hydration and settle, reads the scroll offset of each block (`h1`, `[data-shot="failure-headline"]`, `[data-shot="failure-clues"]`, the Evidence `section`, `[data-shot="fix"]` and its sections, `[data-shot="cluster-affected-tests"]`, the History cards), counts `button, a[href], [role=tab], select, input, textarea` inside the panel with a top below 800 px, counts `button[aria-label^="Help:"]`, sums the height of `pre` elements, and counts the words of the panel's `innerText`. Phase 0 commits it.

One dev-seed defect noticed on the way, outside this plan: the seeded attachments point at `demo/screenshots/*.png`, which `/api/files/…` answers with 404 on a dev database because `app:seed:dev` does not copy the demo media into the storage directory — the Screen tab shows a broken image where the demo shows the screenshot.
