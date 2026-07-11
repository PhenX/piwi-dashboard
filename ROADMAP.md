# Roadmap

Piwi Dashboard is under active development (pre-1.0). This page shows direction, not promises — priorities shift with feedback, and the best way to influence them is a [GitHub Discussion](https://github.com/PiwiTests/platform/discussions).

## Recently shipped

- **AI diagnosis, grounded** — failure-cluster analysis fed by your actual SCM diff, with suggested patches validated server-side against your source; optional two-stage (research → final) pipeline; works with Anthropic, OpenAI, or any OpenAI-compatible endpoint including local models.
- **Locator healing** — element attributes captured on passing runs power ranked replacement locators when a selector breaks.
- **MCP server** — 38 tools so AI agents can query runs, flaky tests, clusters, diagnoses, and traces.
- **Notifications** — email, Slack, webhook (HMAC-signed), and browser channels with per-project subscriptions and digests.
- **Sharding & live streaming** — shards merge automatically via CI run detection; runs stream into the dashboard while CI executes.
- **Ops hardening** — `/api/health` endpoint, Docker `HEALTHCHECK`, committed `docker-compose.yml`, backup & reverse-proxy guides.

## Next

- **First-admin setup UI** — create the initial admin from the browser when auth is enabled (today it's one `POST /api/auth/setup` call).
- **Login rate limiting** — extend the existing throttling (currently on password reset) to login and setup endpoints.
- **Automatic data retention** — scheduled pruning of old runs/artifacts (today: manual bulk delete in Settings → Storage).
- **1.0 stabilization** — settle the wire format and API surface, then commit to semver stability.

## Exploring

- Deeper CI feedback (PR annotations / status summaries).
- More backend-log instrumentation packages beyond ASP.NET Core and Nitro.
- Import of existing Playwright JSON reports for teams with history to migrate.
- First-class typed capture fixtures — a published `PiwiFixtures` type (making the reserved `piwiDashboardCapture` name a compile-time collision) and a dual ESM/CJS reporter build.

## Non-goals

- **Other test frameworks** (Cypress, Jest, JUnit…) — Piwi stays Playwright-only; depth over breadth is the point. See [Why Piwi?](https://piwitests.github.io/comparison) for alternatives that aggregate many frameworks.
- **A hosted SaaS** — Piwi is built to be self-hosted; your data stays yours.
