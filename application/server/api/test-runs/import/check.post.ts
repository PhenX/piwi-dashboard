import { and, eq, inArray } from 'drizzle-orm';
import { getDatabase } from '../../../database';
import { projects, testRuns } from '../../../database/schema';
import { requireAuth } from '../../../utils/auth';
import { getProjectScope, scopeAllows } from '../../../utils/project-access';
import { resolveMaxUploadBytes } from '../../../utils/upload-limits';
import { formatBytes } from '#shared/utils/format-bytes';
import type { ImportCheckFile, ImportCheckResponse, ImportCheckResult } from '#shared/import.types';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Check blob-report archives before importing them',
    description:
      'Judge a batch of archives from their name, size and SHA-256 alone: too large for this server, already imported into the project, or safe to upload. Lets a client skip uploads that would be rejected or ignored.',
    'x-required-roles': ['administrator'],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              projectName: { type: 'string' },
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    size: { type: 'integer' },
                    hash: { type: 'string', description: 'Lower-case hex SHA-256 of the file' },
                  },
                  required: ['name', 'size', 'hash'],
                },
              },
            },
            required: ['projectName', 'files'],
          },
        },
      },
    },
  },
});

const SHA256_RE = /^[0-9a-f]{64}$/;
/** Guards the batch against a client asking about an unreasonable number of files. */
const MAX_FILES_PER_CHECK = 500;

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const body = await readBody(event);

  const projectName = typeof body?.projectName === 'string' ? body.projectName.trim() : '';
  if (!projectName) throw createError({ statusCode: 400, message: 'Missing required field: projectName' });

  const requested: unknown[] = Array.isArray(body?.files) ? body.files : [];
  if (requested.length > MAX_FILES_PER_CHECK) {
    throw createError({ statusCode: 400, message: `Too many files in one check (max ${MAX_FILES_PER_CHECK})` });
  }

  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);
  const maxBytes = resolveMaxUploadBytes();

  const existingProjects = await db.select().from(projects).where(eq(projects.name, projectName));
  const project = existingProjects[0];

  if (project) {
    if (!scopeAllows(scope, project.id)) {
      throw createError({ statusCode: 403, message: 'No access to this project' });
    }
  } else if (scope !== 'all') {
    throw createError({ statusCode: 403, message: 'Cannot create a new project — no global access' });
  }

  // Normalize first so a malformed entry gets a verdict instead of a 400 that
  // would sink the whole batch.
  const files: Array<ImportCheckFile | null> = requested.map((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name : '';
    const size = typeof entry.size === 'number' ? entry.size : -1;
    const hash = typeof entry.hash === 'string' ? entry.hash.toLowerCase() : '';
    if (!name || size < 0 || !SHA256_RE.test(hash)) return null;
    return { name, size, hash };
  });

  // One lookup for the whole batch: which of these hashes this project already has.
  const hashes = [...new Set(files.filter((f): f is ImportCheckFile => f !== null).map((f) => f.hash))];
  const alreadyImported = new Map<string, number>();
  if (project && hashes.length > 0) {
    const rows = await db
      .select({ id: testRuns.id, importHash: testRuns.importHash })
      .from(testRuns)
      .where(and(eq(testRuns.projectId, project.id), inArray(testRuns.importHash, hashes)));
    for (const row of rows) {
      if (row.importHash) alreadyImported.set(row.importHash, row.id);
    }
  }

  const results: ImportCheckResult[] = files.map((file, index) => {
    const name = file?.name || String((requested[index] as Record<string, unknown> | undefined)?.name ?? 'file');

    if (!file) {
      return { name, status: 'invalid', message: 'Missing a readable name, size or SHA-256.' };
    }
    if (file.size === 0) {
      return { name, status: 'invalid', message: 'The file is empty.' };
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return {
        name,
        status: 'invalid',
        message: 'Expected a .zip blob report (blob-report/report-*.zip).',
      };
    }
    if (file.size > maxBytes) {
      return {
        name,
        status: 'too-large',
        message: `${formatBytes(file.size)} exceeds this server's ${formatBytes(maxBytes)} limit.`,
      };
    }

    const existingRunId = alreadyImported.get(file.hash);
    if (existingRunId !== undefined) {
      return { name, status: 'duplicate', message: 'Already imported into this project.', testRunId: existingRunId };
    }

    return { name, status: 'ok' };
  });

  return { maxBytes, results } satisfies ImportCheckResponse;
});
