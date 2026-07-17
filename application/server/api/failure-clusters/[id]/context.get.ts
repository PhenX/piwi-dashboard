import { failureClusters } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { buildDiagnosisContext } from '../../../utils/ai-context';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get AI diagnosis context preview',
    description:
      'Returns a preview of the full AI context that would be sent for diagnosis. Supports ?format=json for a structured response with per-section breakdown, token estimate, and coverage metadata.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['json'] } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  const query = getQuery(event);
  const baseCommit = query.baseCommit as string | undefined;
  const selectedCommitShasRaw = query.selectedCommitShas;
  const selectedCommitShas = Array.isArray(selectedCommitShasRaw)
    ? selectedCommitShasRaw.map(String)
    : selectedCommitShasRaw
      ? [String(selectedCommitShasRaw)]
      : undefined;
  const format = query.format as string | undefined;

  const ctx = await buildDiagnosisContext(db, {
    kind: 'cluster',
    clusterId: id,
    baseCommit,
    selectedCommitShas,
  });

  if (format === 'json') {
    return {
      scope: ctx.scope,
      text: ctx.text,
      sections: ctx.sections,
      coverage: ctx.coverage,
      scmChanges: ctx.scmChanges,
      tokenEstimate: ctx.tokenEstimate,
      textTokenEstimate: ctx.textTokenEstimate,
      imageTokenEstimate: ctx.imageTokenEstimate,
      cluster: ctx.cluster,
    };
  }

  return { context: ctx.text, coverage: ctx.coverage, scmChanges: ctx.scmChanges };
});
