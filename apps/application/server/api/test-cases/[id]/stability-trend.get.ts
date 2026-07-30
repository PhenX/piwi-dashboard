import { getTestCaseStabilityTrend } from '#shared/handlers/test-cases';
import { requireResolvedProjectAccess, requireRouteId, resolveCaseProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Stability trend for a test case',
    description:
      'Returns time-series of flaky rate, pass rate, avg duration grouped into N buckets for a single test case',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'buckets', in: 'query', schema: { type: 'integer', default: 20 } },
    ],
  },
});

export default eventHandler(async (event) => {
  const testCaseId = requireRouteId(event, 'id', 'test case ID');
  const { db } = await requireResolvedProjectAccess(event, testCaseId, resolveCaseProjectId, 'Test case');

  const bucketCount = parseInt((getQuery(event).buckets as string) || '20');

  try {
    return await getTestCaseStabilityTrend(db, testCaseId, bucketCount);
  } catch (err) {
    if (err instanceof Error && err.message === 'Test case not found') {
      throw createError({ statusCode: 404, message: 'Test case not found' });
    }
    throw err;
  }
});
