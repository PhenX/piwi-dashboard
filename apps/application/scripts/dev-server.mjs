/**
 * Start the Nuxt dev server fully detached and wait until it responds.
 *
 * Usage: node scripts/dev-server.mjs [port]   |   node scripts/dev-server.mjs --stop [port]
 *
 * - Defaults to port 3000 (the port Playwright's webServer reuses).
 * - Records the spawned PID in `.data/dev-server.pid`; the next start (or
 *   `--stop`) kills that previous instance first, so no manual cleanup.
 * - Refuses to start only when the port is held by a *foreign* process
 *   (usually the Piwi desktop app) — stop that one yourself.
 * - Logs go to `.data/dev-server.log` — watch it for compile errors.
 *
 * The server is launched through PowerShell's `Start-Process` (a new process,
 * hidden window, no inherited handles) so the invoking shell/tool call returns
 * immediately — spawning `cmd`/node directly kept the caller's process tree
 * attached and the call hung.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const stopOnly = args.includes('--stop');
const port = args.find((a) => !a.startsWith('-')) ?? '3000';

const dataDir = path.join(appDir, '.data');
const pidFile = path.join(dataDir, 'dev-server.pid');
const logPath = path.join(dataDir, 'dev-server.log');

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

function startServer() {
  return new Promise((resolve, reject) => {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    // Inherited by Start-Process (no -Environment support on older pwsh).
    process.env.NUXT_IGNORE_LOCK = '1';
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        [
          `$p = Start-Process -FilePath 'npx.cmd'`,
          `-ArgumentList @('nuxt','dev','--port','${port}')`,
          `-WorkingDirectory '${appDir}'`,
          `-WindowStyle Hidden`,
          `-RedirectStandardOutput '${logPath}'`,
          `-RedirectStandardError '${logPath}.err'`,
          `-PassThru;`,
          `Write-Output $p.Id`,
        ].join(' '),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => {
      out += String(d);
    });
    ps.stderr.on('data', (d) => {
      err += String(d);
    });
    ps.on('error', reject);
    ps.on('close', (code) => {
      const pid = Number(out.trim().split(/\s+/).pop());
      if (code === 0 && Number.isInteger(pid) && pid > 0) {
        writeFileSync(pidFile, String(pid));
        resolve(pid);
      } else {
        reject(new Error(`Start-Process failed (code ${code}): ${out} ${err}`));
      }
    });
  });
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

const pid = await startServer();
console.log(`Starting nuxt dev on http://localhost:${port} (pid ${pid}) — logs: .data/dev-server.log`);
const ready = await waitForServer(`http://localhost:${port}/api/projects`);
if (!ready) {
  console.error(`Server did not come up within 90s — check .data/dev-server.log`);
  process.exit(1);
}
console.log(`Dev server ready on http://localhost:${port}`);
