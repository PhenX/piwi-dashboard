import { saveLocatorPick, type LocatorPickInput } from '../../../../../utils/locator-healing';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Save a user-picked locator for a failing test case',
    description:
      'Saves a locator picked by a user from the interactive DOM snapshot picker. The pick is keyed to the failing locator call site (location and signature re-derived server-side from the stored error) and appears first in subsequent locator-healing responses. Any authenticated project member may save a pick.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run id' },
      { name: 'caseId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['pickedLocator'],
            properties: {
              failingLocator: {
                type: 'object',
                description:
                  'The failing locator as displayed in the panel — identity fallback when the stored error cannot be re-parsed.',
                properties: {
                  method: { type: 'string' },
                  args: { type: 'object' },
                },
              },
              pickedLocator: {
                type: 'object',
                properties: {
                  locator: { type: 'string' },
                  method: { type: 'string' },
                  args: { type: 'object' },
                  score: { type: 'number' },
                },
              },
              element: {
                type: 'object',
                description:
                  'The picked element as probed in the DOM snapshot: tagName, attributes, textContent, accessibleName, center.',
              },
            },
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  requireRouteId(event, 'id', 'runId');
  const caseId = requireRouteId(event, 'caseId', 'caseId');

  // Authorized by the case's own project — the caseId may belong to a run
  // other than [id] (e.g. opened from the cluster page).
  const { db } = await requireResolvedProjectAccess(event, caseId, resolveTestRunCaseProjectId, 'Test run case');

  const body = await readBody<LocatorPickInput>(event);
  if (!body?.pickedLocator?.locator) {
    throw createError({ statusCode: 400, message: 'Missing pickedLocator' });
  }

  const result = await saveLocatorPick(db, caseId, body);
  if (result.status === 'not-found') {
    throw createError({ statusCode: 404, message: 'Test run case not found' });
  }
  return result;
});
