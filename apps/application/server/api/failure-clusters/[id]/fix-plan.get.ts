import { eq } from 'drizzle-orm';
import { getDatabase } from '../../../database';
import { failureClusters } from '../../../database/schema';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { buildFixPlan } from '../../../utils/fix-plan';
import { enrichFixPlanOwnership } from '../../../utils/scm/ownership';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Everything needed to fix a cluster, in one answer',
    description:
      'Assembles the diagnosis, its validated patch, the ranked locator replacements with the exact file and line to edit, the failing tests, and the command that verifies the work — the pieces an agent would otherwise gather from four separate calls and stitch together badly. `verify.expectation` states what the dashboard does once those tests pass, so the loop closes without a human deciding whether the fix worked. Every section degrades independently: a cluster with no diagnosis still returns its failing tests and verification command.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const clusterId = requireRouteId(event, 'id', 'cluster ID');
  const db = await getDatabase();

  const [cluster] = await db
    .select({ projectId: failureClusters.projectId })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  await requireProjectAccess(event, cluster.projectId);

  const plan = await buildFixPlan(db, clusterId);
  if (!plan) throw createError({ statusCode: 404, message: 'Failure cluster not found' });
  return enrichFixPlanOwnership(db, cluster.projectId, plan);
});
