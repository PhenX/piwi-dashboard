/**
 * Single source of truth for snapshotting a `failure_diagnoses` row into
 * `failure_diagnosis_versions` before it is overwritten by a re-diagnose.
 *
 * Both the server (`server/utils/ai-diagnosis.ts#snapshotDiagnosis`) and the demo
 * force-refresh path (`app/demo/api/ai.ts`) build the identical version row, so the
 * field mapping lives here to satisfy the no-duplication rule (AGENTS.md).
 */

/** The subset of a diagnosis row needed to snapshot a version (structurally typed). */
export interface DiagnosisRowForVersion {
  id: number;
  clusterId: number;
  scope: string;
  testRunsCaseId: number | null;
  status: string;
  provider: string | null;
  model: string | null;
  category: string | null;
  confidence: string | null;
  summary: string | null;
  rootCause: string | null;
  details: unknown;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  contextSha?: string | null;
}

/** Build the insert values for a `failure_diagnosis_versions` row from a diagnosis. */
export function buildDiagnosisVersionValues(row: DiagnosisRowForVersion, createdAt: Date = new Date()) {
  return {
    diagnosisId: row.id,
    clusterId: row.clusterId,
    scope: row.scope,
    testRunsCaseId: row.testRunsCaseId ?? null,
    status: row.status,
    provider: row.provider,
    model: row.model,
    category: row.category,
    confidence: row.confidence,
    summary: row.summary,
    rootCause: row.rootCause,
    details: (row.details as Record<string, unknown> | null) ?? null,
    error: row.error,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    durationMs: row.durationMs,
    contextSha: row.contextSha ?? null,
    createdAt,
  };
}
