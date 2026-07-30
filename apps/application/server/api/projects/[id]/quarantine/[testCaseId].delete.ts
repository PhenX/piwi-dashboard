import { getDatabase } from '../../../../database';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { releaseQuarantine } from '#shared/handlers/quarantine';
import { requireAuth } from '../../../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Release a test from quarantine',
    description:
      'Lets a quarantined test block the CI gate again. The quarantine row is kept as history rather than deleted, so how long a test spent quarantined stays answerable.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'testCaseId', in: 'path', required: true, schema: { type: 'integer' } },
    ],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  const testCaseId = requireRouteId(event, 'testCaseId', 'test case ID');
  await requireAuth(event);
  await requireProjectAccess(event, projectId);

  const reason = typeof getQuery(event).reason === 'string' ? String(getQuery(event).reason).slice(0, 500) : null;

  const db = await getDatabase();
  const result = await releaseQuarantine(db, projectId, testCaseId, reason);
  if (!result.released) throw createError({ statusCode: 404, message: 'No active quarantine for this test' });
  return { success: true, ...result };
});
