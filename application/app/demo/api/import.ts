/**
 * Client-side import for demo mode.
 *
 * The archive never leaves the visitor's machine: the ZIP is inflated with
 * `DecompressionStream`, the results land in the same in-browser SQLite the
 * rest of the demo reads from, and traces go into IndexedDB beside it. That
 * makes the demo something you can point at your own blob report, rather than
 * only at the seeded sample data.
 *
 * Almost nothing here is import logic. The parsing lives in
 * `server/utils/blob-report.ts` and `trace-import.ts`, and everything that
 * happens after it in `#shared/handlers/import-runs` — both free of `node:`
 * imports so this half can use them unchanged. What remains is the four things
 * that genuinely differ from the server, supplied as an `ImportPort`.
 */

import { eq } from 'drizzle-orm';
import { getDemoDb, putDemoImportedFile } from '../db.client';
import { readZipEntries } from '../trace-zip.client';
import { publishDemoGlobalEvent } from '../run-events';
import { persistRunCases, type RunCaseInput } from './reporter';
import { projects } from '~~/server/database/schema.sqlite';
import { parseBlobReport } from '~~/server/utils/blob-report';
import { parseTraceArchive, looksLikeTrace } from '~~/server/utils/trace-import';
import { parseErrorContext, consoleLogsFromTrace } from '~~/server/utils/import-evidence';
import { parseTraceTexts, traceFileRank } from '~~/server/utils/trace-events';
import {
  findImportedHashes,
  findImportedRun,
  judgeImportFiles,
  importBlobReportRun,
  importTraceRun,
  type ArchiveEntryReader,
  type ImportPort,
} from '#shared/handlers/import-runs';
import { formatBytes } from '#shared/utils/format-bytes';
import type { ImportCheckResponse, ImportRunResponse } from '#shared/import.types';

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

/** Pre-flight: judge each archive from its metadata, before anything is read. */
export async function apiCheckDemoImport(body: {
  projectName?: string;
  files?: unknown[];
}): Promise<ImportCheckResponse> {
  const projectName = typeof body?.projectName === 'string' ? body.projectName.trim() : '';
  if (!projectName) throw new Error('Missing required field: projectName');

  const db = await getDemoDb();
  const rows = await db.select().from(projects).where(eq(projects.name, projectName));
  const project = rows[0];

  const hashes = (body.files ?? [])
    .map((raw) => (raw as { hash?: unknown } | null)?.hash)
    .filter((hash): hash is string => typeof hash === 'string')
    .map((hash) => hash.toLowerCase());

  const alreadyImported = project ? await findImportedHashes(db, project.id, hashes) : new Map<string, number>();
  const results = judgeImportFiles(body.files ?? [], {
    maxBytes: DEMO_MAX_IMPORT_BYTES,
    alreadyImported,
    tooLargeSuffix: ' — the demo keeps everything in your browser.',
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

  const port = createDemoImportPort();

  if (!archive.entryNames.includes('report.jsonl')) {
    if (!looksLikeTrace(archive.entryNames)) {
      throw new Error(
        'Unrecognised archive: expected a Playwright blob report (blob-report/report-*.zip) or a trace file (trace.zip).',
      );
    }

    const parsed = await parseTraceArchive(archive.entryNames, archive.readEntry);
    return await importTraceRun(db, port, {
      projectId: project.id,
      parsed,
      bytes,
      importHash,
      importGroup,
      source: importGroup ? 'trace files' : 'trace file',
    });
  }

  const parsed = await parseBlobReport(archive.readEntry);
  if (parsed.cases.length === 0) throw new Error('The archive contains no test results');

  return await importBlobReportRun(db, port, {
    projectId: project.id,
    parsed,
    readEntry: archive.readEntry,
    importHash,
    source: 'blob report',
  });
}

/**
 * The demo's half of an import: the in-browser persist mirror, files in
 * IndexedDB under a content-addressed path, and the BroadcastChannel that
 * stands in for the server's event bus.
 */
function createDemoImportPort(): ImportPort {
  return {
    persistRunCases: (db, projectId, testRunId, cases) =>
      persistRunCases(db as never, projectId, testRunId, cases as RunCaseInput[]),

    async storeFile({ projectId, entryName, bytes }) {
      // Content-addressed like the server's blob store, so the same trace
      // uploaded twice resolves to one path — which is how a repeat is spotted.
      const extension = entryName.split('.').pop() || 'bin';
      const path = `project-${projectId}/imported/${await sha256Hex(bytes)}.${extension}`;
      await putDemoImportedFile(path, bytes);
      return { path, size: bytes.length };
    },

    async readTraceConsole(bytes, startedAt) {
      try {
        const entries = await readZipEntries(bytes as Uint8Array<ArrayBuffer>, (name) => name.endsWith('.trace'));
        entries.sort((a, b) => traceFileRank(a.name) - traceFileRank(b.name));
        const decoder = new TextDecoder();
        return consoleLogsFromTrace(parseTraceTexts(entries.map((entry) => decoder.decode(entry.data))), startedAt);
      } catch {
        return null;
      }
    },

    parseErrorContext: (markdown, declLine) => parseErrorContext(markdown, { declLine }),

    publishRunSubmitted: (payload) => publishDemoGlobalEvent({ type: 'run-submitted', ...payload }),
  };
}
