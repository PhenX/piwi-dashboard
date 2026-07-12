import { and, eq } from 'drizzle-orm';
import { files } from '../../../../../database/schema';
import { getTraceDomSnapshot } from '../../../../../utils/dom-snapshot';
import { Role } from '#shared/types';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

/** Generous UI cap — the AI context applies its own (smaller) configurable limit. */
const ENDPOINT_CAP_CHARS = 200_000;

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Render the failure-time DOM snapshot from the stored trace',
    description:
      'Extracts the DOM snapshot Playwright recorded for the failing action (before-snapshot, with after/last-snapshot fallbacks) from the execution stored trace ZIP and renders it as sanitized HTML. Input values, inline handlers and script bodies are never included; token-shaped strings are masked. Computed on request — nothing extra is captured or stored.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run id' },
      { name: 'caseId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  requireRouteId(event, 'id', 'runId');
  const caseId = requireRouteId(event, 'caseId', 'caseId');

  // Authorize by the case's own project — the data is read by caseId, so a
  // runId from an accessible project must not gate access to a case from
  // another project (the cluster page may pass a caseId from another run).
  const { db } = await requireResolvedProjectAccess(event, caseId, resolveTestRunCaseProjectId, 'Test run case');

  const traceFiles = await db
    .select({ path: files.path })
    .from(files)
    .where(and(eq(files.testRunsCaseId, caseId), eq(files.type, 'trace')))
    .limit(1);

  // Don't 404 — "no trace" is a valid answer
  if (traceFiles.length === 0 || !traceFiles[0]!.path) return { status: 'no-trace' as const };

  return getTraceDomSnapshot(traceFiles[0]!.path, ENDPOINT_CAP_CHARS);
});
