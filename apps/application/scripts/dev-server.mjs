/**
 * Start the Nuxt dev server in the background and wait until it responds.
 *
 * Usage: node scripts/dev-server.mjs [port]   |   node scripts/dev-server.mjs --stop [port]
 *
 * - Defaults to port 3000 (the port Playwright's webServer reuses).
 * - Records the spawned PID in `.data/dev-server.pid`; the next start (or
 *   `--stop`) kills that previous instance first, so no manual cleanup.
 * - Refuses to start only when the port is held by a *foreign* process
 *   (usually the Piwi desktop app) — stop that one yourself.
 * - Logs go to `.data/dev-server.log` — watch it for compile errors.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const stopOnly = args.includes('--stop');
const port = args.find((a) => !a.startsWith('-')) ?? '3000';

const dataDir = path.join(appDir, '.data');
const pidFile = path.join(dataDir, 'dev-server.pid');

function killRecorded() {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  rmSync(pidFile, { force: true });
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
    console.log(`Stopped previous dev server (pid ${pid})`);
  } catch {
    // already gone
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: Number(port), host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

killRecorded();
if (stopOnly) {
  console.log('Stopped.');
  process.exit(0);
}

// Give the killed process a moment to release the port.
await new Promise((r) => setTimeout(r, 1500));

if (await portInUse(port)) {
  console.error(`Port ${port} is held by a foreign process — if the Piwi desktop app is running, close it first.`);
  process.exit(1);
}

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const logFd = openSync(path.join(dataDir, 'dev-server.log'), 'w');

const child = spawn(`npx nuxt dev --port ${port}`, {
  cwd: appDir,
  detached: true,
  shell: true,
  stdio: ['ignore', logFd, logFd],
  env: { ...process.env, NUXT_IGNORE_LOCK: '1' },
});
writeFileSync(pidFile, String(child.pid));
child.unref();

console.log(`Starting nuxt dev on http://localhost:${port} (pid ${child.pid}) — logs: .data/dev-server.log`);
const ready = await waitForServer(`http://localhost:${port}/api/projects`);
if (!ready) {
  console.error(`Server did not come up within 90s — check .data/dev-server.log`);
  process.exit(1);
}
console.log(`Dev server ready on http://localhost:${port}`);
