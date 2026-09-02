/**
 * Demo-mode diagnosis history + feedback.
 *
 * Mirrors:
 *  - GET  /api/failure-clusters/:id/diagnoses  (previous diagnosis versions)
 *  - PATCH /api/failure-diagnoses/:id/feedback (thumbs up/down, persisted)
 *
 * Both read/write the in-browser seed DB so the version dropdown and the feedback
 * buttons behave like the real dashboard (and survive a reload).
 */

import { eq, desc } from 'drizzle-orm';
import { failureDiagnoses, failureDiagnosisVersions } from '../../../server/database/schema';
import type { DrizzleDB } from '#shared/handlers/db';

/** GET /api/failure-clusters/:id/diagnoses */
export async function listClusterDiagnosisVersions(db: DrizzleDB, clusterId: number) {
  const versions = await db
    .select()
    .from(failureDiagnosisVersions)
    .where(eq(failureDiagnosisVersions.clusterId, clusterId))
    .orderBy(desc(failureDiagnosisVersions.createdAt))
    .limit(50);

  return versions.map((v) => ({
    id: v.id,
    status: v.status,
    category: v.category,
    confidence: v.confidence,
    summary: v.summary,
    rootCause: v.rootCause,
    model: v.model,
    inputTokens: v.inputTokens,
    outputTokens: v.outputTokens,
    durationMs: v.durationMs,
    createdAt: v.createdAt,
  }));
}

/** PATCH /api/failure-diagnoses/:id/feedback */
export async function apiSubmitDiagnosisFeedback(db: DrizzleDB, diagnosisId: number, body?: Record<string, unknown>) {
  const feedbackRaw = (body?.feedback ?? null) as string | null;
  const feedback = feedbackRaw === 'up' || feedbackRaw === 'down' ? feedbackRaw : null;
  const feedbackNote =
    typeof body?.feedbackNote === 'string' && body.feedbackNote.trim() ? body.feedbackNote.trim() : null;

  await db
    .update(failureDiagnoses)
    .set({ feedback, feedbackNote, updatedAt: new Date() })
    .where(eq(failureDiagnoses.id, diagnosisId));

  const [diagnosis] = await db.select().from(failureDiagnoses).where(eq(failureDiagnoses.id, diagnosisId));
  return { success: true, diagnosis };
}
