import { and, eq } from 'drizzle-orm';
import { files, testCases, testRunsCases } from '../../../../../database/schema';
import { getTraceCallStackFromBlob } from '../../../../../utils/trace-evidence';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Full call stack of the failing action from the stored trace',
    description:
      "Parses the trace ZIP's stacks index and embedded source files into the complete call stack of the failing action — every frame with file:line, function name and a source window when the trace was recorded with sources. Returns `status: no-trace` / `no-stacks` (HTTP 200) when the data is absent; traces recorded without sources degrade to frames with `source: null`.",
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

  // Authorize by the case's own project — the data is read by caseId, so a
  // runId from an accessible project must not gate access to a case from
  // another project (the cluster page may pass a caseId from another run).
  const { db } = await requireResolvedProjectAccess(event, caseId, resolveTestRunCaseProjectId, 'Test run case');

  const [traceRows, caseRows] = await Promise.all([
    db
      .select({ path: files.path })
      .from(files)
      .where(and(eq(files.testRunsCaseId, caseId), eq(files.type, 'trace')))
      .limit(1),
    db
      .select({ filePath: testCases.filePath })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(eq(testRunsCases.id, caseId))
      .limit(1),
  ]);

  const blobPath = traceRows[0]?.path;
  if (!blobPath) return { status: 'no-trace' as const };

  return getTraceCallStackFromBlob(blobPath, caseRows[0]?.filePath ?? null);
});
