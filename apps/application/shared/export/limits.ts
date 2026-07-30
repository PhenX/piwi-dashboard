/**
 * Defaults and bounds for the offline export, mirrored in `PIWI_ENV_VARS`
 * (`tests/unit/piwi-env-vars.test.ts` fails if the two drift).
 */

export const DEFAULT_EXPORT_MAX_INLINE_BYTES = 8 * 1024 * 1024;
export const MIN_EXPORT_MAX_INLINE_BYTES = 64 * 1024;
export const MAX_EXPORT_MAX_INLINE_BYTES = 512 * 1024 * 1024;

export const DEFAULT_EXPORT_MAX_BYTES = 500 * 1024 * 1024;
export const MIN_EXPORT_MAX_BYTES = 1024 * 1024;
export const MAX_EXPORT_MAX_BYTES = 4 * 1024 * 1024 * 1024;

export const DEFAULT_EXPORT_MAX_CASES = 25;
export const MIN_EXPORT_MAX_CASES = 1;
export const MAX_EXPORT_MAX_CASES = 200;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
