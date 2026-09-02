import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../utils/project-access';
import { getFailureCluster } from '#shared/handlers/failure-clusters';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get failure cluster detail',
    description:
      'Returns detailed information about a failure cluster including affected tests, last seen run status, project info, and diagnosis.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const result = await getFailureCluster(db, id);
  if (!result) throw apiError({ statusCode: 404, message: 'Failure cluster not found' });

  return result;
});
