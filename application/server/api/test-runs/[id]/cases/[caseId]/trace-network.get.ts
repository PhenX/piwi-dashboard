import { and, eq } from 'drizzle-orm';
import { files } from '../../../../../database/schema';
import { getTraceNetworkFromBlob } from '../../../../../utils/trace-evidence';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Full network activity recorded in the stored trace',
    description:
      "Parses the trace ZIP's HAR-like network stream into every request the page made — all resource types with status, sizes, timing phases, a relative waterfall timeline and the failing action's time window. Sensitive header values are masked and never returned; response bodies are fetched separately via the trace-network-body endpoint. Returns `status: no-trace` / `empty` (HTTP 200) when the data is absent.",
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run id' },
      { name: 'caseId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  requireRouteId(event, 'id', 'runId');
  const caseId = requireRouteId(event, 'caseId', 'caseId');

  // Authorize by the case's own project — see trace-stacks.get.ts.
  const { db } = await requireResolvedProjectAccess(event, caseId, resolveTestRunCaseProjectId, 'Test run case');

  const traceRows = await db
    .select({ path: files.path })
    .from(files)
    .where(and(eq(files.testRunsCaseId, caseId), eq(files.type, 'trace')))
    .limit(1);

  const blobPath = traceRows[0]?.path;
  if (!blobPath) return { status: 'no-trace' as const };

  return getTraceNetworkFromBlob(blobPath);
});
