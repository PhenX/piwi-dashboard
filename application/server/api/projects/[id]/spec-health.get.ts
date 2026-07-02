import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { getProjectSpecHealth } from '#shared/handlers/projects';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Spec health overview',
    description:
      'Groups test cases by spec file prefix and computes pass rate, flaky rate, failure count, test count, and average duration over the last N days',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'days', in: 'query', schema: { type: 'integer', default: 30 } },
    ],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, projectId);

  const days = Math.min(90, Math.max(1, parseInt((getQuery(event).days as string) || '30')));

  const db = await getDatabase();

  try {
    return await getProjectSpecHealth(db, projectId, days);
  } catch (err) {
    if (err instanceof Error && err.message === 'Project not found') {
      throw createError({ statusCode: 404, message: 'Project not found' });
    }
    throw err;
  }
});
