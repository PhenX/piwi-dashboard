# UX audit — new-user onboarding, reporter install & first impression

**Date:** 2026-07-16 · **Audited:** v0.12.0, `main` @ `1054952`, run **from source** (not the published Docker image, which lags the repo) · **Author:** automated audit (Claude)

## How this audit was done

Everything below is evidence-based, not opinion from reading code alone:

- Started the dashboard from source with a fresh database and walked the real first-run journey at 1440px and 375px.
- Created a **fresh Playwright project in a non-git directory**, packed the local reporter build (`npm pack`), and followed the in-app wizard and README **verbatim**, capturing exact terminal output.
- Tested the failure modes a new user actually hits: partial first run, wrong `serverUrl`, auth-enabled server without an API key, missing `PIWI_AUTH_SECRET`.
- Walked the full auth-enabled path: fresh DB → login → first admin → API key creation → successful submission.
- Added the capture fixtures per the "Go further" step and verified the enriched failure page.
- Three parallel deep audits: in-app onboarding code, docs-vs-code accuracy, and the reporter package surface.

Screenshots live in [`ux-audit-screenshots/`](./ux-audit-screenshots/). Terminal captures are in Appendix A.

---

## Journey scorecard

| Stage | Grade | Biggest issue |
|---|---|---|
| 0. GitHub README / docs landing | **A−** | Strong pitch, good visuals. Quick start hides a Linux-only first-run failure (volume permissions). |
| 1. Install the dashboard | **B** | Docker quick start breaks on Linux hosts (root-owned `.data`); fix exists but only in deep-dive docs. |
| 2. First load, empty DB | **B+** | The "Get started in 60 seconds" wizard is genuinely good; on mobile it's buried under 4 marketing cards; no "listening for your first run" state. |
| 3. Install the reporter (no auth) | **A−** | 2-line install works; terminal never prints the run URL; `fatal: not a git repository` leaks into output. |
| 4. Install the reporter (auth on) | **D** | Wizard omits `apiKey` entirely → verbatim path dies with a 34-line stack dump and no remediation hint. |
| 5. First results in dashboard | **B** | SSE auto-transition is great. A *partial* first run looks like nothing arrived ("Full runs only" default). Every run shows "Piwi **vunknown**". |
| 6. Investigating the first failure | **A−** | Diagnosis-first page is the product's best moment. Marred by a nonsense "+254300%" stat and an overflowing Storage card. |
| 7. Auth & API keys | **D** | Fresh auth-enabled install is a hard dead end at `/login` (no first-admin UI). API keys are 3 screens deep behind an unlabeled icon. |
| 8. Docs deep-dive | **B+** | Broad and mostly accurate; getting-started teaches a 35-line manual `curl` before the 2-line reporter install. |

**The single most important insight:** the no-auth happy path is already close to excellent — but the two paths a serious team hits immediately (**auth enabled** and **CI**) have not received the same onboarding care, and that's where the first impression currently breaks.

---

## P0 — breaks the funnel or badly damages trust

### 1. Auth-enabled fresh install is a hard dead end at the login screen
`PIWI_AUTH_ENABLED=true` + empty DB → the user lands on `/login` with **no way to create the first admin from the UI** ([screenshot](./ux-audit-screenshots/11-auth-first-load.png)). No `.vue` file calls `/api/auth/setup`; the only path is a `curl` command documented in `docs/authentication.md:49-73`. Anyone who enables auth before reading that page is stuck at a form that can never succeed ("Forgot password?" is equally dead — no users, no SMTP).
**Fix:** on load, `login.vue` checks a public "is the users table empty?" flag (tiny endpoint or extend `/api/auth/me`) and shows a **"Create the first admin account"** form posting to the existing `/api/auth/setup`. The endpoint already self-disables once a user exists (`setup.post.ts`), so this adds no attack surface.
**Evidence:** `application/app/pages/login.vue` (no setup affordance), `application/server/api/auth/setup.post.ts`, `application/middleware/auth.global.ts:23-28`.

### 2. The wizard's config is wrong for auth-enabled instances — and the failure is brutal
The Get-started wizard renders the same snippet whether or not auth is on (`GetStartedWizard.vue` contains zero references to `apiKey`), but `/api/test-runs/*` requires a `REPORTER`/`ADMINISTRATOR` identity when auth is enabled (`submit.post.ts:17`, `start.post.ts:13`). Following the wizard verbatim produces:

- a **silent** 401 on streaming start (no log line at all — the run just isn't live), then
- at the end, `Error in reporter HttpError: Request failed with status 401` followed by a **34-line JSON + stack dump** (Appendix A.B) in which the actionable fact ("Authentication required") is buried and **no remediation is suggested** — nothing says "create an API key under Settings → Users and set `apiKey` (or `PIWI_API_KEY`)".

**Fix (three parts):**
1. Make the wizard auth-aware: when `authEnabled`, insert an extra step "Create an API key" (deep link to the key modal) and include `apiKey: process.env.PIWI_API_KEY` in the snippet.
2. In the reporter, catch `HttpError` with `status` 401/403 and print one actionable line (`Authentication is enabled on <serverUrl>. Create an API key (Settings → Users) and set the apiKey option or PIWI_API_KEY.` + docs link) instead of the raw dump.
3. Make streaming-start failures loud (one warning line naming the status).
**Evidence:** `application/app/components/layout/GetStartedWizard.vue`, `reporter/src/internal/transport/http-client.ts`, `reporter/src/internal/submit/run-submitter.ts`.

### 3. The README/getting-started Docker quick start fails on Linux hosts
The container runs as UID 1001 (`Dockerfile:68`), so the README's very first command (`docker run -p 3000:3000 -v $(pwd)/.data:/app/.data …`) creates a **root-owned `.data`** on Linux and the app can't write its database. The one-line fix (`mkdir -p .data && chown -R 1001:1001 .data`) exists — but only in `DOCKER.md:167-171`, `DOCKER_HUB.md:71`, and `docs/deployment.md:317` — **not** in the README quick start or `docs/getting-started.md:27-45`, the two entry points nearly every new user follows. Worse, when the DB then fails, the home page swallows API errors (finding 13) and renders the onboarding wizard as if everything were fine.
**Fix:** add the `mkdir + chown` line (Linux tab) to both quick starts, and/or handle it in the image entrypoint. Also consider having `/api/health` fail loudly on an unwritable data dir and surfacing that on the home page.

### 4. In-app API docs (`/docs`) are blank offline — and phone out to a CDN
The sidebar's "API Docs" loads Scalar from `https://cdn.jsdelivr.net/npm/@scalar/api-reference`. In any restricted/air-gapped network (a core self-hosting audience) the page renders **completely blank** — no error, no fallback ([screenshot](./ux-audit-screenshots/10-api-docs.png)). It also quietly contradicts the README's "zero telemetry, no phone-home; the only outbound calls are the ones you configure" promise, since every `/docs` visit hits a third-party CDN from the browser.
**Fix:** bundle the Scalar assets (or vendor a minimal OpenAPI renderer) so `/docs` is self-contained; at minimum, detect load failure and show "Couldn't load the API reference UI — the raw spec is at `/_openapi.json`".

### 5. The reporter never prints the run URL
After a successful submission the terminal says `Successfully finalized streaming run #2` — and stops. The user must switch to the browser and hunt for the run. The reporter knows `serverUrl` and the run ID the whole time; **one line** (`View this run: http://localhost:3000/test-runs/2`) turns every test run into a deep link and is the single cheapest UX win in the whole funnel. Print it on start (streaming = live page) and again in the final summary.
**Evidence:** Appendix A.A; `reporter/src/internal/submit/run-submitter.ts`, `reporter/src/public/reporter.ts` (`onEnd`).

### 6. Every real install reports "Piwi vunknown"
The run-detail CI/Env card shows `Piwi vunknown` ([screenshot](./ux-audit-screenshots/07-run-detail.png)). Root cause: `reporter/src/internal/support/reporter-version.ts:11` resolves `__dirname/../../../package.json` — correct for the `src/` tree, but the published package is a **bundled `dist/index.js`**, so it resolves two levels above the package root and always falls back to `'unknown'`. Cosmetic, but it's on every run page and reads as "something is misconfigured", and it defeats future version-compatibility warnings.
**Fix:** inject the version at build time (tsup `define`/`banner`), or resolve `../package.json` from `dist/`.

### 7. A partial first run looks like the submission never arrived
The most natural first command after wiring the reporter is `npx playwright test path/to/one.spec.ts` (or `--grep`). The reporter flags it "partial", and the home page — **"Full runs only" checked by default** — then shows `0 runs today`, Project health `No full runs` / tendency `Unknown`, and an empty Recent activity ([screenshot](./ux-audit-screenshots/16-search-empty.png)). The wizard promised "Results appear in the dashboard automatically", so this reads as *it didn't work*. The data is there — hidden by a filter the new user has never heard of.
**Fix:** when the only runs in scope are partial, show an inline note ("1 partial run hidden — Full runs only is on · Show it") instead of bare zeros; consider defaulting the filter off until the first full run exists.

---

## P1 — significant friction on the main paths

### 8. `fatal: not a git repository` leaks into every non-git run
`collectScmInfo` calls `execSync('git rev-parse HEAD', …)` without redirecting stderr, so git prints `fatal: not a git repository` straight into the user's test output (`reporter/src/internal/collect/metadata-collector.ts:133-137`). The exception is caught and debug-logged — but the scary line still reaches the terminal of exactly the "just trying it out in a scratch folder" audience.
**Fix:** add `stdio: ['ignore', 'pipe', 'ignore']` to `execOpts`.

### 9. API keys are undiscoverable, and the key modal never shows *how to use* the key
Path measured: user menu (labeled **"Configuration"** when auth is off, **username** when on) → **Users** → unlabeled key icon on a user row → modal → Create API key → name → Generate → copy. Three screens, ~6 interactions, and the words "API key" appear nowhere in navigation — a settings surface whose primary consumer is *the reporter setup*. The created-key screen (excellent one-time warning, copy button, prefix, "Never used" indicator — [screenshot](./ux-audit-screenshots/15-apikey-created.png)) still never shows the **one thing the user came for**: `apiKey: 'pd_…'` / `PIWI_API_KEY=pd_…` usage.
**Fix:** add an "API keys" entry (or a keys section on the Account page and a wizard deep-link); show a ready-to-paste reporter/env snippet on the created-key screen; label the row icon.

### 10. `docs/getting-started.md` teaches the hard path first
"Submitting your first test result" (a 35-line `curl`/PowerShell JSON payload, lines 68–126) comes **before** "Using the Piwi Dashboard reporter" (line 130) — which the docs themselves call "the recommended way". A Playwright user came for the 2-line reporter; the curl blob is API-consumer content. It also seeds fake data ("should login successfully") into their dashboard.
**Fix:** reorder — reporter first (mirroring the wizard), move the raw-API example to the end under "Submitting via the REST API (optional)".

### 11. On mobile, the wizard is below four screens of marketing
At 375px the four feature cards each fill most of the viewport, pushing the actionable wizard ~3 screens down ([screenshot](./ux-audit-screenshots/04-first-load-mobile.png)); on desktop they also push it below the fold ([screenshot](./ux-audit-screenshots/01-first-load-desktop.png)). A user who just installed doesn't need to be re-sold.
**Fix:** wizard first, feature cards after (or as a compact strip); on `< sm` collapse the cards to one-line items.

### 12. Empty states downstream of the wizard are dead ends
- `/projects` empty state: bare text "No projects yet — Submit test results via the API, or create a project manually" + "New project" ([screenshot](./ux-audit-screenshots/05-projects-empty.png)). "Via the API" is off-message (the reporter is the path), there's no link to the wizard/docs, no icon, and it doesn't use the shared `EmptyState` component (`application/app/pages/projects/index.vue:308-312`).
- Manually created project → detail page shows only "No test runs yet for this project." (`projects/[id]/index.vue:871`) — no pointer back to reporter setup. Users who click "New project" first (a very common instinct) end up in a shell with no guidance.
**Fix:** both empty states should link to the home wizard / reporter docs ("Waiting for your first run — set up the reporter →").

### 13. A failed API load is indistinguishable from a fresh install
`pages/index.vue:7-10` defaults failed fetches to `[]`, so a broken DB/API renders the **onboarding wizard** instead of an error. Combined with finding 3, a Linux Docker user gets a healthy-looking "Get started" page whose submissions then fail server-side.
**Fix:** surface fetch errors on the home page (the shared `ErrorState` with retry exists for exactly this).

### 14. Unreachable-server messaging stops one sentence short
`ECONNREFUSED` handling is genuinely good (fallback ladder → `Saved recovery data for later upload`, and the data really is auto-uploaded on the next run — verified, Appendix A.C). But it never says (a) *check `serverUrl` / is the dashboard running*, or (b) that recovery upload is **automatic next run**. And it's inconsistent: connection errors get tidy one-liners while HTTP 401 gets a stack bomb (finding 2).
**Fix:** append the hint + "will retry automatically on the next run"; route all submit-path errors through the same one-line formatter.

### 15. "Waiting for your first run" state doesn't exist
The home page silently listens via SSE (`useRunStream`) and the wizard is replaced the moment a run arrives — which is magic when it happens, but nothing tells the user the app is listening ("Run your tests — this page updates by itself"). Users who ran tests in another terminal and see no change (e.g. finding 7, or a 401) have no signal distinguishing "not arrived yet" from "arrived but hidden" from "failed".
**Fix:** add a live status row to step 4 of the wizard (pulse + "Listening for your first run…"), flipping to a success/celebration state with a link when the run lands.

### 16. Numbers that read as bugs on young projects
- **"+254300%"** in red on the case summary (duration vs. an "average" computed from 2 runs, one of which crashed at 1ms) — [screenshot](./ux-audit-screenshots/08-failing-case.png).
- Project health "Unknown" tendency + gray bars until enough full runs exist, with no "needs more runs" hint.
**Fix:** suppress comparative stats below a minimum history (e.g. n<5) or label them "(low confidence)".

### 17. Layout overflow on the case/run detail right rail
At 1440px: Storage card action buttons clip ("Downl…"), a filename renders garbled/overlapping ("e…40oKBxt Open"), and the run-summary header's retry button is half-hidden behind the CI/Env card ([screenshots](./ux-audit-screenshots/08-failing-case.png), [07](./ux-audit-screenshots/07-run-detail.png)). The Browser card shows a bare "—" with the wizard's minimal config (no named projects), which looks broken rather than "not configured".
**Fix:** let the Storage rows wrap/truncate with tooltips; give Browser an explanatory empty state ("No browser metadata — add Playwright projects or the capture fixtures").

### 18. Auth boot error contradicts the project's own cross-platform rule
`PIWI_AUTH_ENABLED=true` without `PIWI_AUTH_SECRET` refuses to boot (good hard-fail) but recommends `openssl rand -hex 32` (`application/nuxt.config.ts:95-99`) — the repo's convention (AGENTS.md "Cross-platform shell commands") is the portable `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Same for the error's lack of a docs link. Windows users hit a command that doesn't exist.

### 19. Settings are hidden behind an unlabeled concept
No "Settings" in the sidebar; everything lives in the bottom dropdown labeled **"Configuration"** (auth off) or the **username** (auth on) — `UserMenu.vue:45-59`. New admins hunting for AI setup, SMTP status, storage, or API keys must discover the dropdown first. The menu also mixes personal (Account, Theme) with instance administration (Users, Storage, AI).
**Fix:** add a gear "Settings" item to the sidebar bottom group (next to API Docs / MCP server).

---

## P2 — polish that would lift the "perfect first impression" bar

| # | Item | Evidence / note |
|---|---|---|
| 20 | Wizard prose says "initialising state" — project style mandates American English ("initializing"); the wire status enum can stay | `GetStartedWizard.vue:177` |
| 21 | Empty `<h1>` on the home page (breadcrumb carries the title) — a11y + SEO nit | layout heading slot on `/` |
| 22 | "Get started" help popover says "The wizard generates the snippet for you" — it's a static snippet (only `serverUrl` is dynamic); either make `projectName` editable inline (nice win: type your project name, snippet updates) or soften the copy | `help-content.ts:54-58` |
| 23 | Demo first paint is a blocking full-screen spinner (`z-[9999]`) until the service worker claims the page; re-shows on every hard reload | `DemoInitScreen.vue:20-43` |
| 24 | Demo visitors never see the wizard (seeded data hides it) — the exact audience evaluating "how easy is setup?" can't preview it; add a "See the setup wizard" toggle or screenshot in docs | `index.vue:300` gate |
| 25 | No wizard dismiss/persistence: it's purely `!hasProjects` — can't be dismissed while empty, gone forever after the first run (taking the fixtures pointer with it); add a "Setup guide" link somewhere permanent (e.g. help menu) | `index.vue:300-317` |
| 26 | After the first successful run there's no "next step" nudge toward capture fixtures (the biggest value unlock, README step 4) — e.g. a one-time banner "Unlock locator healing & Web Vitals: add the capture fixtures" when a project has runs but no fixture-produced data | post-first-run home |
| 27 | Run-detail table "TESTS" header truncates to "TEST" at 1440px | `07-run-detail.png` |
| 28 | 401 response body includes the server's internal stack trace (dev mode observed; verify prod strips it) | Appendix A.B |
| 29 | `projectName: 'my-project'` placeholder in wizard/docs vs reporter default `'default-project'` (`options.ts:23`) — harmless but two different "defaults" appear in the funnel | consistency |
| 30 | Sidebar "Search…" chip renders an empty box before the K on some loads | `05-projects-empty.png` top-left |
| 31 | Published Docker image lags the repo (per maintainer). Everything in this audit is from source; still, "first impression" for most users **is** the image — consider release automation so `:latest` tracks releases, and a "what version am I running vs latest" hint on `/settings/about` | release hygiene |

---

## What's already excellent — protect these

- **The wizard concept and execution**: numbered steps, copy buttons on every snippet, `serverUrl` auto-set from `window.location.origin`, accurate `wrapConfig`/fixtures "Go further" content, demo link.
- **SSE-driven transition**: the dashboard repopulates the moment the first run arrives — no refresh. (It just needs to *say* it's listening — finding 15.)
- **Crash-safe submission ladder**: streaming → multipart → JSON → recovery file, and the recovery file really does auto-upload on the next run. Rare and impressive.
- **API-key modal mechanics**: one-time display warning, prefix display, "Never used" status — the *content* is right; only the *path to it* is wrong.
- **The failure page**: error-first layout, alternative locators, ARIA/DOM snapshots, network log, cluster linking ("Known failure — first seen in run #2"), and a graceful "AI not configured → Copy AI context" fallback ([screenshot](./ux-audit-screenshots/18-fixtures-evidence.png)).
- **Docs discipline**: cross-platform tabs almost everywhere, live demo, comparison page with honest trade-offs.

---

## Top 10 punch list (impact × effort)

| # | Fix | Effort | Findings |
|---|---|---|---|
| 1 | Print the run URL in the reporter (start + end) | ~1h | 5 |
| 2 | Suppress git stderr in metadata collector | ~15min | 8 |
| 3 | Actionable one-line 401/403 message + loud streaming-start failure | ~2h | 2 |
| 4 | First-admin setup form on `/login` when users table is empty | ~half day | 1 |
| 5 | Auth-aware wizard step (API key) + key-usage snippet in the modal | ~half day | 2, 9 |
| 6 | `mkdir + chown` line in README & getting-started Docker quick starts | ~15min | 3 |
| 7 | Fix bundled version resolution ("vunknown") | ~1h | 6 |
| 8 | Partial-run visibility hint on home ("1 partial run hidden…") | ~2h | 7 |
| 9 | Reorder getting-started (reporter before raw API); wizard above marketing cards | ~1h | 10, 11 |
| 10 | Bundle Scalar locally (or graceful fallback to `/_openapi.json`) | ~2h | 4 |

Items 1–3 alone transform the terminal experience — the surface a developer stares at all day.

---

## Appendix A — terminal captures (verbatim)

### A.A Happy path, auth off, non-git project (wizard followed exactly)
```text
Running 3 tests using 1 worker

[Piwi Dashboard] Starting test run for project: my-project (Playwright v1.56.1)
fatal: not a git repository (or any of the parent directories): .git   ← raw git stderr (finding 8)
[Piwi Dashboard] Streaming enabled. Run ID: 2
  ✓  1 tests/example.spec.ts:3:5 › homepage has title (823ms)
  ✓  2 tests/example.spec.ts:8:5 › math works (2ms)
  ✘  3 tests/example.spec.ts:12:5 › this one fails (2.5s)
  …
[Piwi Dashboard] Test run completed. Status: failed (Playwright result.status: failed)
[Piwi Dashboard] Total: 3, Passed: 2, Failed: 1, Skipped: 0, TimedOut: 0, DidNotRun: 0
[Piwi Dashboard] Successfully finalized streaming run #2
[Piwi Dashboard] Successfully uploaded reports for streaming run #2
                                                                        ← no run URL (finding 5)
```

### A.B Auth enabled, wizard config (no apiKey)
```text
[Piwi Dashboard] Starting test run for project: my-project (Playwright v1.56.1)
[Piwi Dashboard] Partial run detected (filter active)
  ✓  1 tests/example.spec.ts:8:5 › math works (6ms)                    ← streaming start 401'd SILENTLY
  1 passed (770ms)
[Piwi Dashboard] Found 0 trace files
Error in reporter HttpError: Request failed with status 401: {
  "error": true,
  "url": "http://localhost:3000/api/test-runs/upload",
  "statusCode": 401,
  "statusMessage": "Server Error",
  "message": "Authentication required",
  "stack": [ …server-internal stack frames… ]
}
    at HttpClient.postFormData (…/@piwitests/reporter/dist/index.js:256:13)
    … ~15 more internal frames …
  status: 401
}
```
34 lines; no mention of API keys, the Settings path, `apiKey`, or `PIWI_API_KEY`.

### A.C Wrong serverUrl (`http://localhost:9999`)
```text
[Piwi Dashboard] Failed to upload with files: connect ECONNREFUSED 127.0.0.1:9999
[Piwi Dashboard] Falling back to JSON upload...
[Piwi Dashboard] All upload methods failed: connect ECONNREFUSED 127.0.0.1:9999
[Piwi Dashboard] Saved recovery data for later upload
```
Next run against a reachable server printed `Found saved test data from a previous run, uploading… Successfully uploaded saved test data` — the auto-retry works but is never promised.

### A.D Boot failure with auth misconfigured
```text
ERROR  PIWI_AUTH_ENABLED is true but PIWI_AUTH_SECRET is not set. Generate a secure secret with: openssl rand -hex 32
```

## Appendix B — screenshot index

| File | Shows |
|---|---|
| `01-first-load-desktop.png` | First load, empty DB, 1440px — cards above wizard |
| `04-first-load-mobile.png` | Same at 375px — wizard ~3 screens down |
| `05-projects-empty.png` | Projects empty state |
| `07-run-detail.png` | Run detail — "Piwi vunknown", clipped header button, TEST header |
| `08-failing-case.png` | Case detail — "+254300%", Storage card overflow |
| `10-api-docs.png` | `/docs` blank (CDN unreachable) |
| `11-auth-first-load.png` | Auth-on fresh install: the login dead end |
| `15-apikey-created.png` | Key created modal (good mechanics, no usage snippet) |
| `16-search-empty.png` | Partial first run hidden by "Full runs only" |
| `18-fixtures-evidence.png` | The payoff: fixtures-enriched failure page |
