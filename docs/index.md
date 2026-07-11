---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Piwi Dashboard"
  text: "Self-hosted Playwright observability"
  tagline: "Understand and fix failures — don't just watch them. Failure clustering, flaky-test scoring, locator healing, and optional AI diagnosis on top of your Playwright results. Self-hosted, no SaaS, no lock-in."
  image: /logo-wide.svg

  actions:
    - theme: brand
      text: Getting started
      link: /getting-started
    - theme: alt
      text: Live demo
      link: https://piwitests.github.io/demo/
    - theme: alt
      text: GitHub
      link: https://github.com/PiwiTests/platform

features:
  - icon: 🧩
    title: Failure clustering
    details: Identical failures are grouped across specs by an error fingerprint, so one root cause is one thing to triage — not fifty scattered red tests.
  - icon: 🤖
    title: AI failure diagnosis
    details: Optional, opt-in analysis grounded in your actual git diff since the last green run — with suggested-fix patches validated server-side. Runs against your own provider (or a local model); nothing leaves your server unless you configure it.
  - icon: 📉
    title: Flaky-test analytics
    details: Composite flakiness score with root-cause classes (timing, network, assertion…) and CI-cost impact ranking, so you fix the flakes that actually waste the most CI minutes first.
  - icon: 🩹
    title: Locator healing
    details: When a locator breaks, get ranked replacement locators captured from prior passing runs — with a convention-preserving recommended fix and a data-testid nudge when nothing is stable.
  - icon: 🎬
    title: Self-hosted trace viewer
    details: Open the full Playwright trace viewer straight from a failure — bundled and served by the dashboard, so traces never leave your server.
  - icon: 🔔
    title: Notifications & alerts
    details: Email, Slack, webhook, and in-browser notifications for failed runs and new failure clusters, with per-project subscriptions, filters, and digest mode.
  - icon: ⚡
    title: Live run streaming
    details: Watch a run update in real time over SSE as each test finishes — no polling, no waiting on CI to upload an artifact.
  - icon: 📈
    title: Performance tracking
    details: Step-level timing, avg/P90 duration trends, slowest-tests analysis, and side-by-side run comparison.
  - icon: 🌐
    title: Network & Web Vitals
    details: Slow API endpoints grouped by method and normalized route, plus Core Web Vitals (TTFB, FCP, CLS…) with color-coded thresholds.
  - icon: 🔌
    title: Drop-in reporter
    details: Add one reporter to your Playwright config and results, HTML reports, and traces upload automatically after each run.
  - icon: 🤝
    title: MCP server for AI agents
    details: Query runs, failures, clusters, and flaky tests from Claude Code or any MCP client — bring test health into your coding agent.
  - icon: 🐳
    title: Self-hosted, your data
    details: One ~400 MB Docker image, SQLite or PostgreSQL, local or S3-compatible storage, optional role-based auth. Zero telemetry — nothing phones home.
---

<div class="screenshots">

## See it in action

<div class="demo-video">
  <video src="/demo-live-run.mp4" autoplay loop muted playsinline controls poster="/screenshots/demo-live-run-poster.png"></video>
  <p class="screenshot-caption">Live streaming — a run updating in real time as tests complete. No polling, no waiting on CI to finish.</p>
</div>

<div class="screenshot-grid">
  <div class="screenshot-item screenshot-featured">
    <img src="/screenshots/home.png" alt="Dashboard overview — stats and test results trend chart" />
    <p class="screenshot-caption">Dashboard overview — at-a-glance stats and a test results trend chart across all projects</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/projects.png" alt="Projects list" />
    <p class="screenshot-caption">Projects list — last-run status, duration, and test pass/fail ratio for every project</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/project-detail.png" alt="Project detail" />
    <p class="screenshot-caption">Project detail — complete run history with status badges and test breakdown</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/performance.png" alt="Performance page" />
    <p class="screenshot-caption">Performance — avg/P90 duration trend, slowest tests ranking, and side-by-side run comparison</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/test-run.png" alt="Test run detail" />
    <p class="screenshot-caption">Test run detail — every test case with status, duration, location, and error messages</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/failure-clusters-tab.png" alt="Failure clusters" />
    <p class="screenshot-caption">Failure clusters — tests sharing the same root cause are grouped by error fingerprint</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/flaky-tests.png" alt="Flaky tests" />
    <p class="screenshot-caption">Flaky tests — composite flakiness score with retry-pass and alternation detection</p>
  </div>
  <div class="screenshot-item">
    <img src="/screenshots/failure-cluster-triage.png" alt="Cluster triage" />
    <p class="screenshot-caption">Cluster triage — set status, write triage notes, and track resolution</p>
  </div>
</div>

</div>

<div class="cta-footer">
  <h2>Stop losing your test history.</h2>
  <p>Self-hosted in one Docker command — your data, your infrastructure, nothing vanishes when CI finishes.</p>
  <div class="cta-footer-actions">
    <a class="cta-btn cta-btn-brand" href="/getting-started">Get started</a>
    <a class="cta-btn cta-btn-alt" href="https://github.com/PiwiTests/platform">View on GitHub</a>
  </div>
</div>

<style>
.screenshots {
  max-width: 1152px;
  margin: 0 auto;
  padding: 48px 24px;
}

.screenshots h2 {
  font-size: 2rem;
  font-weight: 700;
  text-align: center;
  margin-bottom: 40px;
}

.screenshot-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.screenshot-featured {
  grid-column: 1 / -1;
}

.demo-video {
  margin-bottom: 40px;
}

.demo-video video {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  display: block;
  background: #000;
}

.screenshot-item img {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  display: block;
}

.screenshot-caption {
  margin-top: 10px;
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  text-align: center;
}

.cta-footer {
  max-width: 1152px;
  margin: 0 auto 64px;
  padding: 56px 24px;
  text-align: center;
  border-top: 1px solid var(--vp-c-divider);
}

.cta-footer h2 {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 12px;
}

.cta-footer p {
  color: var(--vp-c-text-2);
  font-size: 1rem;
  margin-bottom: 28px;
}

.cta-footer-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.vp-doc .cta-btn {
  display: inline-block;
  border-radius: 20px;
  padding: 10px 24px;
  font-size: 0.95rem;
  font-weight: 600;
  border: 1px solid transparent;
  text-decoration: none;
  transition: border-color 0.25s, color 0.25s, background-color 0.25s;
}

.cta-btn-brand {
  background-color: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
}

.cta-btn-brand:hover {
  background-color: var(--vp-button-brand-hover-bg);
}

.cta-btn-alt {
  background-color: var(--vp-button-alt-bg);
  color: var(--vp-button-alt-text);
  border-color: var(--vp-button-alt-border);
}

.cta-btn-alt:hover {
  background-color: var(--vp-button-alt-hover-bg);
}

@media (max-width: 768px) {
  .screenshot-grid {
    grid-template-columns: 1fr;
  }
}
</style>
