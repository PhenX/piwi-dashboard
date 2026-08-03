#!/usr/bin/env node
/**
 * Captures screenshots of user-facing features against a real dev server — the
 * standard closing step for UI work: every change that adds or visibly reworks
 * a screen gets a scene here, and the captured images go into the final report
 * (see the "Feature screenshots" rule in AGENTS.md).
 *
 * Usage (from application/):
 *   node scripts/take-feature-screenshots.mjs                 # all scenes
 *   node scripts/take-feature-screenshots.mjs <scene> …       # just these
 *   node scripts/take-feature-screenshots.mjs --tag docs      # every docs illustration
 *   node scripts/take-feature-screenshots.mjs --list          # scenes, tags and output files
 *   node scripts/take-feature-screenshots.mjs --check         # docs images vs. scenes, no capture
 *   node scripts/take-feature-screenshots.mjs --url http://localhost:3002
 *   node scripts/take-feature-screenshots.mjs --freeze-now 2026-08-02T09:00:00Z
 *   node scripts/take-feature-screenshots.mjs <scene> --out ../docs/public/screenshots
 *
 * Without --url the script boots its own dev server (desktop UI enabled) on
 * port 3050 and tears it down at the end; a missing dev DB is created and
 * seeded first. With --url it drives the server you point it at.
 *
 * Desktop-only UI is captured by injecting a mocked Tauri IPC bridge into the
 * page, so no shell build is needed. Scenes opt in with `desktop: true` and
 * can shape what the mock answers (linked folder, inspection result).
 *
 * Output goes where the scene's `out` says: `screens` → `.screens/` (gitignored
 * report artifacts) and `docs` → `apps/docs/public/screenshots/` (committed
 * illustrations). `--out <dir>` overrides both.
 */

import { createRequire } from 'module';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { drawAnnotations, clearAnnotations } from './screenshot-annotations.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..');
const DOCS_SHOTS_DIR = join(APP_DIR, '..', 'docs', 'public', 'screenshots');
const PORT = 3050;

/** Where a scene's images land. `screens` is gitignored; `docs` is committed. */
const OUT_TARGETS = {
  screens: join(APP_DIR, '.screens'),
  docs: DOCS_SHOTS_DIR,
};

const DEFAULT_VIEWPORT = { width: 1280, height: 860 };

/**
 * Images in the docs screenshot directory that this harness does not produce,
 * so `--check` does not report them as orphans. Everything else in there must
 * have a scene.
 *
 *   - the hero/gallery images come from the live-demo capture described in
 *     `apps/docs/AGENTS.md` ("Marketing screenshots"), including the
 *     light/dark diagonal split this harness has no equivalent for;
 *   - `ai-diagnosis.png` needs a configured AI provider, which the dev seed
 *     has no answer for — it stays a live-demo capture.
 */
const EXTERNAL_DOCS_IMAGES = new Set([
  'ai-diagnosis.png',
  'demo-live-run-poster.png',
  'failure-cluster-triage.png',
  'failure-cluster.png',
  'failure-clusters-tab.png',
  'flaky-tests.png',
  'home.png',
  'performance.png',
  'project-detail.png',
  'projects.png',
  'test-run.png',
]);

/** What the mocked `desktop_inspect_folder` reports unless a scene overrides it. */
const READY_INSPECTION = {
  path: '/home/dev/code/acme-checkout',
  exists: true,
  packageName: '@acme/checkout',
  suggestedName: 'checkout-web',
  playwrightConfig: 'playwright.config.ts',
  playwrightInstalled: true,
  reporterInstalled: true,
  reporterConfigured: true,
  configuredProjectName: 'checkout-web',
};

/**
 * Scenes: one entry per user-facing feature (or state of it) worth showing.
 *
 * The common case is declarative — a route, an element to capture, done:
 *
 *   { name: 'locator-healing', tags: ['docs'], out: 'docs',
 *     route: '/test-run-cases/13',
 *     expand: ['[data-shot="alternative-locators"]'],
 *     of: '[data-shot="alternative-locators"]', pad: 12 }
 *
 * `run` takes over for anything irregular and calls `shoot(label?)` per capture.
 *
 * Context passed to `run`:
 *   page     — Playwright page, already at `route` with hydration settled
 *   base     — server origin, e.g. http://localhost:3050
 *   shoot    — (label?, opts?) => save `<file>[-<label>].png`; opts.of / opts.pad
 *              override the scene's, opts.clip / opts.fullPage / opts.mask pass
 *              through to Playwright
 *   goto     — (path) => navigate, wait for hydration, settle
 *   settle   — (opts?) => fonts loaded, network quiet, nothing still loading
 *   openTab  — (name, opts?) => click a tab and assert it actually opened
 *   expand   — (selector) => unfold a collapsible section, assert it unfolded
 *   annotate — (shapes) => draw the annotation overlay (see screenshot-annotations.mjs)
 *   clear    — () => remove the overlay, for a clean capture of the same page
 *
 * Scene options:
 *   description — one line, shown by --list
 *   tags        — ['docs'] / ['desktop']; --tag selects on these
 *   out         — 'screens' (default) or 'docs'
 *   file        — output basename, default `<name>.png`
 *   outputs     — every file the scene writes; defaults to `file` plus the
 *                 `-annotated` variant when the scene annotates. --check reads it
 *   route       — initial path (default '/')
 *   prepare     — ({ base, request }) => put the server in the state the shot
 *                 needs, before the page loads; `request` is Playwright's API
 *                 client, so a scene can call an endpoint the UI does not
 *   viewport    — default 1280×860
 *   colorScheme — 'light' | 'dark'
 *   expand      — selectors of collapsible sections to unfold before capturing
 *   of          — selector (or array of them) to capture instead of the viewport
 *   pad         — padding in CSS px around `of`
 *   annotate    — annotation shapes; the scene then writes a `-annotated` image too
 *   charts      — wait for chart geometry to render before capturing
 *   desktop     — inject the mocked Tauri bridge
 *   link        — mocked linked folder for `desktop_get_project_link` (or null)
 *   inspection  — mocked `desktop_inspect_folder` answer (default READY_INSPECTION)
 */
const SCENES = [
  // ── Docs illustrations (committed) ────────────────────────────────────────
  {
    name: 'locator-healing',
    description: 'Alternative locators panel with ranked replacements and a recommended fix',
    tags: ['docs'],
    out: 'docs',
    route: '/test-run-cases/13',
    viewport: { width: 1280, height: 1300 },
    expand: ['[data-shot="alternative-locators"]'],
    of: '[data-shot="alternative-locators"]',
    pad: 12,
  },
  {
    name: 'flaky-detection',
    description: 'Flaky tests tab: composite score, failure rate, retry passes, flip counts',
    tags: ['docs'],
    out: 'docs',
    route: '/projects/1?tab=flaky-tests',
    // Wide enough that the table lays out without its horizontal scroller —
    // the Root cause and Last flake columns the caption promises are the first
    // ones a narrower viewport cuts off.
    viewport: { width: 1800, height: 1000 },
    of: '[data-shot="flaky-table"]',
    pad: 12,
    // No frontend code calls flaky-classify, so Root cause reads "—" for every
    // row until something asks for a classification.
    async prepare({ request, base }) {
      const flaky = await (await request.get(`${base}/api/projects/1/flaky-tests`)).json();
      for (const test of flaky) {
        await request.post(`${base}/api/projects/1/flaky-classify`, { data: { testCaseId: test.testCaseId } });
      }
    },
  },
  {
    name: 'run-insights',
    description: 'Run Insights tab: pass-rate delta, new regressions and new flaky tests',
    tags: ['docs'],
    out: 'docs',
    route: '/test-runs/2?tab=insights',
    viewport: { width: 1280, height: 1560 },
    of: '[data-shot="run-insights"]',
    pad: 12,
    annotate: [
      { type: 'box', target: '[data-shot="run-summary"]', label: 'vs the last passing run' },
      { type: 'step', target: '[data-shot="pass-rate"]', n: 1, corner: 'tl' },
      { type: 'step', target: '[data-shot="new-regressions"]', n: 2, corner: 'tl' },
    ],
  },
  {
    name: 'performance-trends',
    description: 'Performance tab: duration trend chart above the slowest-tests table',
    tags: ['docs'],
    out: 'docs',
    route: '/projects/1?tab=performance',
    viewport: { width: 1400, height: 1480 },
    charts: true,
    of: ['[data-shot="performance-trend"]', '[data-shot="slowest-tests"]'],
    pad: 12,
  },
  {
    name: 'failure-clusters',
    description: 'Failure clusters tab grouping failures by normalized error signature',
    tags: ['docs'],
    out: 'docs',
    route: '/projects/1?tab=failure-clusters',
    // The cluster table needs ~1850px before it stops scrolling sideways, and a
    // clipped table hides the occurrence counts the page is about.
    viewport: { width: 2200, height: 1000 },
    of: '[data-shot="failure-clusters"]',
    pad: 12,
  },
  {
    name: 'test-case-detail',
    description: 'Test case detail: summary stats, duration trend, status history, executions',
    tags: ['docs'],
    out: 'docs',
    route: '/test-cases/1',
    viewport: { width: 1280, height: 1960 },
    charts: true,
    of: '[data-shot="test-case-detail"]',
    pad: 8,
  },

  // ── Desktop shell (report artifacts) ──────────────────────────────────────
  {
    name: 'desktop-nav',
    description: 'Back/forward pair in the sidebar header (desktop shell)',
    tags: ['desktop'],
    desktop: true,
    route: '/projects',
    outputs: ['desktop-nav.png', 'desktop-nav-collapsed.png'],
    async run({ page, shoot, settle }) {
      // Navigate away and back — client-side, a reload would reset the router's
      // history markers — so both directions are enabled in the shot.
      await page.getByRole('link', { name: 'Analytics' }).click();
      await page.waitForURL('**/analytics');
      await settle();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.waitForURL('**/projects');
      await settle();
      await shoot();
      await page.getByRole('button', { name: /collapse sidebar/i }).click();
      await settle();
      await shoot('collapsed', { clip: { x: 0, y: 0, width: 320, height: 560 } });
    },
  },
  {
    name: 'project-from-folder',
    description: 'New-project modal: start from a local folder (desktop shell)',
    tags: ['desktop'],
    desktop: true,
    link: null,
    inspection: { ...READY_INSPECTION, reporterConfigured: false, configuredProjectName: null },
    route: '/projects',
    outputs: ['project-from-folder-empty.png', 'project-from-folder-picked.png'],
    async run({ page, shoot, settle }) {
      await page.getByRole('button', { name: 'New project' }).click();
      await page.getByRole('heading', { name: 'Create new project' }).waitFor();
      await settle();
      await shoot('empty');
      await page.getByRole('button', { name: 'Choose folder…' }).click();
      await page.getByText(READY_INSPECTION.path).first().waitFor();
      await settle();
      await shoot('picked');
    },
  },
  {
    name: 'project-from-folder-mobile',
    description: 'The same modal at phone width',
    tags: ['desktop'],
    desktop: true,
    link: null,
    inspection: { ...READY_INSPECTION, reporterConfigured: false, configuredProjectName: null },
    viewport: { width: 375, height: 812 },
    route: '/projects',
    async run({ page, shoot, settle }) {
      await page.getByRole('button', { name: 'New project' }).click();
      await page.getByRole('heading', { name: 'Create new project' }).waitFor();
      await page.getByRole('button', { name: 'Choose folder…' }).click();
      await page.getByText(READY_INSPECTION.path).first().waitFor();
      await settle();
      await shoot();
    },
  },
  {
    name: 'edit-local-folder',
    description: 'Project settings: linked folder with setup checks (desktop shell)',
    tags: ['desktop'],
    desktop: true,
    link: { path: READY_INSPECTION.path, exists: true },
    route: '/projects/2/edit',
    of: '#local-folder',
    pad: 8,
    outputs: ['edit-local-folder-ready.png'],
    async run({ page, shoot }) {
      await page.getByRole('button', { name: 'Unlink' }).waitFor();
      await shoot('ready');
    },
  },
  {
    name: 'edit-local-folder-needs-setup',
    description: 'The same card when the folder is missing Piwi wiring',
    tags: ['desktop'],
    desktop: true,
    link: { path: READY_INSPECTION.path, exists: true },
    inspection: {
      ...READY_INSPECTION,
      reporterInstalled: false,
      reporterConfigured: false,
      configuredProjectName: null,
    },
    route: '/projects/2/edit',
    of: '#local-folder',
    pad: 8,
    async run({ page, shoot }) {
      await page.getByRole('button', { name: 'Unlink' }).waitFor();
      await shoot();
    },
  },
  {
    name: 'project-folder-card',
    description: 'Project page: compact linked-folder status card (desktop shell)',
    tags: ['desktop'],
    desktop: true,
    link: { path: READY_INSPECTION.path, exists: true },
    route: '/projects/2',
    async run({ page, shoot, settle }) {
      await page.getByText(READY_INSPECTION.path).first().waitFor();
      await settle();
      await shoot();
    },
  },
  {
    name: 'notifications-settings',
    description: 'Notifications settings (auth off): SMTP status, channels, subscriptions; plus the project bell',
    route: '/settings/notifications',
    viewport: { width: 1280, height: 1250 },
    outputs: ['notifications-settings.png', 'notifications-settings-bell.png'],
    async prepare({ base, request }) {
      // One channel + subscription so neither section captures empty. Reruns
      // reuse the rows from the previous run instead of duplicating them.
      const list = await (await request.get(`${base}/api/channels`)).json();
      if (!list.channels.some((c) => c.name === 'Team Slack')) {
        const ch = await (
          await request.post(`${base}/api/channels`, {
            data: {
              name: 'Team Slack',
              type: 'slack',
              config: { webhookUrl: 'https://hooks.slack.com/services/T/B/x' },
            },
          })
        ).json();
        await request.post(`${base}/api/subscriptions`, {
          data: { channelId: ch.channel.id, projectId: 1, events: ['run.failed', 'cluster.new'] },
        });
      }
    },
    async run({ page, shoot, goto, settle }) {
      await shoot();
      await goto('/projects/1');
      await page.getByTitle('Notification subscriptions for this project').click();
      await page.getByText('Browser notifications').waitFor();
      await settle();
      await shoot('bell');
    },
  },
];

/** Output basename for a scene, before any `shoot()` label. */
function sceneFile(scene) {
  return scene.file ?? `${scene.name}.png`;
}

/** Every file a scene writes — what `--check` matches the docs directory against. */
function sceneOutputs(scene) {
  if (scene.outputs) return scene.outputs;
  const base = sceneFile(scene).replace(/\.png$/, '');
  return scene.annotate ? [`${base}.png`, `${base}-annotated.png`] : [`${base}.png`];
}

function outDirFor(scene, override) {
  if (override) return override;
  return OUT_TARGETS[scene.out ?? 'screens'];
}

/** Mocked Tauri IPC bridge, shaped per scene. Mirrors the real shell's commands. */
function bridgeScript(scene) {
  const inspection = scene.inspection ?? READY_INSPECTION;
  const link = scene.link ?? null;
  return `
    window.__mockLink = ${JSON.stringify(link)};
    window.__TAURI__ = {
      core: {
        invoke: (cmd, args) => {
          switch (cmd) {
            case 'desktop_pick_folder':
              return Promise.resolve(${JSON.stringify(inspection.path)});
            case 'desktop_inspect_folder':
              return Promise.resolve({ ...${JSON.stringify(inspection)}, path: args.path });
            case 'desktop_get_project_link':
              return Promise.resolve(window.__mockLink);
            case 'desktop_set_project_link':
              window.__mockLink = args.path ? { path: args.path, exists: true } : null;
              return Promise.resolve(null);
            case 'desktop_get_service_settings':
              return Promise.resolve({ run_in_background: false, start_on_login: false });
            case 'desktop_check_update':
              return Promise.resolve({ state: 'unsupported' });
            case 'desktop_mcp_clients':
              return Promise.resolve([]);
            default:
              return Promise.resolve(null);
          }
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };
  `;
}

async function waitForHydration(page) {
  await page.waitForLoadState('load');
  await page
    .waitForFunction(() => window.useNuxtApp?.().isHydrating === false, undefined, { timeout: 20000 })
    .catch(() => page.waitForTimeout(1500));
}

/**
 * Wait for the page to stop moving: web fonts resolved, no in-flight requests,
 * nothing reporting itself busy, and — when the scene asks — chart geometry
 * actually drawn. Replaces guessing with a timeout.
 */
async function settlePage(page, { charts = false, timeout = 20_000 } = {}) {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout })
    .catch(() => {});
  if (charts) {
    await page.waitForFunction(
      () => {
        const svgs = [...document.querySelectorAll('svg')];
        return svgs.some((svg) => svg.querySelector('path[d], rect[width], circle[r]'));
      },
      undefined,
      { timeout },
    );
  }
  // One frame after the last mutation, so a chart that just mounted has painted.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Attributes the region capture puts on the page, and takes off again. */
const REGION_ATTR = 'data-shot-region';
const KEEP_ATTR = 'data-shot-keep';

/**
 * Mark the nearest common ancestor of `selectors`, and the ancestor's children
 * that lead to one of them. Returns how many targets were resolved.
 *
 * A region is captured by screenshotting that ancestor with its other children
 * hidden, rather than by clipping the viewport: the dashboard scrolls inside a
 * panel instead of moving the document, so `locator.screenshot()` — which
 * scrolls the element into view and stitches one taller than the viewport — is
 * the only primitive that reliably gets the whole thing.
 */
function markRegion({ selectors, regionAttr, keepAttr }) {
  const targets = selectors.map((s) => document.querySelector(s));
  const missing = selectors.filter((_, i) => !targets[i]);
  if (missing.length > 0) return { missing };

  const ancestorsOf = (el) => {
    const chain = [];
    for (let n = el; n; n = n.parentElement) chain.push(n);
    return chain;
  };
  const chains = targets.map(ancestorsOf);
  const common = chains[0].find((candidate) => chains.every((chain) => chain.includes(candidate)));
  // The common ancestor of a single target is the target itself; step up so the
  // capture has somewhere to put the padding.
  const region = targets.length === 1 ? (common.parentElement ?? common) : common;

  region.setAttribute(regionAttr, '');
  for (const child of region.children) {
    if (targets.some((t) => child === t || child.contains(t))) child.setAttribute(keepAttr, '');
  }
  // A grid item stretches to its row's height by default, which is what leaves
  // blank space under a shortened region. `align-self` fixes that, but in a
  // flex column the same property works on the horizontal axis and would
  // narrow the capture instead — so it is applied only for grid parents.
  const parentDisplay = region.parentElement ? getComputedStyle(region.parentElement).display : '';
  return { missing: [], gridParent: parentDisplay === 'grid' || parentDisplay === 'inline-grid' };
}

function unmarkRegion({ regionAttr, keepAttr }) {
  for (const el of document.querySelectorAll(`[${regionAttr}]`)) el.removeAttribute(regionAttr);
  for (const el of document.querySelectorAll(`[${keepAttr}]`)) el.removeAttribute(keepAttr);
}

/**
 * Fail when the capture target is taller than the viewport.
 *
 * An element screenshot of something that does not fit comes back the full
 * height of the element with everything past the viewport left blank, which
 * looks like a page that simply ends — the quiet kind of wrong this harness is
 * meant to rule out. The message names the viewport that would work.
 */
async function assertFitsViewport(page, locator, sceneName, what) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${what} has no bounding box — is it visible?`);
  const viewport = page.viewportSize();
  if (box.height <= viewport.height) return;
  throw new Error(
    `${what} is ${Math.ceil(box.height)}px tall and does not fit the ` +
      `${viewport.width}×${viewport.height} viewport — give scene "${sceneName}" ` +
      `viewport: { width: ${viewport.width}, height: ${Math.ceil(box.height) + 40} }`,
  );
}

/**
 * CSS applied for the capture only: hide everything in the region that is not
 * on the way to a target, and turn `pad` into the region's own padding so the
 * image gets breathing room outside the elements' borders.
 */
function regionStyle(pad, { gridParent = false } = {}) {
  const heightResets = 'height: auto !important; min-height: 0 !important; max-height: none !important;';
  return [
    `[${REGION_ATTR}] > *:not([${KEEP_ATTR}]) { display: none !important; }`,
    // Height resets shrink the region to what the hiding left behind; without
    // them a container stretched to fill its panel hands the capture its own
    // trailing blank space.
    `[${REGION_ATTR}] { padding: ${pad}px !important; margin: 0 !important; ${heightResets} }`,
    gridParent ? `[${REGION_ATTR}] { align-self: start !important; }` : '',
    `[${REGION_ATTR}] > [${KEEP_ATTR}] { ${heightResets} }`,
  ]
    .filter(Boolean)
    .join('\n');
}

function ensureDevDb() {
  if (existsSync(join(APP_DIR, '.data', 'piwi.db'))) return;
  console.log('No dev DB — creating and seeding one (first run only)…');
  if (!existsSync(join(APP_DIR, 'public', 'demo', 'seed.sql'))) {
    execSync('npm run app:seed:demo', { cwd: APP_DIR, stdio: 'inherit' });
  }
  mkdirSync(join(APP_DIR, '.data'), { recursive: true });
  execSync('npm run db:migrate', { cwd: APP_DIR, stdio: 'inherit' });
  execSync('npm run app:seed:dev', { cwd: APP_DIR, stdio: 'inherit' });
}

async function waitForHealth(base, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server at ${base} did not become healthy within ${timeoutMs / 1000}s`);
}

/** Boot a dev server with the desktop UI enabled; returns { base, stop }. */
async function startServer() {
  ensureDevDb();
  const child = spawn('npx', ['nuxt', 'dev', '--port', String(PORT)], {
    cwd: APP_DIR,
    env: { ...process.env, NUXT_IGNORE_LOCK: '1', NUXT_PUBLIC_DESKTOP: 'true' },
    stdio: 'ignore',
    // Detached puts nuxt in its own process group so stop() can kill the whole
    // tree; on Windows npx needs a shell and group-kill is unsupported anyway.
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
  });
  const stop = () => {
    // Negative pid kills the whole nuxt process group where supported.
    try {
      if (process.platform === 'win32') child.kill();
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  };
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });
  const base = `http://localhost:${PORT}`;
  console.log(`Starting dev server at ${base} (desktop UI enabled)…`);
  try {
    await waitForHealth(base);
  } catch (err) {
    stop();
    throw err;
  }
  return { base, stop };
}

function resolveChromium() {
  // The sandboxed environments provide a Chromium via PLAYWRIGHT_BROWSERS_PATH;
  // a normal checkout uses Playwright's own download.
  const provided = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (provided && existsSync(join(provided, 'chromium'))) return join(provided, 'chromium');
  return undefined;
}

/** Levenshtein distance, for suggesting what the user meant by an unknown scene. */
function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

function nearestScenes(name) {
  return SCENES.map((s) => ({ name: s.name, d: editDistance(name, s.name) }))
    .filter((s) => s.d <= Math.max(3, Math.floor(name.length / 2)) || s.name.includes(name))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((s) => s.name);
}

function listScenes() {
  const width = Math.max(...SCENES.map((s) => s.name.length));
  for (const scene of SCENES) {
    const tags = (scene.tags ?? []).join(',') || '—';
    const dir = scene.out ?? 'screens';
    console.log(`${scene.name.padEnd(width)}  [${tags}]  ${scene.description}`);
    console.log(`${' '.repeat(width)}  → ${dir}/${sceneOutputs(scene).join(', ')}`);
  }
}

/**
 * Check the committed docs illustrations against the scene registry: every docs
 * scene must have its image on disk, and every image must have a scene (or be a
 * documented product of the marketing pipeline).
 */
function checkDocsImages() {
  const docsScenes = SCENES.filter((s) => (s.out ?? 'screens') === 'docs');
  const produced = new Map();
  for (const scene of docsScenes) {
    for (const file of sceneOutputs(scene)) produced.set(file, scene.name);
  }

  const onDisk = existsSync(DOCS_SHOTS_DIR) ? readdirSync(DOCS_SHOTS_DIR).filter((f) => f.endsWith('.png')) : [];

  const missing = [...produced.entries()].filter(([file]) => !onDisk.includes(file));
  const orphans = onDisk.filter((f) => !produced.has(f) && !EXTERNAL_DOCS_IMAGES.has(f));
  const staleAllowlist = [...EXTERNAL_DOCS_IMAGES].filter((f) => !onDisk.includes(f));

  for (const [file, scene] of missing) {
    console.error(`missing: ${file} — scene "${scene}" produces it, but it is not committed`);
  }
  for (const file of orphans) {
    console.error(`orphan:  ${file} — no scene produces it; add one, or list it in EXTERNAL_DOCS_IMAGES`);
  }
  for (const file of staleAllowlist) {
    console.error(`stale:   ${file} — listed in EXTERNAL_DOCS_IMAGES but no longer on disk`);
  }

  const problems = missing.length + orphans.length + staleAllowlist.length;
  if (problems === 0) {
    console.log(
      `All good: ${produced.size} image(s) from ${docsScenes.length} scene(s), ` +
        `${EXTERNAL_DOCS_IMAGES.size} from the marketing pipeline.`,
    );
    return true;
  }
  console.error(`\n${problems} problem(s) in ${DOCS_SHOTS_DIR}`);
  return false;
}

function parseArgs(argv) {
  const flags = { scenes: [], tag: null, url: null, out: null, freezeNow: null, list: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') flags.list = true;
    else if (arg === '--check') flags.check = true;
    else if (arg === '--tag') flags.tag = argv[++i];
    else if (arg === '--url') flags.url = argv[++i];
    else if (arg === '--out') flags.out = resolve(process.cwd(), argv[++i]);
    else if (arg === '--freeze-now') flags.freezeNow = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`);
    else flags.scenes.push(arg);
  }
  return flags;
}

function selectScenes(flags) {
  const unknown = flags.scenes.filter((w) => !SCENES.some((s) => s.name === w));
  if (unknown.length) {
    const hints = unknown
      .map((u) => {
        const near = nearestScenes(u);
        return near.length ? `${u} (did you mean ${near.join(', ')}?)` : u;
      })
      .join('; ');
    throw new Error(`unknown scene(s): ${hints} — see --list`);
  }
  let scenes = flags.scenes.length ? SCENES.filter((s) => flags.scenes.includes(s.name)) : SCENES;
  if (flags.tag) {
    scenes = scenes.filter((s) => (s.tags ?? []).includes(flags.tag));
    if (scenes.length === 0) {
      const known = [...new Set(SCENES.flatMap((s) => s.tags ?? []))].join(', ');
      throw new Error(`no scenes tagged "${flags.tag}" — known tags: ${known}`);
    }
  }
  return scenes;
}

/** Run one scene in its own context; returns the number of images written. */
async function captureScene(browser, scene, { base, outDir, freezeNow }) {
  const context = await browser.newContext({
    viewport: scene.viewport ?? DEFAULT_VIEWPORT,
    colorScheme: scene.colorScheme,
  });
  if (freezeNow) await context.clock.setFixedTime(freezeNow);
  if (scene.desktop) await context.addInitScript(bridgeScript(scene));
  const page = await context.newPage();
  // A dev server compiles routes on first hit — well past the 30s default.
  page.setDefaultNavigationTimeout(90_000);

  const settle = (opts = {}) => settlePage(page, { charts: scene.charts, ...opts });

  const goto = async (path) => {
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);
    await settle();
  };

  /** Unfold a collapsible section, and fail loudly if it has no toggle to click. */
  const expand = async (selector) => {
    const toggle = page.locator(`${selector} [role="button"][aria-expanded]`).first();
    await toggle.waitFor({ state: 'visible', timeout: 20_000 });
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    await page
      .locator(`${selector} [role="button"][aria-expanded="true"]`)
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
    await settle();
  };

  /**
   * Open a tab by its visible name and assert it really opened. A renamed or
   * removed tab then fails here instead of capturing whatever screen was
   * already on display.
   */
  const openTab = async (name, { panel } = {}) => {
    const tab = page.getByRole('tab', { name }).first();
    await tab.waitFor({ state: 'visible', timeout: 20_000 });
    await tab.click();
    await page.getByRole('tab', { name, selected: true }).first().waitFor({ timeout: 10_000 });
    if (panel) await page.locator(panel).first().waitFor({ state: 'visible', timeout: 20_000 });
    await settle();
  };

  // Annotations are drawn inside whatever the scene captures, so they stay in
  // register with the content when the capture scrolls to it.
  const annotationHost = typeof scene.of === 'string' ? scene.of : null;
  const annotate = (shapes, opts = {}) => drawAnnotations(page, shapes, { container: annotationHost, ...opts });
  const clear = () => clearAnnotations(page);

  let written = 0;
  const shoot = async (label, opts = {}) => {
    const { of: ofOpt, pad: padOpt, ...pwOpts } = opts;
    const of = ofOpt ?? scene.of;
    const pad = padOpt ?? scene.pad ?? 0;
    const stem = sceneFile(scene).replace(/\.png$/, '');
    const file = join(outDir, `${stem}${label ? `-${label}` : ''}.png`);
    const common = { animations: 'disabled', caret: 'hide', ...pwOpts };

    if (of && !pad && !Array.isArray(of)) {
      const target = page.locator(of).first();
      await assertFitsViewport(page, target, scene.name, of);
      await target.screenshot({ path: file, ...common });
    } else if (of) {
      const selectors = Array.isArray(of) ? of : [of];
      const { missing, gridParent } = await page.evaluate(markRegion, {
        selectors,
        regionAttr: REGION_ATTR,
        keepAttr: KEEP_ATTR,
      });
      if (missing.length > 0) throw new Error(`capture target(s) not found: ${missing.join(', ')}`);
      // Applied as a real stylesheet rather than screenshot's `style` option so
      // the region can be measured in its captured shape before shooting it.
      const styleTag = await page.addStyleTag({ content: regionStyle(pad, { gridParent }) });
      const region = page.locator(`[${REGION_ATTR}]`);
      try {
        await assertFitsViewport(page, region, scene.name, selectors.join(' + '));
        await region.screenshot({ path: file, ...common });
      } finally {
        await styleTag.evaluate((node) => node.remove());
        await page.evaluate(unmarkRegion, { regionAttr: REGION_ATTR, keepAttr: KEEP_ATTR });
      }
    } else {
      await page.screenshot({ path: file, ...common });
    }
    written++;
    console.log(`-> ${file.replace(`${APP_DIR}/`, '').replace(`${APP_DIR}`, '')}`);
  };

  try {
    if (scene.prepare) await scene.prepare({ base, request: context.request });
    await goto(scene.route ?? '/');
    for (const selector of scene.expand ?? []) await expand(selector);
    if (scene.run) {
      await scene.run({ page, base, shoot, goto, settle, openTab, expand, annotate, clear });
    }
    // A declarative scene captures itself; one with `run` has already shot what
    // it wanted, unless it only set up the page for a declarative capture.
    if (!scene.run) await shoot();
    if (scene.annotate) {
      await annotate(scene.annotate);
      await shoot('annotated');
      await clear();
    }
    return written;
  } finally {
    await context.close();
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.list) {
    listScenes();
    return;
  }
  if (flags.check) {
    if (!checkDocsImages()) process.exit(1);
    return;
  }

  const scenes = selectScenes(flags);
  const freezeNow = flags.freezeNow ? new Date(flags.freezeNow) : null;
  if (freezeNow && Number.isNaN(freezeNow.getTime())) {
    throw new Error(`--freeze-now needs an ISO timestamp, got "${flags.freezeNow}"`);
  }

  for (const scene of scenes) mkdirSync(outDirFor(scene, flags.out), { recursive: true });
  const server = flags.url ? { base: flags.url, stop: () => {} } : await startServer();
  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const failures = [];
  let written = 0;
  try {
    for (const scene of scenes) {
      try {
        written += await captureScene(browser, scene, {
          base: server.base,
          outDir: outDirFor(scene, flags.out),
          freezeNow,
        });
      } catch (err) {
        failures.push(scene.name);
        console.error(`scene ${scene.name} failed: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
    server.stop();
  }

  if (failures.length) throw new Error(`scenes failed: ${failures.join(', ')}`);
  console.log(`All done! ${written} image(s) from ${scenes.length} scene(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
