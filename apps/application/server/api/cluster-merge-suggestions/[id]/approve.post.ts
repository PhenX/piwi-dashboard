import { requireResolvedProjectAccess, requireRouteId } from '../../../utils/project-access';
import { approveMergeSuggestion, getSuggestionProjectId } from '#shared/handlers/cluster-merge-suggestions';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Approve a cluster merge suggestion',
    description:
      'Merges the two suggested clusters (lower id survives) and consumes the suggestion. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'suggestion ID');
  const { db } = await requireResolvedProjectAccess(event, id, getSuggestionProjectId, 'Suggestion');

  const result = await approveMergeSuggestion(db, id);
  if (!result) throw apiError({ statusCode: 409, message: 'Suggestion is not pending' });
  return { success: true, ...result };
});
