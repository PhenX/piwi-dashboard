import { DEFAULT_INGEST_LIMITS, INGEST_LIMIT_FIELDS, clampIngestLimit } from '#shared/ingest-limits';
import type { IngestLimits } from '#shared/ingest-limits';

/**
 * Resolve the effective ingest storage caps: defaults ← `PIWI_INGEST_MAX_*`
 * env vars (clamped to each field's allowed range).
 *
 * Env-only by design: these caps protect the database against unbounded
 * payloads from arbitrary submitters, so they are a system-administrator
 * concern, not a runtime setting (unlike the AI context limits, which are
 * also editable in Settings → AI). The demo mirror uses
 * `DEFAULT_INGEST_LIMITS` directly — no `process.env` in the worker.
 */
export function resolveIngestLimits(): IngestLimits {
  const limits: IngestLimits = { ...DEFAULT_INGEST_LIMITS };
  for (const field of INGEST_LIMIT_FIELDS) {
    const raw = process.env[field.envVar];
    if (raw == null || raw.trim() === '') continue;
    const clamped = clampIngestLimit(field, raw);
    if (clamped != null) limits[field.key] = clamped;
  }
  return limits;
}
