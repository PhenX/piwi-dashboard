import { computeRunInsights } from '#shared/handlers/run-insights';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Run insights',
    description:
      'Returns comparison insights for a test run: new regressions, recurrences, recovered tests, performance changes, worker imbalance, and new clusters',
    'x-required-roles': ['administrator', 'reporter', 'user'],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'baseline', in: 'query', required: false, schema: { type: 'integer' } },
    ],
  },
});

export default eventHandler(async (event) => {
  const runId = requireRouteId(event, 'id', 'run ID');
  const { db } = await requireResolvedProjectAccess(event, runId, resolveRunProjectId, 'Run');

  const baselineRaw = getQuery(event).baseline;
  const baselineId = baselineRaw != null && baselineRaw !== '' ? Number(baselineRaw) : null;

  try {
    return await computeRunInsights(db, runId, {
      baselineId: baselineId != null && Number.isFinite(baselineId) ? baselineId : null,
    });
  } catch (e: any) {
    if (e?.message === 'Run not found') {
      throw apiError({ statusCode: 404, message: 'Run not found' });
    }
    throw e;
  }
});
