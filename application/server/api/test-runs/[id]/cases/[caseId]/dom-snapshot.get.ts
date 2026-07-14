import { and, eq } from 'drizzle-orm';
import { files, testRunsCases } from '../../../../../database/schema';
import { resolveCaseDomSnapshot } from '../../../../../utils/dom-snapshot';
import { Role } from '#shared/types';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Render the failure-time DOM snapshot for a test-run case',
    description:
      'Extracts the DOM snapshot from the stored trace ZIP, falling back to a simplified render of the captured ARIA snapshot when no trace is available. Input values, inline handlers and script bodies are never included; token-shaped strings are masked.',
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

  const [traceRows, caseRows] = await Promise.all([
    db
      .select({ path: files.path })
      .from(files)
      .where(and(eq(files.testRunsCaseId, caseId), eq(files.type, 'trace')))
      .limit(1),
    db.select({ aria: testRunsCases.ariaSnapshot }).from(testRunsCases).where(eq(testRunsCases.id, caseId)).limit(1),
  ]);

  return resolveCaseDomSnapshot(traceRows[0]?.path ?? null, caseRows[0]?.aria ?? null);
});
