#!/usr/bin/env node
/**
 * Records the demo's committed trace archive and failure video.
 *
 * The demo SPA has no server-side file storage, so the trace and video shown
 * on the seeded checkout failure are real Playwright artifacts committed to
 * the repo (public/demo/traces/, public/demo/videos/). This script regenerates
 * them against a tiny self-contained checkout page served from a throwaway
 * local HTTP server — never a real application, since traces embed full page
 * snapshots.
 *
 * The recorded scenario mirrors the seeded failure cluster: filling the
 * checkout form and clicking "Pay", which surfaces a server error, then a
 * short wait for a confirmation that never appears (the failing action the
 * trace viewer highlights).
 *
 * Usage (from application/):
 *   node scripts/record-demo-media.mjs
 *
 * Output (committed to repo):
 *   public/demo/traces/checkout-pay-timeout.zip
 *   public/demo/videos/checkout-pay-timeout.webm
 */

import { createRequire } from 'module';
import { createServer } from 'http';
import { mkdirSync, copyFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const require = createRequire(import.meta.url);
const pw = require(join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/playwright/index.js'));
const chromium = pw.chromium;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = join(__dirname, '../public/demo/traces');
const VIDEOS_DIR = join(__dirname, '../public/demo/videos');
const EXECUTABLE = process.env.PIWI_DEMO_CHROMIUM || '/opt/pw-browsers/chromium';

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Acme Shop — Checkout</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f4f4f5; margin: 0; padding: 24px; }
  .card { max-width: 380px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  h1 { font-size: 18px; margin: 0 0 16px; }
  label { display: block; font-size: 13px; color: #52525b; margin: 12px 0 4px; }
  input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d4d4d8; border-radius: 6px; font-size: 14px; }
  button { margin-top: 18px; width: 100%; padding: 10px; border: 0; border-radius: 6px; background: #18181b; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  .error { display: none; margin-top: 14px; padding: 10px; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-size: 13px; }
</style>
</head>
<body>
<div class="card">
  <h1>Checkout</h1>
  <div>Total: <strong>$42.00</strong></div>
  <label for="email">Email</label>
  <input id="email" type="email" placeholder="you@example.com">
  <label for="card">Card number</label>
  <input id="card" inputmode="numeric" placeholder="4242 4242 4242 4242">
  <button id="pay">Pay</button>
  <div class="error" id="error">Payment failed: the server returned an error (HTTP 500). Please try again.</div>
</div>
<script>
  document.getElementById('pay').addEventListener('click', () => {
    fetch('/api/payments', { method: 'POST' }).catch(() => {}).finally(() => {
      document.getElementById('error').style.display = 'block';
    });
  });
</script>
</body>
</html>`;

/** Serve the checkout page (and a failing payments API) on an ephemeral port. */
function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/api/payments') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"internal"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE_HTML);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** The recorded interaction, shared by the trace and video captures. */
async function runScenario(page) {
  await page.goto(`${page._demoBaseUrl}/checkout`);
  await page.getByLabel('Email').fill('taylor@example.com');
  await page.getByLabel('Card number').fill('4242 4242 4242 4242');
  await page.getByRole('button', { name: 'Pay' }).click();
  await page.getByText('Payment failed').waitFor();
  // The failing step: the confirmation never appears (mirrors the seeded
  // "waiting for Pay confirmation" timeout cluster). Kept short so the
  // recorded artifacts stay small.
  await page
    .getByText('Order confirmed')
    .waitFor({ timeout: 1500 })
    .catch(() => {});
}

async function main() {
  mkdirSync(TRACES_DIR, { recursive: true });
  mkdirSync(VIDEOS_DIR, { recursive: true });

  const server = await startServer();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    executablePath: EXECUTABLE,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // ── Trace ──────────────────────────────────────────────────────────────
  const traceContext = await browser.newContext({ viewport: { width: 640, height: 480 } });
  await traceContext.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const tracePage = await traceContext.newPage();
  tracePage._demoBaseUrl = baseUrl;
  await runScenario(tracePage);
  const tracePath = join(TRACES_DIR, 'checkout-pay-timeout.zip');
  await traceContext.tracing.stop({ path: tracePath });
  await traceContext.close();

  // ── Video ──────────────────────────────────────────────────────────────
  const videoContext = await browser.newContext({
    viewport: { width: 640, height: 480 },
    recordVideo: { dir: tmpdir(), size: { width: 640, height: 480 } },
  });
  const videoPage = await videoContext.newPage();
  videoPage._demoBaseUrl = baseUrl;
  await runScenario(videoPage);
  await videoPage.waitForTimeout(500);
  const video = videoPage.video();
  await videoContext.close();
  const videoPath = join(VIDEOS_DIR, 'checkout-pay-timeout.webm');
  copyFileSync(await video.path(), videoPath);

  await browser.close();
  server.close();

  for (const file of [tracePath, videoPath]) {
    console.log(`${file} — ${(statSync(file).size / 1024).toFixed(1)} KB`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
