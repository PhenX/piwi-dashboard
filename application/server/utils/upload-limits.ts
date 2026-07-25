import { DEFAULT_MAX_UPLOAD_BYTES, MIN_IMPORT_MAX_BYTES, MAX_IMPORT_MAX_BYTES } from '#shared/upload-limits';

/**
 * Resolve the effective multipart size ceiling: the default, overridable with
 * `PIWI_IMPORT_MAX_BYTES` (clamped to the allowed range).
 *
 * Env-only by design, like the ingest caps: a self-hoster sets it to match
 * whatever their reverse proxy allows, so the import page's pre-flight rejects
 * the same archives the proxy would.
 */
export function resolveMaxUploadBytes(): number {
  const raw = process.env.PIWI_IMPORT_MAX_BYTES;
  if (raw == null || raw.trim() === '') return DEFAULT_MAX_UPLOAD_BYTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_UPLOAD_BYTES;

  return Math.min(MAX_IMPORT_MAX_BYTES, Math.max(MIN_IMPORT_MAX_BYTES, Math.floor(parsed)));
}
