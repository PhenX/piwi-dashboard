import { getTestRunCase } from '#shared/handlers/test-cases';
import { requireResolvedProjectAccess, requireRouteId, resolveTestRunCaseProjectId } from '../../utils/project-access';
import { resolveWastedSettings } from '../../utils/wasted-settings';
import { resolveOwners } from '../../utils/scm/ownership';

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
  const { db, projectId } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

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

  // A test with no `piwi:owner` annotation still has an owner when the
  // repository's CODEOWNERS names one for its spec file.
  if (result.verdict && !result.verdict.owner && result.filePath) {
    const test = { filePath: result.filePath as string, owner: null };
    const resolved = await resolveOwners(db, projectId, [test]).catch(() => new Map());
    const owner = resolved.get(test)?.owner;
    if (owner) result.verdict.owner = { name: owner, source: 'codeowners' };
  }

  return result;
});
