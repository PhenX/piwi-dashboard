import { getDatabase } from '../../../database';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getProjectLatestRun } from '#shared/handlers/test-runs';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get latest run info for a project',
    description: 'Returns the id and status of the most recent test run for the project',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const db = await getDatabase();
  return getProjectLatestRun(db, id);
});
