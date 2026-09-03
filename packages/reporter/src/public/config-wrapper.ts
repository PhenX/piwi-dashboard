import * as path from 'node:path';
import * as fs from 'node:fs';
import type { PlaywrightTestConfig } from '@playwright/test';
import { applyOptionsToEnv, readBool, PIWI_ENV_KEYS, PIWI_DEFAULTED_CAPTURE_ENV } from '../internal/config/env.js';
import type { PiwiDashboardOptions } from './options.js';

const PIWI_MODULE = '@piwitests/reporter';

/**
 * Playwright `use` options `wrapConfig` fills in for failure evidence when the
 * config leaves them unset (see `defaultCapture`). A trace and a failure-time
 * screenshot are what the dashboard derives the DOM snapshot, full stack, full
 * network and visual diff from without the capture fixtures.
 */
export const CAPTURE_DEFAULTS = {
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure',
} as const;

type CaptureUse = NonNullable<PlaywrightTestConfig['use']>;

/**
 * Fill the top-level `use` block's `screenshot` / `trace` with the capture
 * defaults when unset, recording which keys were filled in the
 * `PIWI_DEFAULTED_CAPTURE` marker so the reporter can log them once in
 * `onBegin`. An explicit value (including `'off'`) is left untouched, and
 * per-project `use` blocks are never considered. Returns the `use` block to put
 * on the wrapped config — the original reference when nothing changed.
 */
function applyCaptureDefaults(
  use: CaptureUse | undefined,
  piwiOptions: PiwiDashboardOptions | undefined,
): CaptureUse | undefined {
  delete process.env[PIWI_DEFAULTED_CAPTURE_ENV];

  const enabled = piwiOptions?.defaultCapture ?? readBool(process.env[PIWI_ENV_KEYS.defaultCapture]) ?? true;
  if (!enabled) return use;

  const next = { ...use } as CaptureUse;
  const defaulted: string[] = [];
  for (const key of ['screenshot', 'trace'] as const) {
    if ((use as Record<string, unknown> | undefined)?.[key] === undefined) {
      (next as Record<string, unknown>)[key] = CAPTURE_DEFAULTS[key];
      defaulted.push(key);
    }
  }
  if (defaulted.length === 0) return use;

  process.env[PIWI_DEFAULTED_CAPTURE_ENV] = defaulted.join(',');
  return next;
}

function isPiwiReporterEntry(entry: unknown): boolean {
  if (typeof entry === 'string') return entry.toLowerCase().includes('piwi');
  if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0].toLowerCase().includes('piwi');
  return false;
}

function injectReporter(
  reporter: PlaywrightTestConfig['reporter'],
  piwiOptions?: PiwiDashboardOptions,
): PlaywrightTestConfig['reporter'] {
  const piwiEntry: [string] | [string, PiwiDashboardOptions] = piwiOptions ? [PIWI_MODULE, piwiOptions] : [PIWI_MODULE];

  if (!reporter) return [piwiEntry];
  if (Array.isArray(reporter)) {
    if (reporter.some(isPiwiReporterEntry)) return reporter;
    return [...reporter, piwiEntry];
  }
  return [[reporter] as [string], piwiEntry];
}

function resolveSetupModule(): string {
  // In the bundled package this file's code runs from `dist/index.js`, so the
  // global-setup module sits next to it at `dist/global-setup-module.js`. When
  // running from source (dev/tests) it lives one level up as `.ts`. Locate it by
  // probing rather than `require.resolve` so the path survives bundling.
  const candidates = [
    path.join(__dirname, 'global-setup-module.js'),
    path.join(__dirname, '..', 'global-setup-module.js'),
    path.join(__dirname, '..', 'global-setup-module.ts'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
}

/**
 * Wrap a Playwright config to auto-inject the Piwi Dashboard reporter and
 * chain its global setup module. Returns a new config object (shallow merge)
 * without mutating the original.
 *
 * The `globalSetup` field is set to a `string` (or `string[]` if the user
 * already has a global setup) referencing the Piwi global setup module,
 * which registers the run on the server. The original setup path(s) are
 * preserved and executed first.
 *
 * Playwright options required in `globalSetup` are forwarded via `PIWI_*`
 * environment variables (see `applyOptionsToEnv` in `config.ts` for the
 * supported set — `serverUrl`, `projectName`, `verbose`, `apiKey`,
 * `username`, `password`, `environment`, `label`, `runLabel`).
 *
 * The top-level `use` block's `screenshot` and `trace` are defaulted to
 * `'only-on-failure'` / `'retain-on-failure'` when unset so failure evidence is
 * captured without the fixtures; an explicit value (including `'off'`) is kept.
 * Opt out with `defaultCapture: false` (or `PIWI_DEFAULT_CAPTURE=false`).
 *
 * @param config      The user's Playwright config.
 * @param piwiOptions Optional Piwi Dashboard options (serverUrl, projectName, …).
 */
export function wrapConfig<T extends PlaywrightTestConfig>(config: T, piwiOptions?: PiwiDashboardOptions): T {
  if (piwiOptions) applyOptionsToEnv(piwiOptions);

  const globalSetupModules: string[] = [];
  if (config.globalSetup) {
    const orig = Array.isArray(config.globalSetup) ? config.globalSetup : [config.globalSetup];
    globalSetupModules.push(...orig);
  }
  globalSetupModules.push(resolveSetupModule());

  // Forward Piwi's CI-gate options into Playwright's own config so the run
  // exits non-zero locally, with no server round-trip (Playwright 1.52+).
  // The env var is read here rather than via `resolveOptions`: that runs when
  // the *reporter* is constructed, long after Playwright has read this config.
  const forwarded: Record<string, unknown> = {};
  const failOnFlaky = piwiOptions?.failOnFlakyTests ?? readBool(process.env[PIWI_ENV_KEYS.failOnFlakyTests]);
  if (failOnFlaky === true) forwarded.failOnFlakyTests = true;

  // Default the Playwright capture options that unlock trace-derived evidence
  // without the fixtures. `use` is only overridden when a default was actually
  // applied, so an unchanged config keeps its original reference.
  const use = applyCaptureDefaults(config.use, piwiOptions);

  return {
    ...config,
    ...forwarded,
    reporter: injectReporter(config.reporter, piwiOptions),
    globalSetup: globalSetupModules.length === 1 ? globalSetupModules[0] : globalSetupModules,
    ...(use === config.use ? {} : { use }),
  } as T;
}
