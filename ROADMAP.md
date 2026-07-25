# Roadmap

Piwi Dashboard is under active development (pre-1.0). This page shows direction, not promises — priorities shift with feedback, and the best way to influence them is a [GitHub Discussion](https://github.com/PiwiTests/platform/discussions).

## Recently shipped

- **Import of existing history** — backfill runs recorded before Piwi from Playwright's own blob reports or bare trace
  files, with traces and screenshots, from a page in the dashboard. Imports are idempotent and deliberately silent (no
  notifications, AI diagnosis or regression signals).
- **Automatic data retention & storage efficiency** — opt-in nightly pruning of old runs (`PIWI_RETENTION_DAYS`), notification-outbox and diagnosis-history housekeeping, ingest size caps, and content-addressed dedup of per-failure evidence payloads.
- **AI diagnosis, grounded** — failure-cluster analysis fed by your actual SCM diff, with suggested patches validated server-side against your source; optional two-stage (research → final) pipeline; works with Anthropic, OpenAI, or any OpenAI-compatible endpoint including local models.
- **Locator healing** — element attributes captured on passing runs power ranked replacement locators when a selector breaks.
- **MCP server** — 38 tools so AI agents can query runs, flaky tests, clusters, diagnoses, and traces.
- **Notifications** — email, Slack, webhook (HMAC-signed), and browser channels with per-project subscriptions and digests.
- **Sharding & live streaming** — shards merge automatically via CI run detection; runs stream into the dashboard while CI executes.
- **Ops hardening** — `/api/health` endpoint, Docker `HEALTHCHECK`, committed `docker-compose.yml`, backup & reverse-proxy guides.

## Next

- **First-admin setup UI** — create the initial admin from the browser when auth is enabled (today it's one `POST /api/auth/setup` call).
- **Login rate limiting** — extend the existing throttling (currently on password reset) to login and setup endpoints.
- **1.0 stabilization** — settle the wire format and API surface, then commit to semver stability.

## Exploring

- Deeper CI feedback (PR annotations / status summaries).
- More backend-log instrumentation packages beyond ASP.NET Core and Nitro.
- Merging imported shards of one CI run into a single run (today each shard imports separately).
- A dual ESM/CJS reporter build (the package is CommonJS-only today; named imports work everywhere, but a native ESM default import needs an interop shim).

## Non-goals

- **Other test frameworks** (Cypress, Jest, JUnit…) — Piwi stays Playwright-only; depth over breadth is the point. See [Why Piwi?](https://piwitests.github.io/comparison) for alternatives that aggregate many frameworks.
- **A hosted SaaS** — Piwi is built to be self-hosted; your data stays yours.
