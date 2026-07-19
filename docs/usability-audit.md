# Piwi Dashboard — Usability Audit

_Audit method: the app was driven like a real user with Playwright (Chromium) against a
dev server seeded with realistic sample data (projects, runs, failure clusters, diagnoses).
Every core route and every `?tab=` panel was visited; keyboard navigation, focus behaviour,
and screen-reader affordances were exercised programmatically. The harness is committed at
`application/tests/audit/` and is re-runnable — see [Reproducing](#reproducing-the-audit)._

## Scope

- **Default (no-auth) experience** — the common self-hosted mode (auth off, virtual admin):
  all core triage flows, settings, analytics.
- **Authenticated / role-gated experience** — login, first-admin setup, role gating, API
  keys, env-locked settings. See [Authenticated experience](#authenticated--role-gated-experience).

## Headline result

**No functional regressions were found on any surface.** All 39 routes and tab panels —
including the recently rebuilt diagnosis-first test-execution page and the breaking paginated
test-cases catalog — loaded with **zero uncaught page errors, zero failed same-origin API
calls, and HTTP < 400**. The friction that _was_ found is concentrated in **keyboard
navigation, focus visibility, and a few information-architecture gaps** — all addressed this
pass (see [Fixed this pass](#fixed-this-pass)).

## Findings

Severity: **major** = blocks or badly slows a keyboard/AT user or hides a feature ·
**minor** = friction/inconsistency · **polish** = nice-to-have.

| # | Finding | Category | Severity | Status |
|---|---------|----------|----------|--------|
| 1 | **"Go to" keyboard chords were dead** — `g h`/`g s` never fired because `useDashboard()` (which registers them) was never called. | regression / keyboard | major | ✅ Fixed |
| 2 | **No skip link** — the first Tab stop was the sidebar's "All projects" switcher; it took **30 Tab presses** to reach the first project link on `/projects`. | keyboard / a11y | major | ✅ Fixed |
| 3 | **No visible focus ring** on the collapsible-section toggles that make up the failure-cluster and diagnosis evidence cards — keyboard focus was invisible. | keyboard / a11y | major | ✅ Fixed |
| 4 | **Screenshot & visual-diff thumbnails were mouse-only** — click-only `div`/`img`, so the lightbox couldn't be opened from the keyboard. | keyboard / a11y | major | ✅ Fixed |
| 5 | **Loading & error states were silent to screen readers** — no `role`/`aria-live` on the shared `LoadingState`/`ErrorState` primitives. | a11y | minor | ✅ Fixed |
| 6 | **Buried tab-only features were hard to reach** — Spec health, Timeline, Flaky tests, etc. exist only as `?tab=` panels with no route; the 9-tab project hub is dense. | get-lost / IA | minor | ✅ Fixed (palette) |
| 7 | **Project-page tabs didn't update the URL** — switching tabs on the project hub left the URL unchanged, so a tab wasn't bookmarkable/shareable/reload-safe. Inconsistent with the run and case pages, which already sync via `replace()`. | get-lost / consistency | minor | ✅ Fixed |
| 8 | **Analytics can look empty when it isn't** — the default "Last 30 days" window shows zeroed Portfolio-health with older data. | discoverability | polish | ↦ Recommended |
| 9 | **No loading skeletons; some pages block on top-level `await useFetch`** — slow client navigations show only the thin top progress bar and can feel like a hang. | feedback | polish | ↦ Recommended |

### 1 — Dead keyboard shortcuts (regression)
`application/app/composables/useDashboard.ts` registered `g h`/`g s` chords inside a
`createSharedComposable`, but **nothing ever called `useDashboard()`**, so the chords never
registered. Confirmed live: pressing `g h` on `/projects` did not navigate.
**Fix:** call `useDashboard()` once in the layout and extend the set to mirror the sidebar:
`g h` → Home, `g p` → Projects, `g a` → Analytics, `g s` → Settings. Verified live: `g h` → `/`,
`g p` → `/projects`. (`defineShortcuts` already suppresses chords while typing in a field.)

### 2 — No skip link (quantified)
The first Tab stop was the sidebar "All projects" button, and reaching the first actionable
link in the projects table took **30 Tab presses** — every page forced keyboard/AT users
through the entire sidebar.
**Fix:** a "Skip to main content" link is now the first Tab stop (visually hidden until
focused); activating it moves focus to a sentinel just before the page panel, so the next Tab
lands in the content. Verified live: first Tab now focuses the skip link.

### 3 — Invisible focus on collapsible sections
The failure-cluster page and the diagnosis evidence cards are built almost entirely from
`CollapsibleSectionCard` — `role="button" tabindex="0"` toggles with correct keyboard
activation but **no focus ring**, so a keyboard user couldn't see where they were.
**Fix:** added `focus-visible:outline-2 focus-visible:outline-primary` (the pattern already
used by `LocatorAlternativeRow`). One change benefits ~9 evidence cards. Verified live.

### 4 — Mouse-only thumbnails
`TestEvidenceScreenshots` thumbnails and the three `VisualDiffCard` images opened the
lightbox via `@click` on a `div`/`img` with no keyboard handling.
**Fix:** `role="button"`, `tabindex="0"`, an action `aria-label`, a focus ring, and
`Enter`/`Space` handlers — matching the codebase's existing interactive-element pattern.

### 5 — Screen-reader-silent status
`LoadingState`/`ErrorState` are used hundreds of times but carried no live-region semantics.
**Fix:** `role="status" aria-live="polite" aria-busy="true"` on `LoadingState`; `role="alert"`
on `ErrorState`.

### 6 — Buried features → command palette
Several features (Spec health, Timeline, Flaky tests, Members) exist only as project `?tab=`
panels. The `Cmd/Ctrl+K` palette works well but didn't surface them.
**Fix:** when a project is active, the palette now shows a **"This project"** group deep-linking
to every tab — the fastest keyboard path to the buried panels.

### 7 — Project tabs now sync to the URL (your request)
The run and case pages already reflected the active tab in `?tab=` via `router.replace()`
(so Back returns to the previous _page_, not the previous tab). The **project page did not
sync at all** — switching tabs left the URL stale.
**Fix:** the project page now mirrors that exact pattern — `router.replace({ query: { …, tab } })`
— so tabs are bookmarkable/shareable/reload-safe **without** adding history entries. Verified
live: switching two tabs updates `?tab=` and `history.length` does not grow.

### 8 & 9 — Recommendations (not changed this pass)
- **Analytics empty-window** — consider defaulting the range to "all time" or auto-widening when
  the selected window has no runs, so populated projects don't read as empty.
- **Loading skeletons** — pages that block on top-level `await useFetch` (e.g. `pages/index.vue`)
  would feel faster with `lazy: true` + a skeleton, matching the pattern the sidebar already uses.

## Authenticated / role-gated experience

Audited with a second, isolated auth-enabled instance (`PIWI_AUTH_ENABLED=true`): first-admin
setup, login, and an `administrator` + a `user` account. **This experience is in good shape.**

- **First-admin setup & login are clear.** With auth on and no accounts, `/login` shows a
  "Create the first admin account" form that explains _why_ it's there; afterwards it becomes a
  standard "Sign in" form with "Forgot password?". No friction.
- **Onboarding is auth-aware.** The home "Get started" wizard adds a **"Create an API key"** step
  (explaining the reporter needs a key when auth is on) and injects `apiKey: process.env.PIWI_API_KEY`
  into the generated `playwright.config.ts` snippet. Correct and helpful.
- **Role gating works.** A `user`-role account is redirected to `/` when visiting an `/edit` route;
  admin-only settings pages (Users, Tags, Storage, Wasted time, AI diagnosis) are hidden from the
  settings sub-nav; and the write endpoints (`POST`/`DELETE`/role-change on `/api/users`) are
  admin-gated via the `x-required-roles` route meta that `requireAuth` enforces. **No
  privilege-escalation gap** — a non-admin cannot create or delete accounts.

**Minor consistency nit (low priority, _not_ a security hole):** admin-only settings pages are hidden
from the nav for non-admins but remain reachable by **direct URL**, where they render a **read-only**
view — e.g. a `user` who deep-links `/settings/users` sees the roster (no Add/Delete actions). The
user-list `GET` intentionally allows all roles (`x-required-roles: [administrator, reporter, user]`),
so this is by-design visibility, not an authorization bug. If the roster shouldn't be visible to
non-admins, add a page-level role guard that redirects them (mirroring the `/edit` guard); otherwise
it's harmless.

**Not exercised:** env-locked settings (inputs set via `PIWI_*` vars render read-only with a lock
badge). From the code this is a likely "why can't I edit this?" moment — worth ensuring the lock
tooltip names the controlling env var.

## Fixed this pass

| Fix | Files |
|-----|-------|
| Wire + extend `g`-chords | `app/composables/useDashboard.ts`, `app/layouts/default.vue` |
| Skip link + focus sentinel | `app/layouts/default.vue` |
| "This project" command-palette group | `app/layouts/default.vue` |
| Focus ring on collapsible toggle | `app/components/shared/CollapsibleSectionCard.vue` |
| Keyboard-operable thumbnails / diff images | `app/components/test-case/TestEvidenceScreenshots.vue`, `VisualDiffCard.vue` |
| `aria-live` / roles on status primitives | `app/components/shared/LoadingState.vue`, `ErrorState.vue` |
| Project tabs → URL via `replace()` | `app/pages/projects/[id]/index.vue` |

### Before → after (measured)

| Metric | Before | After |
|--------|--------|-------|
| `g h` / `g p` navigation | dead (no-op) | navigates |
| First Tab stop | sidebar "All projects" button | "Skip to main content" link |
| Bypassing the sidebar (was **30** Tab presses to the first project link) | not possible | skip link is the first stop — one Enter jumps past it |
| Collapsible toggle focus ring | absent | visible |
| Project tab switch → URL | not reflected | `?tab=` via `replace()` (no history growth) |

## A note on static a11y linting

The repo's `oxlint` config has no accessibility rules, and oxlint's a11y (`jsx-a11y`) plugin only
lints JSX/TSX — it does **not** lint `.vue` templates, and there are no `.tsx` files here. So
"add an a11y lint rule" would be inert. Instead, accessibility is enforced **at runtime** by the
committed audit harness (asserting focus visibility, keyboard operability, and non-empty `alt`).
Adding `@axe-core/playwright` for a deeper automated pass is a reasonable future step (new devDep).

## Reproducing the audit

```bash
cd application
npm run app:seed:demo
mkdir -p .data && npm run db:migrate && npm run app:seed:dev
NUXT_IGNORE_LOCK=1 npx nuxt dev --port 3002 &          # seeded dev server, auth off
npx playwright test --config=playwright.audit.config.ts   # sweeps routes + keyboard/a11y
```

The keyboard/a11y specs (`tests/audit/keyboard.audit.ts`) double as before/after checks: they are
red on the pre-fix build and green after. Full-page screenshots land in `audit-screens/`.
