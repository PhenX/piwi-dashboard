import { getExecutionDiagnosis } from '#shared/handlers/failure-clusters';
import { Role } from '#shared/types';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Get stored execution-scoped diagnosis for a test run case',
    description: 'Returns the stored execution-scoped AI diagnosis result for a single test-run case, if one exists.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  return getExecutionDiagnosis(db, id);
});
