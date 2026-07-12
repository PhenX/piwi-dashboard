import { getOrComputeVisualDiff } from '../../../../../utils/visual-diff';
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
    summary: 'Pixel-diff a failing screenshot against the last passing run',
    description:
      'Compares the failing execution screenshot with the same test case last passing execution screenshot (same browser). Computed lazily on first request and cached as a stored overlay artifact with changed-pixel metrics. Screenshots with different dimensions are compared on a padded union canvas and flagged dimensionMismatch.',
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

  // Don't 404 — "no screenshot" / "no baseline" are valid answers
  return getOrComputeVisualDiff(db, caseId);
});
