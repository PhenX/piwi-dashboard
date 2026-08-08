import { getDatabase } from '../../../database';
import { getProjectSlowTests } from '#shared/handlers/projects';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Slow test analysis',
    description:
      'Returns the slowest test cases for a project with average, max, min duration, run count, and trend direction',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'runs',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 10, maximum: 100 },
        description: 'Number of recent runs to analyze (default 10, max 100).',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const query = getQuery(event);
  const runsCount = Math.min(parseInt(query.runs as string) || 10, 100);

  const db = await getDatabase();

  try {
    return { items: await getProjectSlowTests(db, id, runsCount) };
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw createError({ statusCode: 404, message: 'Project not found' });
    }
    throw e;
  }
});
