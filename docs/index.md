---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Piwi Dashboard"
  text: "Your Playwright results, kept and explained"
  tagline: "CI throws away every report it makes. Piwi keeps them — then groups the failures by root cause, scores the flaky tests, and finds the locator you should have used. Self-hosted, MIT, zero telemetry."

  actions:
    - theme: brand
      text: Getting started
      link: /getting-started
    - theme: alt
      text: Live demo
      link: https://piwitests.github.io/demo/
    - theme: alt
      text: Core concepts
      link: /concepts
    - theme: alt
      text: GitHub
      link: https://github.com/PiwiTests/platform

features:
  - icon: 🗄️
    title: History that outlives CI
    details: Every run, trace, and HTML report kept and browsable long after the build agent deleted its artifacts — with pass-rate, duration, and stability trends computed across all of them.
  - icon: 🧩
    title: Failure clustering
    details: An error fingerprint collapses forty red tests into the three root causes behind them, grouped across specs and across runs, so one cause is one thing to triage.
  - icon: 📉
    title: Flaky tests, scored and costed
    details: A composite flakiness score with a root-cause class (timing, network, assertion…) and the CI minutes each flake wastes — so you fix the expensive ones, not the annoying ones.
  - icon: 🩹
    title: Locator healing
    details: When a selector breaks, ranked replacements captured from the last passing run, with a recommended fix that matches your existing conventions.
  - icon: 🔬
    title: Evidence in one place
    details: The bundled Playwright trace viewer, screenshots, console, network calls, Web Vitals, and the failing call stack with real source — all served by your own instance.
  - icon: 🤖
    title: AI diagnosis, if you want it
    details: Optional analysis by a provider you configure (a local model works), read against your actual git diff since the last green run, with suggested patches validated against your source. Off by default.
  - icon: 📊
    title: Cross-project analytics
    details: Portfolio health, a pass-rate heatmap, wasted CI minutes, regression velocity, and an auto-generated insights feed — the view you need when someone asks how the suite is doing.
  - icon: 🔒
    title: Yours to run
    details: One Docker container, SQLite or PostgreSQL, local or S3 storage, optional role-based auth. Zero telemetry — the only outbound calls are the ones you configure.
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

<div class="next-steps">

## Where to go next

- **Setting it up** — [Getting started](/getting-started) walks from a Docker command to your first run in the dashboard.
- **Wondering how it models your tests** — [Core concepts](/concepts) defines runs, test cases, executions, and clusters. Worth five minutes before the rest.
- **Wiring up CI** — [CI & sharding](/ci): two environment variables, and why ten shards are one run.
- **Comparing tools** — [Why Piwi?](/comparison) is an honest comparison, including when Piwi isn't the right choice.
- **Running it for a team** — [Deployment](/deployment), [Configuration](/configuration), [Authentication](/authentication), and [Privacy & data flow](/privacy).

Also here, without a card of their own: [live run streaming](/reporter#live-streaming),
[notifications](/notifications) to Slack/email/webhooks, [timeline markers](/timeline-markers) for
annotating trends, [backend log capture](/backend-logs), [Open in IDE](/ide-integration), and an
[MCP server](/mcp) so a coding agent can ask about test health.

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

.next-steps {
  max-width: 1152px;
  margin: 0 auto 64px;
  padding: 40px 24px 0;
  border-top: 1px solid var(--vp-c-divider);
}

.next-steps h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 20px;
}

.next-steps ul {
  padding-left: 1.25rem;
}

.next-steps li {
  margin-bottom: 10px;
  color: var(--vp-c-text-2);
}

@media (max-width: 768px) {
  .screenshot-grid {
    grid-template-columns: 1fr;
  }
}
</style>
