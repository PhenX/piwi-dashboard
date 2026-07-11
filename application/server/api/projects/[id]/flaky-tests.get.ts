import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { getProjectFlakyTests } from '#shared/handlers/projects';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Flaky test analysis',
    description:
      'Analyzes test flakiness across recent runs using retry-pass detection and pass/fail alternation scoring. Pass an environment to scope the analysis to runs from that deployment environment.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'runs', in: 'query', required: false, schema: { type: 'integer' } },
      { name: 'environment', in: 'query', required: false, schema: { type: 'string' } },
    ],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);

  const query = getQuery(event);
  const runsParam = parseInt((query.runs as string) || '50');
  const runsLimit = Math.min(200, Math.max(1, isNaN(runsParam) ? 50 : runsParam));
  const environment = typeof query.environment === 'string' && query.environment ? query.environment : undefined;

  const db = await getDatabase();

  try {
    return await getProjectFlakyTests(db, projectId, runsLimit, environment);
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw createError({ statusCode: 404, message: 'Project not found' });
    }
    throw e;
  }
});
