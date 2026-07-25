import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { projects } from '../../database/schema';
import type { Project } from '../../database/schema';
import { requireAuth } from '../../utils/auth';
import { getStorage } from '../../storage';
import { getProjectScope, scopeAllows } from '../../utils/project-access';
import { resolveMaxUploadBytes } from '../../utils/upload-limits';
import { sanitizeFilename } from '../../utils/sanitize-filename';
import { persistRunCases } from '../../utils/persist-run-cases';
import { upsertTraceBlob } from '../../utils/trace-blobs';
import { parseBlobReport, BlobReportError } from '../../utils/blob-report';
import { parseTraceArchive, looksLikeTrace, TraceImportError } from '../../utils/trace-import';
import { openArchive, ArchiveError } from '../../utils/archive-reader';
import { parseErrorContext, consoleLogsFromTrace } from '../../utils/import-evidence';
import { parseTraceEvents } from '../../utils/trace-parser';
import { runEventBus } from '../../utils/run-events';
import {
  findImportedRun,
  importBlobReportRun,
  importTraceRun,
  toBytes,
  type ImportPort,
  type StoredImportFile,
} from '#shared/handlers/import-runs';
import { formatBytes } from '#shared/utils/format-bytes';

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
  let opened;
  try {
    opened = openArchive(archive.data);
  } catch (error) {
    if (error instanceof ArchiveError) throw createError({ statusCode: 400, message: error.message });
    throw error;
  }
  const { entryNames, readEntry } = opened;

  const port = createServerImportPort();
  await getStorage().mkdir(`project-${project.id}`);

  try {
    if (!entryNames.includes('report.jsonl')) {
      if (!looksLikeTrace(entryNames)) {
        throw createError({
          statusCode: 400,
          message:
            'Unrecognised archive: expected a Playwright blob report (blob-report/report-*.zip) or a trace file (trace.zip).',
        });
      }

      const parsed = await parseTraceArchive(entryNames, readEntry);
      const result = await importTraceRun(db, port, {
        projectId: project.id,
        parsed,
        bytes: archive.data,
        importHash,
        importGroup,
        source: importGroup ? 'trace files' : archive.filename,
        environment,
        label,
      });
      console.log(`[Import] Trace "${parsed.case.title}" imported into run #${result.testRunId}`);
      return result;
    }

    const parsed = await parseBlobReport(readEntry);
    if (parsed.cases.length === 0) {
      throw createError({ statusCode: 400, message: 'The archive contains no test results' });
    }

    const result = await importBlobReportRun(db, port, {
      projectId: project.id,
      parsed,
      readEntry,
      importHash,
      source: archive.filename,
      environment,
      label,
    });
    console.log(
      `[Import] Run #${result.testRunId} imported from ${archive.filename}: ` +
        `${result.totalTests} executions, ${result.traceCount} traces, ${result.attachmentCount} attachments`,
    );
    return result;
  } catch (error) {
    // The parsers speak in their own error types; the HTTP status is this
    // layer's business.
    if (error instanceof BlobReportError || error instanceof TraceImportError) {
      throw createError({ statusCode: 400, message: error.message });
    }
    throw error;
  }
});

/**
 * The server's half of an import: executions go through the shared write path,
 * traces into the content-addressed blob store, and other attachments under the
 * run's directory in whichever storage backend is configured.
 */
function createServerImportPort(): ImportPort {
  const storage = getStorage();

  return {
    persistRunCases: (db, projectId, testRunId, cases) =>
      persistRunCases(db as never, projectId, testRunId, cases as never),

    async storeFile({
      projectId,
      testRunId,
      testRunsCaseId,
      kind,
      entryName,
      bytes,
      digest,
    }): Promise<StoredImportFile | null> {
      // Always a buffer here: only the browser half ever passes a `Blob`.
      const raw = await toBytes(bytes);
      const data = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);

      try {
        if (kind === 'trace') {
          // Content-addressed, so a trace shared by several runs is stored once
          // and lands on the same path every time it is imported — which is
          // what lets a repeated upload be recognised.
          const hash = digest ?? createHash('sha256').update(data).digest('hex');
          const blob = await upsertTraceBlob(projectId, hash, data);
          return { path: blob.path.replace(/\\/g, '/'), size: blob.size, blobId: blob.id };
        }

        const dir = `project-${projectId}/run-${testRunId}/${testRunsCaseId}`;
        await storage.mkdir(dir);
        const path = `${dir}/${sanitizeFilename(entryName.split('/').pop() || 'attachment')}`;
        await storage.writeFile(path, data);
        return { path: path.replace(/\\/g, '/'), size: data.length };
      } catch (error) {
        console.error(`[Import] Failed to store ${kind} ${entryName}: ${error}`);
        return null;
      }
    },

    async readTraceConsole(bytes, startedAt) {
      try {
        const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return consoleLogsFromTrace(await parseTraceEvents(data), startedAt);
      } catch {
        return null;
      }
    },

    parseErrorContext: (markdown, declLine) => parseErrorContext(markdown, { declLine }),

    publishRunSubmitted: (payload) => runEventBus.publishGlobal({ type: 'run-submitted', ...payload }),

    warn: (message) => console.warn(`[Import] ${message}`),
  };
}
