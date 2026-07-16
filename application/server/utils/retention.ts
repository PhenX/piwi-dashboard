import { inArray, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getDialect } from '../database';
import type { DbClient } from '../database';
import {
  entityLinks,
  failureDiagnoses,
  failureDiagnosisVersions,
  files,
  locatorSnapshots,
  networkRequests,
  notificationDeliveries,
  subscriptions,
  testRuns,
  testRunsCases,
} from '../database/schema';
import { deleteFileRow } from './delete-run-files';
import { recomputeClusterOccurrences } from '#shared/handlers/failure-cluster-ops';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Max ids per IN (...) list — stays well under SQLite's bound-variable limit. */
const ID_BATCH_SIZE = 500;

function* batches<T>(items: T[]): Generator<T[]> {
  for (let i = 0; i < items.length; i += ID_BATCH_SIZE) {
    yield items.slice(i, i + ID_BATCH_SIZE);
  }
}

export interface DeleteRunsResult {
  deletedRuns: number;
  deletedCases: number;
}

/**
 * Delete all test runs older than the cutoff, including their stored files
 * and every dependent row.
 *
 * Child rows are deleted explicitly, in FK order, rather than relying on
 * ON DELETE actions: SQLite databases opened by older versions never had
 * foreign-key enforcement enabled, and file/blob cleanup needs the rows
 * before they disappear. The result is identical on both dialects.
 */
export async function deleteRunsOlderThan(db: DbClient, olderThanDays: number): Promise<DeleteRunsResult> {
  const cutoffDate = new Date(Date.now() - olderThanDays * MS_PER_DAY);

  const oldRuns = await db.select({ id: testRuns.id }).from(testRuns).where(lt(testRuns.startTime, cutoffDate));
  if (oldRuns.length === 0) return { deletedRuns: 0, deletedCases: 0 };
  const runIds = oldRuns.map((r) => r.id);

  const runsCases: { id: number; failureClusterId: number | null }[] = [];
  for (const batch of batches(runIds)) {
    runsCases.push(
      ...(await db
        .select({ id: testRunsCases.id, failureClusterId: testRunsCases.failureClusterId })
        .from(testRunsCases)
        .where(inArray(testRunsCases.testRunId, batch))),
    );
  }
  const caseIds = runsCases.map((c) => c.id);
  const affectedClusterIds = [...new Set(runsCases.filter((c) => c.failureClusterId).map((c) => c.failureClusterId!))];

  // Files first: storage objects (with trace-blob refcounting) need their rows.
  for (const batch of batches(caseIds)) {
    const caseFiles = await db.select().from(files).where(inArray(files.testRunsCaseId, batch));
    for (const file of caseFiles) await deleteFileRow(file);
    await db.delete(files).where(inArray(files.testRunsCaseId, batch));
  }
  for (const batch of batches(runIds)) {
    const runFiles = await db.select().from(files).where(inArray(files.testRunId, batch));
    for (const file of runFiles) await deleteFileRow(file);
    await db.delete(files).where(inArray(files.testRunId, batch));
  }

  // Dependent rows of the doomed cases/runs.
  for (const batch of batches(runIds)) {
    await db.delete(networkRequests).where(inArray(networkRequests.testRunId, batch));
    await db.delete(entityLinks).where(inArray(entityLinks.testRunId, batch));
  }
  for (const batch of batches(caseIds)) {
    await db.delete(entityLinks).where(inArray(entityLinks.testRunsCaseId, batch));
  }

  // Execution-scoped diagnoses (and their version history) die with the case.
  const doomedDiagnosisIds: number[] = [];
  for (const batch of batches(caseIds)) {
    const rows = await db
      .select({ id: failureDiagnoses.id })
      .from(failureDiagnoses)
      .where(inArray(failureDiagnoses.testRunsCaseId, batch));
    doomedDiagnosisIds.push(...rows.map((r) => r.id));
  }
  for (const batch of batches(doomedDiagnosisIds)) {
    await db.delete(failureDiagnosisVersions).where(inArray(failureDiagnosisVersions.diagnosisId, batch));
  }
  for (const batch of batches(caseIds)) {
    await db.delete(failureDiagnosisVersions).where(inArray(failureDiagnosisVersions.testRunsCaseId, batch));
  }
  for (const batch of batches(doomedDiagnosisIds)) {
    await db.delete(failureDiagnoses).where(inArray(failureDiagnoses.id, batch));
  }

  // Locator snapshots survive their run; only the pointer is cleared.
  for (const batch of batches(runIds)) {
    await db
      .update(locatorSnapshots)
      .set({ lastSeenRunId: null })
      .where(inArray(locatorSnapshots.lastSeenRunId, batch));
  }

  for (const batch of batches(runIds)) {
    await db.delete(testRunsCases).where(inArray(testRunsCases.testRunId, batch));
  }
  for (const batch of batches(runIds)) {
    await db.delete(testRuns).where(inArray(testRuns.id, batch));
  }

  for (const clusterId of affectedClusterIds) {
    await recomputeClusterOccurrences(db, clusterId);
  }

  return { deletedRuns: runIds.length, deletedCases: caseIds.length };
}

export interface OrphanSweepResult {
  networkRequests: number;
  entityLinks: number;
  diagnoses: number;
  diagnosisVersions: number;
  notificationDeliveries: number;
}

async function countWhere(db: DbClient, table: SQLiteTable, where: SQL): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(table)
    .where(where);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Delete rows whose parent is already gone. Databases that ran deletes before
 * foreign-key enforcement was enabled (or before the delete paths removed
 * every child table) can hold such orphans; this sweep is idempotent and
 * set-based, so it is safe to run on every retention pass.
 */
export async function sweepOrphans(db: DbClient): Promise<OrphanSweepResult> {
  const orphanedNetworkRequests = sql`NOT EXISTS (SELECT 1 FROM ${testRunsCases} WHERE ${testRunsCases.id} = ${networkRequests.testRunsCaseId})`;
  const orphanedCaseLinks = sql`${entityLinks.testRunsCaseId} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${testRunsCases} WHERE ${testRunsCases.id} = ${entityLinks.testRunsCaseId})`;
  const orphanedRunLinks = sql`${entityLinks.testRunId} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${testRuns} WHERE ${testRuns.id} = ${entityLinks.testRunId})`;
  const orphanedDiagnoses = sql`${failureDiagnoses.testRunsCaseId} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${testRunsCases} WHERE ${testRunsCases.id} = ${failureDiagnoses.testRunsCaseId})`;
  const orphanedVersions = sql`NOT EXISTS (SELECT 1 FROM ${failureDiagnoses} WHERE ${failureDiagnoses.id} = ${failureDiagnosisVersions.diagnosisId})`;
  const orphanedDeliveries = sql`${notificationDeliveries.subscriptionId} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${subscriptions} WHERE ${subscriptions.id} = ${notificationDeliveries.subscriptionId})`;

  const result: OrphanSweepResult = {
    networkRequests: await countWhere(db, networkRequests, orphanedNetworkRequests),
    entityLinks:
      (await countWhere(db, entityLinks, orphanedCaseLinks)) + (await countWhere(db, entityLinks, orphanedRunLinks)),
    diagnoses: await countWhere(db, failureDiagnoses, orphanedDiagnoses),
    diagnosisVersions: await countWhere(db, failureDiagnosisVersions, orphanedVersions),
    notificationDeliveries: await countWhere(db, notificationDeliveries, orphanedDeliveries),
  };

  await db.delete(networkRequests).where(orphanedNetworkRequests);
  await db.delete(entityLinks).where(orphanedCaseLinks);
  await db.delete(entityLinks).where(orphanedRunLinks);
  // Diagnoses first: their version rows then match the orphaned-versions
  // predicate below (and cascade directly where FK enforcement is active).
  await db.delete(failureDiagnoses).where(orphanedDiagnoses);
  await db.delete(failureDiagnosisVersions).where(orphanedVersions);
  await db.delete(notificationDeliveries).where(orphanedDeliveries);

  return result;
}

export interface ReclaimSpaceResult {
  attempted: boolean;
  note: string;
}

/**
 * Give freed pages back to the filesystem after a bulk delete.
 *
 * SQLite: checkpoints the WAL and runs an incremental vacuum (effective only
 * when the database was created with auto_vacuum enabled — fresh databases
 * are; for older ones pass `full: true` to run a blocking full VACUUM).
 * PostgreSQL: a no-op — autovacuum owns space reuse there.
 */
export async function reclaimSpace(db: DbClient, options: { full?: boolean } = {}): Promise<ReclaimSpaceResult> {
  if (getDialect() === 'postgres') {
    return { attempted: false, note: 'PostgreSQL reclaims space via autovacuum' };
  }
  if (options.full) {
    await db.run(sql`VACUUM`);
    return { attempted: true, note: 'full VACUUM completed' };
  }
  await db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
  const autoVacuum = await db.get<{ auto_vacuum: number }>(sql`PRAGMA auto_vacuum`);
  if (autoVacuum?.auto_vacuum) {
    await db.run(sql`PRAGMA incremental_vacuum`);
    return { attempted: true, note: 'incremental vacuum completed' };
  }
  return {
    attempted: false,
    note: 'auto_vacuum is disabled on this database; run cleanup with vacuum:true to reclaim space',
  };
}
