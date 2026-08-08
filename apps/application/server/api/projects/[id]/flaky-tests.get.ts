import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { getProjectFlakyTests } from '#shared/handlers/projects';
import { parseTagFilter } from '#shared/utils/tag-filter';
import { withResolvedOwners } from '../../../utils/scm/ownership';
import { TEST_PRIORITIES } from '@piwitests/core/test-meta';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Flaky test analysis',
    description:
      'Analyzes test flakiness across recent runs using retry-pass detection and pass/fail alternation scoring. Pass an environment to scope the analysis to runs from that deployment environment.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'runs', in: 'query', required: false, schema: { type: 'integer' } },
      { name: 'environment', in: 'query', required: false, schema: { type: 'string' } },
      {
        name: 'tags',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comma-separated tags; a test must carry every one of them to appear',
      },
      {
        name: 'owner',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Exact owner declared via the `piwi:owner` annotation',
      },
      {
        name: 'priority',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        description: 'Priority declared via the `piwi:priority` annotation',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);

  const query = getQuery(event);
  const runsParam = parseInt((query.runs as string) || '50');
  const runsLimit = Math.min(200, Math.max(1, isNaN(runsParam) ? 50 : runsParam));
  const environment = typeof query.environment === 'string' && query.environment ? query.environment : undefined;

  const tags = parseTagFilter(typeof query.tags === 'string' ? query.tags : undefined);
  const rawPriority = typeof query.priority === 'string' ? query.priority.trim().toLowerCase() : '';
  const filter = {
    tags: tags.length > 0 ? tags : undefined,
    owner: typeof query.owner === 'string' && query.owner.trim() ? query.owner.trim() : undefined,
    priority: (TEST_PRIORITIES as readonly string[]).includes(rawPriority) ? rawPriority : undefined,
  };

  const db = await getDatabase();

  try {
    const rows = await getProjectFlakyTests(db, projectId, runsLimit, environment, filter);
    // Fill in the owner from CODEOWNERS for tests that declare none, so the
    // leaderboard can be read per team without anyone annotating a test.
    return { items: await withResolvedOwners(db, projectId, rows) };
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw createError({ statusCode: 404, message: 'Project not found' });
    }
    throw e;
  }
});
