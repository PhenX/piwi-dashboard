/**
 * Client-side implementation of the wasted-time settings endpoints for demo
 * mode. Mirrors server/api/settings/wasted-waits.{get,put}.ts minus the
 * `PIWI_WASTED_WAIT_PATTERNS` env-var layer (`useRuntimeConfig` has no
 * browser/service-worker equivalent) — the demo is always `envManaged: false`.
 */

import { getDemoDb } from '../db.client';
import { getAppSetting, setAppSetting, deleteAppSetting } from '~~/server/utils/app-settings';
import {
  DEFAULT_WASTED_WAIT_PATTERNS,
  WASTED_WAIT_PATTERNS_KEY,
  parseWastedWaitPatterns,
  resolveStoredWastedPatterns,
} from '#shared/utils/wasted-waits';
import {
  DEFAULT_TIMEOUT_THRESHOLDS,
  TIMEOUT_THRESHOLDS_KEY,
  resolveTimeoutThresholds,
  type TimeoutThresholds,
} from '#shared/analytics/timeout-hygiene';

/** GET /api/settings/wasted-waits */
export async function apiGetWastedWaits() {
  const db = await getDemoDb();
  const stored = await getAppSetting<{ value: string[] }>(db, WASTED_WAIT_PATTERNS_KEY);
  return { ...resolveStoredWastedPatterns(stored), envManaged: false, defaults: [...DEFAULT_WASTED_WAIT_PATTERNS] };
}

/** PUT /api/settings/wasted-waits */
export async function apiPutWastedWaits(body: { patterns?: string[] | string | null }) {
  const db = await getDemoDb();

  if (body.patterns === null) {
    await deleteAppSetting(db, WASTED_WAIT_PATTERNS_KEY);
  } else {
    const patterns = parseWastedWaitPatterns(body.patterns);
    await setAppSetting(db, WASTED_WAIT_PATTERNS_KEY, { value: patterns });
  }

  const stored = await getAppSetting<{ value: string[] }>(db, WASTED_WAIT_PATTERNS_KEY);
  return { ...resolveStoredWastedPatterns(stored), envManaged: false, defaults: [...DEFAULT_WASTED_WAIT_PATTERNS] };
}

/** GET /api/settings/timeout-hygiene */
export async function apiGetTimeoutHygiene() {
  const db = await getDemoDb();
  const stored = await getAppSetting<Partial<TimeoutThresholds>>(db, TIMEOUT_THRESHOLDS_KEY);
  return { thresholds: resolveTimeoutThresholds(stored), defaults: DEFAULT_TIMEOUT_THRESHOLDS };
}

/** PUT /api/settings/timeout-hygiene */
export async function apiPutTimeoutHygiene(body: { thresholds?: Partial<TimeoutThresholds> | null }) {
  const db = await getDemoDb();

  if (body.thresholds === null) {
    await deleteAppSetting(db, TIMEOUT_THRESHOLDS_KEY);
  } else {
    await setAppSetting(db, TIMEOUT_THRESHOLDS_KEY, resolveTimeoutThresholds(body.thresholds));
  }

  const stored = await getAppSetting<Partial<TimeoutThresholds>>(db, TIMEOUT_THRESHOLDS_KEY);
  return { thresholds: resolveTimeoutThresholds(stored), defaults: DEFAULT_TIMEOUT_THRESHOLDS };
}
