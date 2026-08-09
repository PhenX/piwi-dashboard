import { getTestRunCase } from '#shared/handlers/test-cases';
import { requireResolvedProjectAccess, requireRouteId, resolveTestRunCaseProjectId } from '../../utils/project-access';
import { resolveWastedSettings } from '../../utils/wasted-settings';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Get test run case detail',
    description:
      'Returns detailed information about a test run case (one execution in a test run) including test run data, failure cluster context, reports, and attachments.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  // Only custom patterns force a recompute; with the defaults the stored
  // wasted_time_ms is served as-is.
  const wasted = await resolveWastedSettings(db);
  const result = (await getTestRunCase(db, id, wasted.isDefault ? null : wasted.patterns)) as any;
  if (!result) {
    throw apiError({
      statusCode: 404,
      message: 'Test run case not found',
    });
  }

  return result;
});
