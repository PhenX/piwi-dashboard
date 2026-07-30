import { getEnvironmentDiff } from '../../../../../utils/environment-diff';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Diff a test case execution environment against its last pass',
    description:
      'Compares whitelisted run/browser environment keys (Playwright version, browser config, locale, viewport, CI provider, …) of this execution against the same test case last passing execution on the same browser. Returns only the changed keys; an empty list means the environment is identical.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run id' },
      { name: 'caseId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  requireRouteId(event, 'id', 'runId');
  const caseId = requireRouteId(event, 'caseId', 'caseId');

  // Authorize by the case's own project — the data is read by caseId, so a
  // runId from an accessible project must not gate access to a case from
  // another project (the cluster page may pass a caseId from another run).
  const { db } = await requireResolvedProjectAccess(event, caseId, resolveTestRunCaseProjectId, 'Test run case');

  // Don't 404 — "no baseline" is a valid answer
  return getEnvironmentDiff(db, caseId);
});
