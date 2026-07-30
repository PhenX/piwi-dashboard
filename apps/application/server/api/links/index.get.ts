import { requireProjectAccess, resolveLinkEntityProjectId } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { listLinks } from '#shared/handlers/links';

defineRouteMeta({
  openAPI: {
    tags: ['Links'],
    summary: 'List entity links',
    description: 'Returns all entity links attached to a run, test-case run, or test case.',
    parameters: [
      {
        name: 'entityType',
        in: 'query',
        required: true,
        schema: { type: 'string', enum: ['test_run', 'test_runs_case', 'test_case'] },
      },
      { name: 'entityId', in: 'query', required: true, schema: { type: 'integer' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const query = getQuery(event);
  const entityType = query.entityType as string;
  const entityId = parseInt(query.entityId as string, 10);

  if (!['test_run', 'test_runs_case', 'test_case'].includes(entityType) || !entityId) {
    throw createError({ statusCode: 400, message: 'Invalid entityType or entityId' });
  }

  const db = await getDatabase();
  const projectId = await resolveLinkEntityProjectId(db, entityType, entityId);
  if (!projectId) throw createError({ statusCode: 404, message: 'Entity not found' });
  await requireProjectAccess(event, projectId);

  return listLinks(db, entityType, entityId);
});
