import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { projects, testRuns, testRunsCases, testCases, files, traceBlobs } from '../../database/schema';
import type { Project } from '../../database/schema';
import { requireAuth } from '../../utils/auth';
import { getStorage } from '../../storage';
import { getProjectScope, scopeAllows } from '../../utils/project-access';
import { resolveMaxUploadBytes } from '../../utils/upload-limits';
import { sanitizeFilename } from '../../utils/sanitize-filename';
import { sanitizeMetadata } from '../../utils/sanitize';
import { persistRunCases } from '../../utils/persist-run-cases';
import { upsertTraceBlob } from '../../utils/trace-blobs';
import { parseBlobReport, readBlobEntry, BlobReportError, type ImportedRunCase } from '../../utils/blob-report';
import { parseTraceArchive, looksLikeTrace, resolveSpecPath, TraceImportError } from '../../utils/trace-import';
import { parseZipDirectory } from '../../utils/trace-zip';
import { parseErrorContext, consoleLogsFromTrace } from '../../utils/import-evidence';
import { parseTraceEvents } from '../../utils/trace-parser';
import { runEventBus } from '../../utils/run-events';
import type { ZipEntryMeta } from '../../utils/trace-zip';
import { durationStats } from '#shared/utils/stats';
import { sumFailedAndTimedOut } from '#shared/utils/test-counts';
import { joinSuitePath } from '#shared/utils/suites';
import { formatBytes } from '#shared/utils/format-bytes';
import type { ImportRunResponse } from '#shared/import.types';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Import a historical Playwright blob report or trace',
    description:
      'Import one archive as historical results. A blob report (blob-report/report-*.zip) becomes a complete run with its traces and attachments. A bare trace (trace.zip) becomes a single execution; pass the same importGroup with several traces to gather them into one run. Intended for backfilling runs recorded before Piwi was adopted: re-importing the same archive is a no-op, and imports deliberately do not trigger notifications, AI diagnosis or regression signals.',
    'x-required-roles': ['administrator'],
    requestBody: {
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              projectName: { type: 'string' },
              archive: { type: 'string', format: 'binary', description: 'A blob report or trace .zip' },
              environment: { type: 'string' },
              label: { type: 'string' },
              importGroup: {
                type: 'string',
                description:
                  'Hex SHA-256 grouping key. Traces sharing one land in a single run; ignored for blob reports.',
              },
            },
            required: ['projectName', 'archive'],
          },
        },
      },
    },
  },
});

/** One trace already written to the blob store, waiting for its case row. */
interface StoredTrace {
  path: string;
  blobId: number;
  size: number;
}

export default eventHandler(async (event) => {
  const user = await requireAuth(event);

  const maxUploadBytes = resolveMaxUploadBytes();
  const contentLength = parseInt(getRequestHeader(event, 'content-length') ?? '0', 10);
  if (contentLength > maxUploadBytes) {
    throw createError({ statusCode: 413, message: `Archive too large (max ${formatBytes(maxUploadBytes)})` });
  }

  const formData = await readMultipartFormData(event);
  if (!formData) throw createError({ statusCode: 400, message: 'No form data provided' });

  let projectName: string | undefined;
  let environment: string | null = null;
  let label: string | null = null;
  let importGroup: string | null = null;
  let archive: { filename: string; data: Buffer } | undefined;

  for (const part of formData) {
    if (part.name === 'projectName') projectName = part.data.toString('utf-8').trim();
    else if (part.name === 'environment') environment = part.data.toString('utf-8').trim() || null;
    else if (part.name === 'label') label = part.data.toString('utf-8').trim() || null;
    else if (part.name === 'importGroup') {
      const value = part.data.toString('utf-8').trim().toLowerCase();
      if (/^[0-9a-f]{64}$/.test(value)) importGroup = value;
    } else if (part.name === 'archive' && part.filename) {
      archive = { filename: sanitizeFilename(part.filename), data: part.data };
    }
  }

  if (!projectName || !archive) {
    throw createError({ statusCode: 400, message: 'Missing required fields: projectName, archive' });
  }
  if (archive.data.length === 0) {
    throw createError({ statusCode: 400, message: 'The uploaded archive is empty' });
  }
  if (archive.data.length > maxUploadBytes) {
    throw createError({ statusCode: 413, message: `Archive too large (max ${formatBytes(maxUploadBytes)})` });
  }

  // Hashed server-side rather than trusted from the client: this is the
  // idempotency key, so a wrong value would let the same archive import twice.
  const importHash = createHash('sha256').update(archive.data).digest('hex');

  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);
  const storage = getStorage();

  const existingProjects = await db.select().from(projects).where(eq(projects.name, projectName));
  let project: Project | undefined = existingProjects[0];

  if (project) {
    if (!scopeAllows(scope, project.id)) {
      throw createError({ statusCode: 403, message: 'No access to this project' });
    }
  } else {
    if (scope !== 'all') {
      throw createError({ statusCode: 403, message: 'Cannot create a new project — no global access' });
    }
    const created = await db.insert(projects).values({ name: projectName }).returning();
    project = created[0];
  }
  if (!project) throw createError({ statusCode: 500, message: 'Failed to create or retrieve project' });

  const duplicate = await findImportedRun(db, project.id, importHash);
  if (duplicate) return duplicate;

  // Both kinds of archive are ZIPs; only their contents tell them apart.
  let entryNames: string[];
  try {
    entryNames = parseZipDirectory(archive.data).map((meta) => meta.name);
  } catch (error) {
    throw createError({ statusCode: 400, message: `Not a readable ZIP archive: ${(error as Error).message}` });
  }

  if (!entryNames.includes('report.jsonl')) {
    if (!looksLikeTrace(entryNames)) {
      throw createError({
        statusCode: 400,
        message:
          'Unrecognised archive: expected a Playwright blob report (blob-report/report-*.zip) or a trace file (trace.zip).',
      });
    }
    return await importTraceArchive({
      db,
      project,
      archive,
      importHash,
      importGroup,
      environment,
      label,
    });
  }

  let parsed;
  try {
    parsed = await parseBlobReport(archive.data);
  } catch (error) {
    if (error instanceof BlobReportError) throw createError({ statusCode: 400, message: error.message });
    throw createError({ statusCode: 400, message: `Could not read the archive: ${(error as Error).message}` });
  }

  if (parsed.cases.length === 0) {
    throw createError({ statusCode: 400, message: 'The archive contains no test results' });
  }

  await storage.mkdir(`project-${project.id}`);

  // Recover per-case evidence and move traces into the blob store before the
  // rows exist: the evidence lands on the case columns, and hashing the trace
  // here means each archive entry is decompressed exactly once.
  const storedTraces = new Map<number, StoredTrace[]>();
  for (const [index, entry] of parsed.cases.entries()) {
    await recoverErrorContext(archive.data, parsed.entries, entry);

    const traces: StoredTrace[] = [];
    for (const [traceIndex, ref] of entry.traces.entries()) {
      const bytes = await readBlobEntry(archive.data, parsed.entries, ref.entry);
      if (!bytes) continue;
      // The first trace covers the execution itself; read it once and take both
      // the console entries and the stored blob from the same bytes.
      if (traceIndex === 0) await recoverConsoleLogs(bytes, entry);
      try {
        const hash = createHash('sha256').update(bytes).digest('hex');
        const blob = await upsertTraceBlob(project.id, hash, bytes);
        traces.push({ path: blob.path, blobId: blob.id, size: blob.size });
      } catch (error) {
        console.error(`[Import] Failed to store trace ${ref.entry}: ${error}`);
      }
    }
    if (traces.length) storedTraces.set(index, traces);
  }

  let testRunId: number;
  try {
    const inserted = await db
      .insert(testRuns)
      .values({
        projectId: project.id,
        status: parsed.status,
        startTime: parsed.startTime,
        duration: parsed.duration,
        totalTests: parsed.totalTests,
        passedTests: parsed.passedTests,
        failedTests: sumFailedAndTimedOut(parsed.failedTests, parsed.timedOutTests),
        skippedTests: parsed.skippedTests,
        didNotRunTests: parsed.didNotRunTests,
        flakyTests: parsed.flakyTests,
        environment,
        label,
        playwrightVersion: parsed.playwrightVersion,
        importHash,
        metadata: sanitizeMetadata({
          import: {
            source: archive.filename,
            importedAt: new Date().toISOString(),
            blobVersion: parsed.blobVersion,
            ...(parsed.shard ? { shard: parsed.shard } : {}),
          },
        }),
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('insert returned no row');
    testRunId = row.id;
  } catch (error) {
    // Another request imported the same archive between the check and here —
    // the unique (project_id, import_hash) index is the arbiter.
    const raced = await findImportedRun(db, project.id, importHash);
    if (raced) return raced;
    console.error('[Import] Failed to create the run', error);
    throw createError({ statusCode: 500, message: 'Failed to create the imported test run' });
  }

  const insertedCases = await persistRunCases(
    db,
    project.id,
    testRunId,
    parsed.cases.map((entry) => entry.case),
  );

  // Files are linked by position, which only holds when every case produced a
  // row. A repeatEach run can collide on the junction's unique key and drop
  // one; linking anyway would attach evidence to the wrong test.
  const aligned = insertedCases.length === parsed.cases.length;
  if (!aligned) {
    console.warn(
      `[Import] ${parsed.cases.length - insertedCases.length} of ${parsed.cases.length} executions were deduplicated; skipping file links for run #${testRunId}`,
    );
  }

  let traceCount = 0;
  let attachmentCount = 0;

  if (aligned) {
    const runPath = `project-${project.id}/run-${testRunId}`;
    await storage.mkdir(runPath);

    for (const [index, entry] of parsed.cases.entries()) {
      const testRunsCaseId = insertedCases[index]?.id;
      if (!testRunsCaseId) continue;

      for (const trace of storedTraces.get(index) ?? []) {
        await db.insert(files).values({
          testRunsCaseId,
          testRunId,
          type: 'trace',
          path: trace.path.replace(/\\/g, '/'),
          size: trace.size,
          blobId: trace.blobId,
        });
        traceCount++;
      }

      for (const ref of entry.attachments) {
        const bytes = await readBlobEntry(archive.data, parsed.entries, ref.entry);
        if (!bytes) continue;
        try {
          const dir = `${runPath}/${testRunsCaseId}`;
          await storage.mkdir(dir);
          const storagePath = `${dir}/${sanitizeFilename(ref.entry.split('/').pop() || 'attachment')}`;
          await storage.writeFile(storagePath, bytes);
          await db.insert(files).values({
            testRunsCaseId,
            testRunId,
            type: 'attachment',
            subtype: ref.name,
            label: ref.contentType,
            path: storagePath.replace(/\\/g, '/'),
            size: bytes.length,
          });
          attachmentCount++;
        } catch (error) {
          console.error(`[Import] Failed to store attachment ${ref.entry}: ${error}`);
        }
      }
    }
  }

  const stats = durationStats(parsed.cases.map((entry) => entry.case.duration));
  if (stats) {
    await db
      .update(testRuns)
      .set({ avgTestDuration: stats.avg, p90TestDuration: stats.p90 })
      .where(eq(testRuns.id, testRunId));
  }

  // Deliberately no notifications, AI diagnosis or regression signals: a
  // backfill of old runs would page the team about failures they already know
  // about, burn AI credits, and label months-old failures as new regressions.
  runEventBus.publishGlobal({
    type: 'run-submitted',
    runId: testRunId,
    projectId: project.id,
    status: parsed.status,
  });

  console.log(
    `[Import] Run #${testRunId} imported from ${archive.filename}: ` +
      `${parsed.totalTests} executions, ${traceCount} traces, ${attachmentCount} attachments`,
  );

  return {
    status: 'imported',
    kind: 'blob-report',
    testRunId,
    projectId: project.id,
    runStatus: parsed.status,
    startTime: parsed.startTime.toISOString(),
    totalTests: parsed.totalTests,
    passedTests: parsed.passedTests,
    failedTests: sumFailedAndTimedOut(parsed.failedTests, parsed.timedOutTests),
    skippedTests: parsed.skippedTests,
    didNotRunTests: parsed.didNotRunTests,
    flakyTests: parsed.flakyTests,
    traceCount,
    attachmentCount,
    playwrightVersion: parsed.playwrightVersion,
    projectNames: parsed.projectNames,
    filePaths: [...new Set(parsed.cases.map((entry) => entry.case.filePath))].sort().slice(0, 20),
    shard: parsed.shard,
  } satisfies ImportRunResponse;
});

/**
 * Import one bare trace as an execution.
 *
 * A trace knows nothing of the run it belonged to, so the caller decides how
 * they group: with an `importGroup`, every trace uploaded under it lands in one
 * run (the usual case — a folder of traces from a single CI job); without one,
 * each trace becomes its own single-test run.
 */
async function importTraceArchive(input: {
  db: Awaited<ReturnType<typeof getDatabase>>;
  project: Project;
  archive: { filename: string; data: Buffer };
  importHash: string;
  importGroup: string | null;
  environment: string | null;
  label: string | null;
}): Promise<ImportRunResponse> {
  // No storage handle: a trace goes straight into the deduped blob store, which
  // owns its own paths — nothing lands under the run directory.
  const { db, project, archive, importHash, importGroup, environment, label } = input;

  let parsed;
  try {
    parsed = await parseTraceArchive(archive.data);
  } catch (error) {
    if (error instanceof TraceImportError) throw createError({ statusCode: 400, message: error.message });
    throw createError({ statusCode: 400, message: `Could not read the trace: ${(error as Error).message}` });
  }

  // Adopt the spec path this project already uses for the file, so the imported
  // execution joins the existing test case instead of forking a lookalike.
  const knownPaths = await db
    .selectDistinct({ filePath: testCases.filePath })
    .from(testCases)
    .where(eq(testCases.projectId, project.id));
  parsed.case.filePath = resolveSpecPath(
    parsed.rawFilePath,
    knownPaths.map((row) => row.filePath),
  );

  // The group is the run's identity when set, so a re-uploaded batch reuses the
  // same run rather than building a second copy of it beside the first.
  const runKey = importGroup ?? importHash;
  const startTime = new Date(parsed.startedAt);

  let run = (
    await db
      .select()
      .from(testRuns)
      .where(and(eq(testRuns.projectId, project.id), eq(testRuns.importHash, runKey)))
  )[0];

  if (!run) {
    try {
      run = (
        await db
          .insert(testRuns)
          .values({
            projectId: project.id,
            status: 'passed',
            startTime,
            duration: 0,
            environment,
            label,
            playwrightVersion: parsed.playwrightVersion,
            importHash: runKey,
            metadata: sanitizeMetadata({
              import: {
                source: importGroup ? 'trace files' : archive.filename,
                importedAt: new Date().toISOString(),
                kind: 'trace',
              },
            }),
          })
          .returning()
      )[0];
    } catch {
      // Another trace from the same group created the run in between.
      run = (
        await db
          .select()
          .from(testRuns)
          .where(and(eq(testRuns.projectId, project.id), eq(testRuns.importHash, runKey)))
      )[0];
    }
  }
  if (!run) throw createError({ statusCode: 500, message: 'Failed to create the imported test run' });

  // This exact trace already in this run means the upload is a repeat, not a
  // second attempt — the blob hash is what tells the two apart.
  const alreadyHere = await db
    .select({ id: files.id })
    .from(files)
    .innerJoin(traceBlobs, eq(traceBlobs.id, files.blobId))
    .where(and(eq(files.testRunId, run.id), eq(traceBlobs.hash, importHash)));

  if (alreadyHere.length > 0) {
    return summarizeRun(await reloadRun(db, run.id), project.id, 'duplicate', 0, 0);
  }

  // A different trace for a test the run already has is a retry. Traces carry
  // no attempt index of their own, so it comes from how many attempts of this
  // test the run already holds — which makes upload order the attempt order.
  parsed.case.retries = await countPriorAttempts(db, project.id, run.id, parsed.case);

  const inserted = await persistRunCases(db, project.id, run.id, [parsed.case]);
  const testRunsCaseId = inserted[0]?.id;
  if (!testRunsCaseId) {
    return summarizeRun(await reloadRun(db, run.id), project.id, 'duplicate', 0, 0);
  }

  let traceCount = 0;
  try {
    const blob = await upsertTraceBlob(project.id, importHash, archive.data);
    await db.insert(files).values({
      testRunsCaseId,
      testRunId: run.id,
      type: 'trace',
      path: blob.path.replace(/\\/g, '/'),
      size: blob.size,
      blobId: blob.id,
    });
    traceCount = 1;
  } catch (error) {
    console.error(`[Import] Failed to store trace ${archive.filename}: ${error}`);
  }

  await rollUpTraceRun(db, run.id, startTime);

  const updated = await reloadRun(db, run.id);
  runEventBus.publishGlobal({
    type: 'run-submitted',
    runId: run.id,
    projectId: project.id,
    status: updated.status,
  });

  console.log(
    `[Import] Trace "${parsed.case.title}" imported into run #${run.id} as ${parsed.case.filePath}` +
      `${importGroup ? ' (grouped)' : ''}`,
  );

  return summarizeRun(
    updated,
    project.id,
    'imported',
    traceCount,
    0,
    [parsed.case.filePath],
    [...(parsed.case.suitePath ?? []), parsed.case.title].join(' › '),
  );
}

/** How many executions of this same test the run already holds. */
async function countPriorAttempts(
  db: Awaited<ReturnType<typeof getDatabase>>,
  projectId: number,
  testRunId: number,
  input: { filePath: string; suitePath?: string[] | null; title: string },
): Promise<number> {
  const existing = await db
    .select({ id: testCases.id })
    .from(testCases)
    .where(
      and(
        eq(testCases.projectId, projectId),
        eq(testCases.filePath, input.filePath),
        eq(testCases.suitePath, joinSuitePath(input.suitePath)),
        eq(testCases.title, input.title),
      ),
    );

  const testCaseId = existing[0]?.id;
  if (testCaseId === undefined) return 0;

  const attempts = await db
    .select({ id: testRunsCases.id })
    .from(testRunsCases)
    .where(and(eq(testRunsCases.testRunId, testRunId), eq(testRunsCases.testCaseId, testCaseId)));

  return attempts.length;
}

/**
 * Recompute a trace-built run's counters from the executions it now holds.
 *
 * Traces arrive one request at a time, so the run's totals are derived after
 * each one rather than accumulated — a rebuild from the rows cannot drift the
 * way a running tally can when a request is retried.
 */
async function rollUpTraceRun(
  db: Awaited<ReturnType<typeof getDatabase>>,
  testRunId: number,
  startTime: Date,
): Promise<void> {
  const rows = await db
    .select({ status: testRunsCases.status, duration: testRunsCases.duration, startedAt: testRunsCases.startedAt })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, testRunId));

  const counts = { passed: 0, failed: 0, timedOut: 0, skipped: 0, didNotRun: 0 };
  for (const row of rows) {
    if (row.status === 'passed') counts.passed++;
    else if (row.status === 'timedOut') counts.timedOut++;
    else if (row.status === 'skipped') counts.skipped++;
    else if (row.status === 'didnotrun') counts.didNotRun++;
    else counts.failed++;
  }

  const stats = durationStats(rows.map((row) => row.duration));
  const earliest = rows.reduce<number>(
    (min, row) => (row.startedAt != null && row.startedAt < min ? row.startedAt : min),
    startTime.getTime(),
  );
  // Wall-clock span of the group, not the sum: traces from one job overlap.
  const latestEnd = rows.reduce<number>(
    (max, row) => Math.max(max, (row.startedAt ?? earliest) + (row.duration ?? 0)),
    earliest,
  );

  await db
    .update(testRuns)
    .set({
      status: counts.failed + counts.timedOut > 0 ? 'failed' : 'passed',
      startTime: new Date(earliest),
      duration: Math.max(0, latestEnd - earliest),
      totalTests: rows.length,
      passedTests: counts.passed,
      failedTests: sumFailedAndTimedOut(counts.failed, counts.timedOut),
      skippedTests: counts.skipped,
      didNotRunTests: counts.didNotRun,
      avgTestDuration: stats?.avg ?? null,
      p90TestDuration: stats?.p90 ?? null,
      updatedAt: new Date(),
    })
    .where(eq(testRuns.id, testRunId));
}

async function reloadRun(db: Awaited<ReturnType<typeof getDatabase>>, testRunId: number) {
  const rows = await db.select().from(testRuns).where(eq(testRuns.id, testRunId));
  const run = rows[0];
  if (!run) throw createError({ statusCode: 500, message: 'The imported test run disappeared' });
  return run;
}

/** Project a stored run row onto the import response shape. */
function summarizeRun(
  run: Awaited<ReturnType<typeof reloadRun>>,
  projectId: number,
  status: ImportRunResponse['status'],
  traceCount: number,
  attachmentCount: number,
  filePaths: string[] = [],
  caseTitle?: string,
): ImportRunResponse {
  return {
    status,
    kind: 'trace',
    ...(caseTitle ? { caseTitle } : {}),
    testRunId: run.id,
    projectId,
    runStatus: run.status,
    startTime: run.startTime.toISOString(),
    totalTests: run.totalTests,
    passedTests: run.passedTests,
    failedTests: run.failedTests,
    skippedTests: run.skippedTests,
    didNotRunTests: run.didNotRunTests,
    flakyTests: run.flakyTests,
    traceCount,
    attachmentCount,
    playwrightVersion: run.playwrightVersion,
    projectNames: [],
    filePaths,
    shard: null,
  };
}

/** Return the summary of an already-imported archive, or null when it is new. */
async function findImportedRun(
  db: Awaited<ReturnType<typeof getDatabase>>,
  projectId: number,
  importHash: string,
): Promise<ImportRunResponse | null> {
  const rows = await db
    .select()
    .from(testRuns)
    .where(and(eq(testRuns.projectId, projectId), eq(testRuns.importHash, importHash)));

  const run = rows[0];
  if (!run) return null;

  return {
    status: 'duplicate',
    kind:
      run.importHash && (run.metadata as Record<string, any> | null)?.import?.kind === 'trace'
        ? 'trace'
        : 'blob-report',
    testRunId: run.id,
    projectId,
    runStatus: run.status,
    startTime: run.startTime.toISOString(),
    totalTests: run.totalTests,
    passedTests: run.passedTests,
    failedTests: run.failedTests,
    skippedTests: run.skippedTests,
    didNotRunTests: run.didNotRunTests,
    flakyTests: run.flakyTests,
    traceCount: 0,
    attachmentCount: 0,
    playwrightVersion: run.playwrightVersion,
    projectNames: [],
    filePaths: [],
    shard: null,
  };
}

/**
 * Recover the ARIA snapshot and source snippet from Playwright's
 * `error-context` attachment, which it writes alongside every failure.
 */
async function recoverErrorContext(
  archive: Buffer,
  entries: Map<string, ZipEntryMeta>,
  entry: ImportedRunCase,
): Promise<void> {
  const contextRef = entry.attachments.find((a) => a.name === 'error-context');
  if (!contextRef) return;

  const bytes = await readBlobEntry(archive, entries, contextRef.entry);
  if (!bytes) return;

  const evidence = parseErrorContext(bytes.toString('utf-8'), {
    declLine: entry.case.line,
    failingLine: failingLineOf(entry.case.error),
  });
  entry.case.ariaSnapshot = evidence.ariaSnapshot;
  entry.case.testSource = evidence.testSource;
}

/** Recover the browser console from an execution's trace. */
async function recoverConsoleLogs(traceBytes: Buffer, entry: ImportedRunCase): Promise<void> {
  try {
    const traceData = await parseTraceEvents(traceBytes);
    entry.case.consoleLogs = consoleLogsFromTrace(traceData, entry.case.startedAt ?? null);
  } catch (error) {
    console.warn(`[Import] Could not read console entries for "${entry.case.title}": ${error}`);
  }
}

/** The line the failure points at, read back from the synthetic stack frame. */
function failingLineOf(errorText: string | null | undefined): number | null {
  if (!errorText) return null;
  const match = errorText.match(/^\s+at (?:[^(]*\()?.+?:(\d+):\d+\)?\s*$/m);
  return match ? Number(match[1]) : null;
}
