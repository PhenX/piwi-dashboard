/**
 * `piwi select` / `piwi run` — turn a saved selection into the tests to run.
 *
 * `select` resolves a selection against the dashboard and prints the Playwright
 * arguments (the composable, two-step CI form). `run` resolves and then spawns
 * `playwright test` with those arguments, stamping the run so the dashboard can
 * name the subset and a gate can re-resolve the same definition.
 *
 * A reporting problem must never break the test run: when the dashboard is
 * unreachable, `run` falls back to the full suite (with a warning) and reuses
 * the last good resolution from `.piwi/selection-cache.json` when it has one.
 * `--strict` inverts that for CI, where an unresolvable selection should stop
 * the pipeline. Resolving to zero tests is always an error — a smoke job that
 * silently runs nothing is worse than one that fails loudly.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fetchResolution, resolveProjectId, type SelectionResolution } from '../internal/support/selection-client.js';

const EXIT_OK = 0;
const EXIT_ERROR = 2;

type Resolution = SelectionResolution;

const USAGE = `
piwi select / piwi run — run a saved selection of tests

Usage:
  npx @piwitests/reporter select <key> [options]     print the Playwright args
  npx @piwitests/reporter run <key> [options] [-- <playwright args>]

Connection:
  --server-url <url>    Dashboard URL         (env PIWI_DASHBOARD_URL)
  --api-key <key>       API key               (env PIWI_API_KEY)
  --project <name|id>   Project               (env PIWI_PROJECT_NAME)

Selection:
  --format <fmt>        args (file:line, default) | grep | files | json
  --budget <duration>   Cap total time, e.g. 5m, 90s, 300000 (ms)

Behavior:
  --strict              Fail (exit 2) instead of falling back when unreachable
  --pkg-runner <cmd>    Package runner for the printed command (default npx)
  --json                Print the full resolution as JSON (select only)
  -h, --help            Show this help

Exit codes: 0 ok, 1 the test run failed (run only), 2 could not resolve.
`.trim();

interface SelectArgs {
  serverUrl: string;
  apiKey: string | null;
  project: string;
  key: string;
  format: string;
  budgetMs: number | null;
  strict: boolean;
  pkgRunner: string;
  json: boolean;
  extra: string[];
}

/** Flags that consume the following token as their value. */
const VALUE_FLAGS = new Set(['--server-url', '--api-key', '--project', '--format', '--budget', '--pkg-runner']);

/** Read `--flag value` / `--flag=value`, or undefined when absent. */
function readOption(argv: string[], name: string): string | undefined {
  const withEquals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (withEquals) return withEquals.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith('-') ? value : undefined;
}

/** The first positional argument (the selection key), skipping value-flag values. */
function findKey(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok.startsWith('-')) {
      if (!tok.includes('=') && VALUE_FLAGS.has(tok)) i++;
      continue;
    }
    return tok;
  }
  return undefined;
}

/** Parse a duration like `5m`, `90s`, `1h`, or a plain millisecond count. */
export function parseDuration(raw: string): number | null {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2];
  const factor = unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1000 : 1;
  const ms = Math.round(value * factor);
  return ms > 0 ? ms : null;
}

export function parseSelectArgs(argv: string[], env: NodeJS.ProcessEnv): SelectArgs {
  const dashIndex = argv.indexOf('--');
  const own = dashIndex === -1 ? argv : argv.slice(0, dashIndex);
  const extra = dashIndex === -1 ? [] : argv.slice(dashIndex + 1);

  const serverUrl = (readOption(own, '--server-url') ?? env.PIWI_DASHBOARD_URL ?? '').replace(/\/$/, '');
  if (!serverUrl) throw new Error('No dashboard URL — pass --server-url or set PIWI_DASHBOARD_URL');

  const key = findKey(own);
  if (!key) throw new Error('No selection key — usage: piwi select <key>');

  const budgetRaw = readOption(own, '--budget');
  let budgetMs: number | null = null;
  if (budgetRaw !== undefined) {
    budgetMs = parseDuration(budgetRaw);
    if (budgetMs === null) throw new Error(`--budget expects a duration like 5m or 90s, got "${budgetRaw}"`);
  }

  return {
    serverUrl,
    apiKey: readOption(own, '--api-key') ?? env.PIWI_API_KEY ?? null,
    project: readOption(own, '--project') ?? env.PIWI_PROJECT_NAME ?? '',
    key,
    format: readOption(own, '--format') ?? 'args',
    budgetMs,
    strict: own.includes('--strict'),
    pkgRunner: readOption(own, '--pkg-runner') ?? 'npx',
    json: own.includes('--json'),
    extra,
  };
}

// ── Offline cache ────────────────────────────────────────────────────────────

const CACHE_FILE = path.join('.piwi', 'selection-cache.json');

function cacheKey(projectId: number, args: SelectArgs): string {
  return `${projectId}:${args.key}:${args.format}:${args.budgetMs ?? 0}`;
}

function readCache(projectId: number, args: SelectArgs): Resolution | null {
  try {
    const store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as Record<string, Resolution>;
    return store[cacheKey(projectId, args)] ?? null;
  } catch {
    return null;
  }
}

function writeCache(projectId: number, args: SelectArgs, resolution: Resolution): void {
  try {
    let store: Record<string, Resolution> = {};
    try {
      store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as Record<string, Resolution>;
    } catch {
      // No cache yet — start fresh.
    }
    store[cacheKey(projectId, args)] = resolution;
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2));
  } catch {
    // A cache write failure must never break the command.
  }
}

/** Resolve from the dashboard, then from the cache; null means neither worked. */
async function resolveWithCache(
  args: SelectArgs,
  projectId: number,
): Promise<{ resolution: Resolution; fromCache: boolean } | null> {
  try {
    const resolution = await fetchResolution(args, projectId);
    writeCache(projectId, args, resolution);
    return { resolution, fromCache: false };
  } catch (e) {
    if (args.strict) throw e;
    const cached = readCache(projectId, args);
    if (cached) {
      console.error(`piwi: dashboard unreachable, using cached resolution — ${(e as Error).message}`);
      return { resolution: cached, fromCache: true };
    }
    return null;
  }
}

function printWarnings(resolution: Resolution): void {
  for (const w of resolution.warnings) console.error(`piwi: warning [${w.code}] ${w.message}`);
}

// ── select ───────────────────────────────────────────────────────────────────

export async function runSelect(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return EXIT_OK;
  }

  let args: SelectArgs;
  try {
    args = parseSelectArgs(argv, env);
  } catch (e) {
    console.error(`piwi select: ${(e as Error).message}\n`);
    console.error(USAGE);
    return EXIT_ERROR;
  }

  let resolution: Resolution;
  try {
    const projectId = await resolveProjectId(args);
    resolution = await fetchResolution(args, projectId);
  } catch (e) {
    console.error(`piwi select: ${(e as Error).message}`);
    return EXIT_ERROR;
  }

  printWarnings(resolution);
  if (resolution.estimate.count === 0) {
    console.error(`piwi select: "${args.key}" resolved to 0 tests`);
    return EXIT_ERROR;
  }

  if (args.json) console.log(JSON.stringify(resolution, null, 2));
  else console.log(resolution.materialization.args.join(' '));
  return EXIT_OK;
}

// ── run ──────────────────────────────────────────────────────────────────────

/** Resolve Playwright's CLI so we can spawn it via node — no shell, no quoting. */
function resolvePlaywrightCli(): string | null {
  const require = createRequire(path.join(process.cwd(), 'noop.js'));
  for (const id of ['playwright/cli', '@playwright/test/cli', 'playwright/lib/cli/cli']) {
    try {
      return require.resolve(id);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function spawnPlaywright(pkgRunner: string, playwrightArgs: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const cli = resolvePlaywrightCli();
  const child = cli
    ? spawn(process.execPath, [cli, 'test', ...playwrightArgs], { stdio: 'inherit', env })
    : spawn(process.platform === 'win32' ? `${pkgRunner}.cmd` : pkgRunner, ['playwright', 'test', ...playwrightArgs], {
        stdio: 'inherit',
        env,
      });
  return new Promise((resolve) => {
    child.on('error', (err) => {
      console.error(`piwi run: could not start Playwright — ${err.message}`);
      resolve(EXIT_ERROR);
    });
    child.on('exit', (code) => resolve(code ?? EXIT_ERROR));
  });
}

export async function runRun(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return EXIT_OK;
  }

  let args: SelectArgs;
  try {
    args = parseSelectArgs(argv, env);
  } catch (e) {
    console.error(`piwi run: ${(e as Error).message}\n`);
    console.error(USAGE);
    return EXIT_ERROR;
  }
  if (args.format === 'json') {
    console.error('piwi run: --format json cannot be run; use args, grep or files');
    return EXIT_ERROR;
  }

  let projectId: number;
  try {
    projectId = await resolveProjectId(args);
  } catch (e) {
    if (args.strict) {
      console.error(`piwi run: ${(e as Error).message}`);
      return EXIT_ERROR;
    }
    console.error(`piwi run: ${(e as Error).message} — running the full suite`);
    return spawnPlaywright(args.pkgRunner, args.extra, env);
  }

  let outcome: { resolution: Resolution; fromCache: boolean } | null;
  try {
    outcome = await resolveWithCache(args, projectId);
  } catch (e) {
    console.error(`piwi run: ${(e as Error).message}`);
    return EXIT_ERROR;
  }

  if (!outcome) {
    console.error('piwi run: dashboard unreachable and no cached resolution — running the full suite');
    return spawnPlaywright(args.pkgRunner, args.extra, env);
  }

  const { resolution } = outcome;
  printWarnings(resolution);
  if (resolution.estimate.count === 0) {
    console.error(`piwi run: "${args.key}" resolved to 0 tests`);
    return EXIT_ERROR;
  }

  const runEnv: NodeJS.ProcessEnv = {
    ...env,
    PIWI_SELECTION: resolution.key ?? args.key,
    PIWI_SELECTION_VERSION: String(resolution.version ?? 0),
    PIWI_SELECTION_HASH: resolution.resolvedHash,
    PIWI_SELECTION_COUNT: String(resolution.estimate.count),
  };
  console.error(
    `piwi run: ${args.key} → ${resolution.estimate.count} tests${resolution.materialization.format !== args.format ? ` (materialized as ${resolution.materialization.format})` : ''}`,
  );
  return spawnPlaywright(args.pkgRunner, [...resolution.materialization.args, ...args.extra], runEnv);
}
