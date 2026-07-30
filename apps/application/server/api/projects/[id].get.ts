import { getDatabase } from '../../database';
import { getProject } from '#shared/handlers/projects';
import { requireProjectAccess, requireRouteId } from '../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get project details',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 200, maximum: 1000 },
        description: 'Maximum number of recent runs to include',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const rawLimit = Number(getQuery(event).limit);
  const runLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;

  const db = await getDatabase();
  try {
    const result = await getProject(db, id, { runLimit });
    const { scmToken: _scm, ...rest } = result;
    return rest;
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw createError({ statusCode: 404, message: 'Project not found' });
    }
    throw e;
  }
});
