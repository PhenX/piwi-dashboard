#!/usr/bin/env node
/**
 * Captures screenshots of user-facing features against a real dev server — the
 * standard closing step for UI work: every change that adds or visibly reworks
 * a screen gets a scene here, and the captured images go into the final report
 * (see the "Feature screenshots" rule in AGENTS.md).
 *
 * Usage (from application/):
 *   node scripts/take-feature-screenshots.mjs               # all scenes
 *   node scripts/take-feature-screenshots.mjs <scene> …     # just these
 *   node scripts/take-feature-screenshots.mjs --list        # scene names
 *   node scripts/take-feature-screenshots.mjs --url http://localhost:3002
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
 * Output: .screens/<scene>[-<label>].png — gitignored report artifacts. Docs
 * illustrations are the exception: `--out` redirects into the docs assets
 * (which are committed), the only way to picture desktop-only UI the live
 * demo cannot show.
 */

import { createRequire } from 'module';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..');
const OUT_DIR = join(APP_DIR, '.screens');
const PORT = 3050;

const DEFAULT_VIEWPORT = { width: 1280, height: 860 };
/**
 * Docs illustrations use a wider frame than the default: the cluster and flaky
 * tables carry enough columns that 1280px clipped the right-hand ones (type,
 * status, root cause) straight out of the published images.
 */
const DOCS_VIEWPORT = { width: 1600, height: 900 };
/**
 * The cluster and flaky tables are wider still — signature, type, status,
 * occurrences and last-seen alongside a 240px sidebar. 1600px clipped the
 * occurrence count; this frame fits the whole row.
 */
const DOCS_WIDE_VIEWPORT = { width: 1900, height: 900 };

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
 * `run` drives the page and calls `shoot(label?)` for each capture.
 *
 * Context passed to `run`:
 *   page   — Playwright page, already at `base` with hydration settled
 *   base   — server origin, e.g. http://localhost:3050
 *   shoot  — (label?, opts?) => save `.screens/<scene>[-<label>].png`;
 *            opts.clip / opts.fullPage pass through to page.screenshot
 *   goto   — (path) => navigate + wait for hydration
 *
 * Scene options:
 *   route     — initial path (default '/')
 *   viewport  — default 1280×860
 *   desktop   — inject the mocked Tauri bridge
 *   link      — mocked linked folder for `desktop_get_project_link` (or null)
 *   inspection— mocked `desktop_inspect_folder` answer (default READY_INSPECTION)
 */
const SCENES = [
  {
    name: 'desktop-nav',
    description: 'Back/forward pair in the sidebar header (desktop shell)',
    desktop: true,
    route: '/projects',
    async run({ page, shoot }) {
      // Navigate away and back — client-side, a reload would reset the router's
      // history markers — so both directions are enabled in the shot.
      await page.getByRole('link', { name: 'Analytics' }).click();
      await page.waitForURL('**/analytics');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.waitForURL('**/projects');
      await page.waitForTimeout(400);
      await shoot();
      await page.getByRole('button', { name: /collapse sidebar/i }).click();
      await page.waitForTimeout(500);
      await shoot('collapsed', { clip: { x: 0, y: 0, width: 320, height: 560 } });
    },
  },
  {
    name: 'project-from-folder',
    description: 'New-project modal: start from a local folder (desktop shell)',
    desktop: true,
    link: null,
    inspection: { ...READY_INSPECTION, reporterConfigured: false, configuredProjectName: null },
    route: '/projects',
    async run({ page, shoot }) {
      await page.getByRole('button', { name: 'New project' }).click();
      await page.getByRole('heading', { name: 'Create new project' }).waitFor();
      await page.waitForTimeout(300);
      await shoot('empty');
      await page.getByRole('button', { name: 'Choose folder…' }).click();
      await page.getByText(READY_INSPECTION.path).first().waitFor();
      await page.waitForTimeout(300);
      await shoot('picked');
    },
  },
  {
    name: 'project-from-folder-mobile',
    description: 'The same modal at phone width',
    desktop: true,
    link: null,
    inspection: { ...READY_INSPECTION, reporterConfigured: false, configuredProjectName: null },
    viewport: { width: 375, height: 812 },
    route: '/projects',
    async run({ page, shoot }) {
      await page.getByRole('button', { name: 'New project' }).click();
      await page.getByRole('heading', { name: 'Create new project' }).waitFor();
      await page.getByRole('button', { name: 'Choose folder…' }).click();
      await page.getByText(READY_INSPECTION.path).first().waitFor();
      await page.waitForTimeout(300);
      await shoot();
    },
  },
  {
    name: 'edit-local-folder',
    description: 'Project settings: linked folder with setup checks (desktop shell)',
    desktop: true,
    link: { path: READY_INSPECTION.path, exists: true },
    route: '/projects/2/edit',
    async run({ page, shoot }) {
      const card = page.locator('#local-folder');
      await card.waitFor();
      await page.getByRole('button', { name: 'Unlink' }).waitFor();
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await shoot('ready', { clip: await clipFor(card) });
    },
  },
  {
    name: 'edit-local-folder-needs-setup',
    description: 'The same card when the folder is missing Piwi wiring',
    desktop: true,
    link: { path: READY_INSPECTION.path, exists: true },
    inspection: {
      ...READY_INSPECTION,
      reporterInstalled: false,
      reporterConfigured: false,
      configuredProjectName: null,
    },
    route: '/projects/2/edit',
    async run({ page, shoot }) {
      const card = page.locator('#local-folder');
      await card.waitFor();
      await page.getByRole('button', { name: 'Unlink' }).waitFor();
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await shoot(undefined, { clip: await clipFor(card) });
    },
  },
  {
    name: 'project-folder-card',
    description: 'Project page: compact linked-folder status card (desktop shell)',
    desktop: true,
    link: { path: READY_INSPECTION.path, exists: true },
    route: '/projects/2',
    async run({ page, shoot }) {
      await page.getByText(READY_INSPECTION.path).first().waitFor();
      await page.waitForTimeout(400);
      await shoot();
    },
  },

  // ── Docs illustrations ───────────────────────────────────────────────────
  // These scenes are named after the files they produce in
  // apps/docs/public/screenshots/, so re-capturing a docs image is:
  //   node scripts/take-feature-screenshots.mjs <name> --out ../docs/public/screenshots
  // They run against the seeded dev database (project 1, "E2E Checkout").
  // Wider than the default viewport: these screens carry wide tables, and the
  // narrower default clipped their right-hand columns out of the old images.
  {
    name: 'flaky-detection',
    description: 'Docs: project Flaky tests tab (scores, impact, root cause)',
    viewport: DOCS_WIDE_VIEWPORT,
    route: '/projects/1',
    async run({ page, shoot }) {
      await openTab(page, 'Flaky tests');
      await shoot();
    },
  },
  {
    name: 'failure-clusters',
    description: 'Docs: project Failure clusters tab',
    viewport: DOCS_WIDE_VIEWPORT,
    route: '/projects/1',
    async run({ page, shoot }) {
      await openTab(page, 'Failure clusters');
      await shoot();
    },
  },
  {
    name: 'performance-trends',
    description: 'Docs: project Performance tab (duration trend, slowest tests)',
    viewport: DOCS_VIEWPORT,
    route: '/projects/1',
    async run({ page, shoot }) {
      await openTab(page, 'Performance');
      // Charts animate in; settle before capturing.
      await page.waitForTimeout(1200);
      await shoot();
    },
  },
  {
    // The cluster page is a two-column layout, not tabs: Triage is a card in
    // the right rail beside the summary. Capture it whole rather than hunting
    // for a tab that no longer exists.
    name: 'failure-cluster-triage',
    description: 'Docs: failure cluster page — summary, resolution and triage rail',
    viewport: DOCS_VIEWPORT,
    route: '/failure-clusters/1',
    async run({ page, shoot }) {
      await page.getByText('Triage').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await shoot();
    },
  },
  {
    name: 'ai-diagnosis',
    description: 'Docs: failure cluster with its stored AI diagnosis',
    viewport: DOCS_VIEWPORT,
    route: '/failure-clusters/3',
    async run({ page, shoot }) {
      await page
        .getByText(/Diagnosis/i)
        .first()
        .waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1000);
      await shoot();
    },
  },
  {
    name: 'run-insights',
    description: 'Docs: run Insights tab (regressions vs baseline)',
    viewport: DOCS_VIEWPORT,
    route: '/test-runs/1',
    async run({ page, shoot }) {
      await openTab(page, 'Insights');
      await page.waitForTimeout(600);
      await shoot();
    },
  },
  {
    name: 'test-case-detail',
    description: 'Docs: test case history (pass rate, duration trend, status strip)',
    viewport: DOCS_VIEWPORT,
    route: '/test-cases/1',
    async run({ page, shoot }) {
      await page.waitForTimeout(1200);
      await shoot();
    },
  },
  {
    name: 'locator-healing',
    description: 'Docs: alternative locators panel on a failed execution',
    // Tall enough that the expanded panel fits in one frame — a clip taller
    // than the viewport is silently truncated at the fold.
    viewport: { width: 1600, height: 1300 },
    route: '/test-run-cases/1',
    async run({ page, shoot }) {
      // Evidence sections on an execution start collapsed; the header has to be
      // opened before there is anything to picture.
      const header = page.getByText(/Alternative locators/i).first();
      await header.waitFor({ timeout: 30_000 });
      await header.click();
      // The ranked list is what the docs page is actually showing.
      await page
        .getByText(/most stable|Recommended fix/i)
        .first()
        .waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);
      // The heading sits four divs inside the section card that wraps the
      // whole expanded panel — that card is what the docs image shows.
      const section = header.locator('xpath=ancestor::div[4]');
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shoot(undefined, { clip: await clipFor(section) });
    },
  },
];

/**
 * Click one of a page's tabs by visible name and let its panel settle. Tabs are
 * how most docs illustrations reach the screen they show.
 */
async function openTab(page, name) {
  const tab = page.getByRole('tab', { name, exact: false }).first();
  const fallback = page.getByRole('button', { name, exact: false }).first();
  const target = (await tab.count()) ? tab : fallback;
  await target.waitFor({ timeout: 30_000 });
  await target.click();
  await page.waitForTimeout(900);
}

/** Bounding box of a locator, padded a little, for a tight clipped capture. */
async function clipFor(locator, pad = 8) {
  const box = await locator.boundingBox();
  if (!box) return undefined;
  return {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
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

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const scene of SCENES) console.log(`${scene.name.padEnd(34)} ${scene.description}`);
    return;
  }
  const urlIdx = args.indexOf('--url');
  const externalBase = urlIdx !== -1 ? args[urlIdx + 1] : null;
  const outIdx = args.indexOf('--out');
  const outDir = outIdx !== -1 ? resolve(process.cwd(), args[outIdx + 1]) : OUT_DIR;
  const flagValues = new Set([urlIdx, outIdx].filter((i) => i !== -1).map((i) => i + 1));
  const wanted = args.filter((a, i) => !a.startsWith('--') && !flagValues.has(i));
  const scenes = wanted.length ? SCENES.filter((s) => wanted.includes(s.name)) : SCENES;
  const unknown = wanted.filter((w) => !SCENES.some((s) => s.name === w));
  if (unknown.length) throw new Error(`unknown scene(s): ${unknown.join(', ')} — see --list`);

  mkdirSync(outDir, { recursive: true });
  const server = externalBase ? { base: externalBase, stop: () => {} } : await startServer();
  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const failures = [];
  try {
    for (const scene of scenes) {
      const context = await browser.newContext({
        viewport: scene.viewport ?? DEFAULT_VIEWPORT,
        colorScheme: scene.colorScheme,
      });
      if (scene.desktop) await context.addInitScript(bridgeScript(scene));
      const page = await context.newPage();
      // A dev server compiles routes on first hit — well past the 30s default.
      page.setDefaultNavigationTimeout(90_000);

      const goto = async (path) => {
        await page.goto(`${server.base}${path}`, { waitUntil: 'domcontentloaded' });
        await waitForHydration(page);
      };
      const shoot = async (label, opts = {}) => {
        const file = join(outDir, `${scene.name}${label ? `-${label}` : ''}.png`);
        await page.screenshot({ path: file, ...opts });
        console.log(`-> ${file.replace(`${APP_DIR}/`, '')}`);
      };

      try {
        await goto(scene.route ?? '/');
        await scene.run({ page, base: server.base, shoot, goto });
      } catch (err) {
        failures.push(scene.name);
        console.error(`scene ${scene.name} failed: ${err.message}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.stop();
  }

  if (failures.length) throw new Error(`scenes failed: ${failures.join(', ')}`);
  console.log(`All done! Screenshots written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
