/**
 * Classify (and persist) a flaky test case's root cause from its recent
 * failure evidence. Shared so the server endpoint and the demo's client-side
 * handler run the exact same query + classification + write, never two
 * hand-mirrored copies.
 */
import { eq, and, desc } from 'drizzle-orm';
import { testCases, testRunsCases, testRuns } from '../../server/database/schema';
import { classifyFlakyRootCause, type FlakyRootCause } from '../flaky-classify';
import type { DrizzleDB } from './db';

export async function classifyAndPersistFlakyRootCause(
  db: DrizzleDB,
  projectId: number,
  testCaseId: number,
): Promise<{ testCaseId: number; rootCause: FlakyRootCause }> {
  const tcRows = await db
    .select({ id: testCases.id })
    .from(testCases)
    .where(and(eq(testCases.id, testCaseId), eq(testCases.projectId, projectId)));
  if (tcRows.length === 0) throw new Error('Test case not found');

  const recentFailures = await db
    .select({
      id: testRunsCases.id,
      status: testRunsCases.status,
      error: testRunsCases.error,
      duration: testRunsCases.duration,
      steps: testRunsCases.steps,
      browser: testRunsCases.browser,
      testRunId: testRunsCases.testRunId,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(eq(testRunsCases.testCaseId, testCaseId), eq(testRuns.status, 'failed')))
    .orderBy(desc(testRunsCases.createdAt))
    .limit(50);

  if (recentFailures.length === 0) {
    return { testCaseId, rootCause: 'other' };
  }

  const errorMessages: string[] = [];
  const stepErrors: string[] = [];
  const stepNames: string[] = [];
  const browserDistribution: Record<string, number> = {};

  for (const row of recentFailures) {
    if (row.error) errorMessages.push(row.error);
    const steps = row.steps as Array<{ title: string; category: string; duration: number }> | null;
    if (steps) {
      for (const s of steps) {
        stepNames.push(s.title);
        if (s.title.toLowerCase().includes('error') || s.title.toLowerCase().includes('fail')) {
          stepErrors.push(s.title);
        }
      }
    }
    const b = row.browser as Record<string, unknown> | null;
    const browserKey = (b?.projectName as string) ?? (b?.browserName as string) ?? '';
    if (browserKey) {
      browserDistribution[browserKey] = (browserDistribution[browserKey] ?? 0) + 1;
    }
  }

  const rootCause = classifyFlakyRootCause({
    errorMessages,
    stepErrors,
    stepNames,
    networkErrorCount: 0,
    status5xxCount: 0,
    browserDistribution,
  });

  await db
    .update(testCases)
    .set({ flakyRootCause: rootCause, updatedAt: new Date() })
    .where(eq(testCases.id, testCaseId));

  return { testCaseId, rootCause };
}
