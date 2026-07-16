import { getTestRunCase } from '#shared/handlers/test-cases';
import { Role } from '#shared/types';
import { requireResolvedProjectAccess, requireRouteId, resolveTestRunCaseProjectId } from '../../utils/project-access';
import { resolveWastedSettings } from '../../utils/wasted-settings';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Get test run case detail',
    description:
      'Returns detailed information about a test run case (one execution in a test run) including test run data, failure cluster context, reports, and attachments.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
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
    throw createError({
      statusCode: 404,
      message: 'Test run case not found',
    });
  }

  return result;
});
