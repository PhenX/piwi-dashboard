import { getAppSetting } from './app-settings';
import {
  resolveTimeoutThresholds,
  TIMEOUT_THRESHOLDS_KEY,
  type TimeoutThresholds,
} from '#shared/analytics/timeout-hygiene';
import type { DrizzleDB } from '#shared/handlers/db';

/**
 * Effective timeout-hygiene thresholds: operator overrides stored in
 * `app_settings` merged over the built-in defaults. Malformed values are
 * ignored by `resolveTimeoutThresholds`, so a bad setting can never disable
 * detection.
 */
export async function getTimeoutThresholds(db: DrizzleDB): Promise<TimeoutThresholds> {
  const stored = await getAppSetting<Partial<TimeoutThresholds>>(db, TIMEOUT_THRESHOLDS_KEY);
  return resolveTimeoutThresholds(stored);
}
