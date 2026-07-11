# Capture fixtures example

A small, runnable Playwright project wired to [Piwi Dashboard](https://piwitests.github.io) with the **[capture fixtures](https://piwitests.github.io/capture-fixtures)** — the one-file addition that unlocks slow-endpoint analysis, Web Vitals, console capture, failure-time ARIA snapshots, and locator healing.

It tests a tiny dependency-free web app (`app/server.mjs`, started automatically by Playwright) and exercises **every capture path** the fixtures support.

## Run it

Start a dashboard (see the [getting started guide](https://piwitests.github.io/getting-started)), then:

```bash
npm install
npx playwright install chromium
npm test
```

Results appear at `http://localhost:3000` under the `playwright-fixtures-example` project. Point elsewhere with `PIWI_DASHBOARD_URL` / `PIWI_PROJECT_NAME`.

> **One test fails on purpose.** `failing-locator.spec.ts` clicks a renamed `data-testid` to demonstrate what the fixtures capture on failure — the ARIA snapshot, a fresh locator suggestion (Playwright annotation), and the dashboard's *Alternative locators* panel.

## What each spec demonstrates

| Spec | Capture path |
|------|--------------|
| `home.spec.ts` | The standard `page` fixture: locator actions, `fetch` traffic, page `console.warn` |
| `form.spec.ts` | Labeled form fields → locator snapshots with `getByLabel` alternatives; XHR POST in the network capture |
| `browser-newpage.spec.ts` | Pages created from the worker-scoped `browser` fixture (no `page` fixture) |
| `context-newpage.spec.ts` | Pages created from `browser.newContext()` |
| `popup.spec.ts` | Popup windows (`window.open`) — console + network captured inside the popup |
| `multi-page.spec.ts` | Two pages in one test — Web Vitals attributed to the most recently active page |
| `failing-locator.spec.ts` | **Intentional failure** → ARIA snapshot, locator suggestion, locator healing |
| `console.spec.ts` | `console.warn` / `error` / `assert` captured; `console.log` intentionally not |
| `slow-endpoint.spec.ts` | A slow API call plus `/api/users/1` and `/api/users/2` — grouped as `/api/users/:id` in the *Slow endpoints* tab |
| `skipped.spec.ts` | Skipped tests produce no capture attachments |
| `before-all.spec.ts` | `beforeAll` activity is intentionally **not** captured |
| `custom-fixtures.spec.ts` | Dashboard capture composed with your own fixtures (`fixtures-composed.ts`) |

## The two setup options

- `tests/fixtures.ts` — **Option A**: `base.extend(piwiFixtures)`
- `tests/fixtures-composed.ts` — **Option B + composition**: `extendPiwiFixtures(base).extend<MyFixtures>({ … })`

Every spec imports `test` from one of these files — never from `@playwright/test` directly. That import is what switches capture on.

## The two reporter wirings

- `playwright.config.ts` — **recommended**: `wrapConfig` injects the reporter + global setup (`npm test`)
- `playwright.manual-reporter.config.ts` — plain `reporter` array (`npm run test:manual-reporter`)
