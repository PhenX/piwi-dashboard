/**
 * Client-side import for demo mode.
 *
 * Mirrors `server/api/test-runs/import.post.ts` and its pre-flight, but runs
 * inside the service worker: the archive never leaves the visitor's machine,
 * the ZIP is inflated with `DecompressionStream`, and the results land in the
 * same in-browser SQLite the rest of the demo reads from. That makes the demo
 * something you can point at your own blob report, rather than only at the
 * seeded sample data.
 *
 * The parsing is not re-implemented here: `blob-report.ts` and
 * `trace-import.ts` are free of `node:` imports precisely so both halves can
 * share them, with only the ZIP reader differing per runtime.
 */

import { and, eq } from 'drizzle-orm';
import { getDemoDb, putDemoImportedFile } from '../db.client';
import { readZipEntries } from '../trace-zip.client';
import { publishDemoGlobalEvent } from '../run-events';
import { persistRunCases, type RunCaseInput } from './reporter';
import { projects, testRuns, testRunsCases, testCases, files } from '~~/server/database/schema.sqlite';
import { parseBlobReport, BlobReportError, type ArchiveEntryReader } from '~~/server/utils/blob-report';
import { parseTraceArchive, looksLikeTrace, resolveSpecPath, TraceImportError } from '~~/server/utils/trace-import';
import { parseErrorContext, consoleLogsFromTrace } from '~~/server/utils/import-evidence';
import { parseTraceTexts, traceFileRank } from '~~/server/utils/trace-events';
import { sanitizeMetadata } from '~~/server/utils/sanitize';
import { durationStats } from '#shared/utils/stats';
import { sumFailedAndTimedOut } from '#shared/utils/test-counts';
import { joinSuitePath } from '#shared/utils/suites';
import { formatBytes } from '#shared/utils/format-bytes';
import type { ImportCheckFile, ImportCheckResponse, ImportCheckResult, ImportRunResponse } from '#shared/import.types';

/**
 * Demo archives are held in IndexedDB and inflated in a service worker, so the
 * ceiling is far below the server's — enough for a real run's report, not for
 * a CI artifact bundle.
 */
const DEMO_MAX_IMPORT_BYTES = 50 * 1024 * 1024;

const SHA256_RE = /^[0-9a-f]{64}$/;

type DemoDb = Awaited<ReturnType<typeof getDemoDb>>;

/** Read the whole archive once, then serve entries from memory. */
async function openDemoArchive(bytes: Uint8Array): Promise<{ entryNames: string[]; readEntry: ArchiveEntryReader }> {
  const entries = await readZipEntries(bytes as Uint8Array<ArrayBuffer>, () => true);
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
  return {
    entryNames: entries.map((entry) => entry.name),
    readEntry: async (name) => byName.get(name) ?? null,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Get-or-create the project an import targets, mirroring the server. */
async function resolveProject(db: DemoDb, projectName: string) {
  const existing = await db.select().from(projects).where(eq(projects.name, projectName));
  if (existing[0]) return existing[0];

  const created = await db.insert(projects).values({ name: projectName }).returning();
  const project = created[0];
  if (!project) throw new Error('Failed to create the project');
  return project;
}

/** Pre-flight: judge each archive from its metadata, before anything uploads. */
export async function apiCheckDemoImport(body: {
  projectName?: string;
  files?: unknown[];
}): Promise<ImportCheckResponse> {
  const projectName = typeof body?.projectName === 'string' ? body.projectName.trim() : '';
  if (!projectName) throw new Error('Missing required field: projectName');

  const db = await getDemoDb();
  const rows = await db.select().from(projects).where(eq(projects.name, projectName));
  const project = rows[0];

  const alreadyImported = new Map<string, number>();
  if (project) {
    const runs = await db
      .select({ id: testRuns.id, importHash: testRuns.importHash })
      .from(testRuns)
      .where(eq(testRuns.projectId, project.id));
    for (const run of runs) {
      if (run.importHash) alreadyImported.set(run.importHash, run.id);
    }
  }

  const results: ImportCheckResult[] = (body.files ?? []).map((raw) => {
    const entry = (raw ?? {}) as Partial<ImportCheckFile>;
    const name = typeof entry.name === 'string' ? entry.name : 'file';
    const size = typeof entry.size === 'number' ? entry.size : -1;
    const hash = typeof entry.hash === 'string' ? entry.hash.toLowerCase() : '';

    if (!name || size < 0 || !SHA256_RE.test(hash)) {
      return { name, status: 'invalid', message: 'Missing a readable name, size or SHA-256.' };
    }
    if (size === 0) return { name, status: 'invalid', message: 'The file is empty.' };
    if (!name.toLowerCase().endsWith('.zip')) {
      return { name, status: 'invalid', message: 'Expected a .zip blob report (blob-report/report-*.zip).' };
    }
    if (size > DEMO_MAX_IMPORT_BYTES) {
      return {
        name,
        status: 'too-large',
        message: `${formatBytes(size)} exceeds the demo's ${formatBytes(DEMO_MAX_IMPORT_BYTES)} limit — the demo keeps everything in your browser.`,
      };
    }

    const existingRunId = alreadyImported.get(hash);
    if (existingRunId !== undefined) {
      return { name, status: 'duplicate', message: 'Already imported into this project.', testRunId: existingRunId };
    }

    return { name, status: 'ok' };
  });

  return { maxBytes: DEMO_MAX_IMPORT_BYTES, results };
}

/** Import one archive, dispatching on what the ZIP turns out to hold. */
export async function apiDemoImport(form: FormData): Promise<ImportRunResponse> {
  const projectName = String(form.get('projectName') ?? '').trim();
  const file = form.get('archive');
  if (!projectName || !(file instanceof Blob)) {
    throw new Error('Missing required fields: projectName, archive');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw new Error('The uploaded archive is empty');
  if (bytes.length > DEMO_MAX_IMPORT_BYTES) {
    throw new Error(`Archive too large (max ${formatBytes(DEMO_MAX_IMPORT_BYTES)} in the demo)`);
  }

  const groupRaw = String(form.get('importGroup') ?? '').toLowerCase();
  const importGroup = SHA256_RE.test(groupRaw) ? groupRaw : null;
  const importHash = await sha256Hex(bytes);

  const db = await getDemoDb();
  const project = await resolveProject(db, projectName);

  const existing = await findImportedRun(db, project.id, importHash);
  if (existing) return existing;

  let archive;
  try {
    archive = await openDemoArchive(bytes);
  } catch (error) {
    throw new Error(`Not a readable ZIP archive: ${(error as Error).message}`);
  }

  if (!archive.entryNames.includes('report.jsonl')) {
    if (!looksLikeTrace(archive.entryNames)) {
      throw new Error(
        'Unrecognised archive: expected a Playwright blob report (blob-report/report-*.zip) or a trace file (trace.zip).',
      );
    }
    return importTrace(db, project.id, archive, bytes, importHash, importGroup);
  }

  return importBlobReport(db, project.id, archive, importHash);
}

async function importBlobReport(
  db: DemoDb,
  projectId: number,
  archive: { entryNames: string[]; readEntry: ArchiveEntryReader },
  importHash: string,
): Promise<ImportRunResponse> {
  let parsed;
  try {
    parsed = await parseBlobReport(archive.readEntry);
  } catch (error) {
    if (error instanceof BlobReportError) throw error;
    throw new Error(`Could not read the archive: ${(error as Error).message}`);
  }

  if (parsed.cases.length === 0) throw new Error('The archive contains no test results');

  // Recover the evidence the archive still holds, before the rows exist.
  const decoder = new TextDecoder();
  for (const entry of parsed.cases) {
    const contextRef = entry.attachments.find((a) => a.name === 'error-context');
    if (contextRef) {
      const md = await archive.readEntry(contextRef.entry);
      if (md) {
        const evidence = parseErrorContext(decoder.decode(md), { declLine: entry.case.line });
        entry.case.ariaSnapshot = evidence.ariaSnapshot;
        entry.case.testSource = evidence.testSource;
      }
    }

    const traceRef = entry.traces[0];
    if (!traceRef) continue;
    const traceBytes = await archive.readEntry(traceRef.entry);
    if (traceBytes) entry.case.consoleLogs = await consoleFromTraceBytes(traceBytes, entry.case.startedAt ?? null);
  }

  const inserted = await db
    .insert(testRuns)
    .values({
      projectId,
      status: parsed.status,
      startTime: parsed.startTime,
      duration: parsed.duration,
      totalTests: parsed.totalTests,
      passedTests: parsed.passedTests,
      failedTests: sumFailedAndTimedOut(parsed.failedTests, parsed.timedOutTests),
      skippedTests: parsed.skippedTests,
      didNotRunTests: parsed.didNotRunTests,
      flakyTests: parsed.flakyTests,
      playwrightVersion: parsed.playwrightVersion,
      importHash,
      metadata: sanitizeMetadata({ import: { source: 'blob report', importedAt: new Date().toISOString() } }),
    })
    .returning();

  const run = inserted[0];
  if (!run) throw new Error('Failed to create the imported test run');

  const insertedCases = await persistRunCases(
    db,
    projectId,
    run.id,
    parsed.cases.map((entry) => entry.case as RunCaseInput),
  );

  let traceCount = 0;
  let attachmentCount = 0;

  // Positional linking only holds when every case produced a row (see the
  // server handler for the repeatEach case that breaks it).
  if (insertedCases.length === parsed.cases.length) {
    for (const [index, entry] of parsed.cases.entries()) {
      const testRunsCaseId = insertedCases[index]?.id;
      if (!testRunsCaseId) continue;

      for (const ref of entry.traces) {
        const stored = await storeDemoFile(db, projectId, run.id, testRunsCaseId, archive, ref, 'trace');
        if (stored) traceCount++;
      }
      for (const ref of entry.attachments) {
        const stored = await storeDemoFile(db, projectId, run.id, testRunsCaseId, archive, ref, 'attachment');
        if (stored) attachmentCount++;
      }
    }
  }

  const stats = durationStats(parsed.cases.map((entry) => entry.case.duration));
  if (stats) {
    await db
      .update(testRuns)
      .set({ avgTestDuration: stats.avg, p90TestDuration: stats.p90 })
      .where(eq(testRuns.id, run.id));
  }

  publishDemoGlobalEvent({ type: 'run-submitted', runId: run.id, projectId, status: parsed.status });

  return {
    status: 'imported',
    kind: 'blob-report',
    testRunId: run.id,
    projectId,
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
  };
}

async function importTrace(
  db: DemoDb,
  projectId: number,
  archive: { entryNames: string[]; readEntry: ArchiveEntryReader },
  bytes: Uint8Array,
  importHash: string,
  importGroup: string | null,
): Promise<ImportRunResponse> {
  let parsed;
  try {
    parsed = await parseTraceArchive(archive.entryNames, archive.readEntry);
  } catch (error) {
    if (error instanceof TraceImportError) throw error;
    throw new Error(`Could not read the trace: ${(error as Error).message}`);
  }

  const knownPaths = await db
    .selectDistinct({ filePath: testCases.filePath })
    .from(testCases)
    .where(eq(testCases.projectId, projectId));
  parsed.case.filePath = resolveSpecPath(
    parsed.rawFilePath,
    knownPaths.map((row) => row.filePath),
  );

  const runKey = importGroup ?? importHash;
  let run = (
    await db
      .select()
      .from(testRuns)
      .where(and(eq(testRuns.projectId, projectId), eq(testRuns.importHash, runKey)))
  )[0];

  if (!run) {
    run = (
      await db
        .insert(testRuns)
        .values({
          projectId,
          status: 'passed',
          startTime: new Date(parsed.startedAt),
          duration: 0,
          playwrightVersion: parsed.playwrightVersion,
          importHash: runKey,
          metadata: sanitizeMetadata({
            import: { source: 'trace files', importedAt: new Date().toISOString(), kind: 'trace' },
          }),
        })
        .returning()
    )[0];
  }
  if (!run) throw new Error('Failed to create the imported test run');

  // The same trace already in this run is a repeat upload, not a second attempt.
  const storedPath = demoBlobPath(projectId, importHash);
  const already = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.testRunId, run.id), eq(files.path, storedPath)));
  if (already.length > 0) return summarizeRun(await reloadRun(db, run.id), projectId, 'duplicate', 0);

  parsed.case.retries = await countPriorAttempts(db, projectId, run.id, parsed.case);

  const inserted = await persistRunCases(db, projectId, run.id, [parsed.case as RunCaseInput]);
  const testRunsCaseId = inserted[0]?.id;
  if (!testRunsCaseId) return summarizeRun(await reloadRun(db, run.id), projectId, 'duplicate', 0);

  await putDemoImportedFile(storedPath, bytes);
  await db.insert(files).values({
    testRunsCaseId,
    testRunId: run.id,
    type: 'trace',
    path: storedPath,
    size: bytes.length,
  });

  await rollUpTraceRun(db, run.id, new Date(parsed.startedAt));

  const updated = await reloadRun(db, run.id);
  publishDemoGlobalEvent({ type: 'run-submitted', runId: run.id, projectId, status: updated.status });

  return summarizeRun(
    updated,
    projectId,
    'imported',
    1,
    [parsed.case.filePath],
    [...(parsed.case.suitePath ?? []), parsed.case.title].join(' › '),
  );
}

/** Where an imported file lives in the demo's IndexedDB-backed store. */
function demoBlobPath(projectId: number, hash: string): string {
  return `project-${projectId}/imported/${hash}.zip`;
}

/** Write one archive entry into the demo's file store and record it. */
async function storeDemoFile(
  db: DemoDb,
  projectId: number,
  testRunId: number,
  testRunsCaseId: number,
  archive: { readEntry: ArchiveEntryReader },
  ref: { entry: string; name: string; contentType: string },
  type: 'trace' | 'attachment',
): Promise<boolean> {
  const bytes = await archive.readEntry(ref.entry);
  if (!bytes) return false;

  const extension = ref.entry.split('.').pop() || 'bin';
  const path = `project-${projectId}/imported/${await sha256Hex(bytes)}.${extension}`;

  await putDemoImportedFile(path, bytes);
  await db.insert(files).values({
    testRunsCaseId,
    testRunId,
    type,
    ...(type === 'attachment' ? { subtype: ref.name, label: ref.contentType } : {}),
    path,
    size: bytes.length,
  });
  return true;
}

/** Console entries recovered from a trace, using the node-free parser. */
async function consoleFromTraceBytes(traceBytes: Uint8Array, startedAt: number | null) {
  try {
    const entries = await readZipEntries(traceBytes as Uint8Array<ArrayBuffer>, (name) => name.endsWith('.trace'));
    entries.sort((a, b) => traceFileRank(a.name) - traceFileRank(b.name));
    const decoder = new TextDecoder();
    return consoleLogsFromTrace(parseTraceTexts(entries.map((entry) => decoder.decode(entry.data))), startedAt);
  } catch {
    return null;
  }
}

async function countPriorAttempts(
  db: DemoDb,
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

/** Recompute a trace-built run's counters from the executions it now holds. */
async function rollUpTraceRun(db: DemoDb, testRunId: number, startTime: Date): Promise<void> {
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

async function reloadRun(db: DemoDb, testRunId: number) {
  const rows = await db.select().from(testRuns).where(eq(testRuns.id, testRunId));
  const run = rows[0];
  if (!run) throw new Error('The imported test run disappeared');
  return run;
}

async function findImportedRun(db: DemoDb, projectId: number, importHash: string): Promise<ImportRunResponse | null> {
  const rows = await db
    .select()
    .from(testRuns)
    .where(and(eq(testRuns.projectId, projectId), eq(testRuns.importHash, importHash)));

  const run = rows[0];
  if (!run) return null;
  return summarizeRun(run, projectId, 'duplicate', 0);
}

function summarizeRun(
  run: Awaited<ReturnType<typeof reloadRun>>,
  projectId: number,
  status: ImportRunResponse['status'],
  traceCount: number,
  filePaths: string[] = [],
  caseTitle?: string,
): ImportRunResponse {
  const isTrace = (run.metadata as Record<string, any> | null)?.import?.kind === 'trace';
  return {
    status,
    kind: isTrace ? 'trace' : 'blob-report',
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
    attachmentCount: 0,
    playwrightVersion: run.playwrightVersion,
    projectNames: [],
    filePaths,
    shard: null,
  };
}
