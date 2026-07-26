import { collectExecutionBundle } from '#shared/export/collect';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';
import { exportPiwiVersion, exportSourceUrl, requireExportFormat, sendExport } from '../../../utils/export-request';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Export one execution as an offline report',
    description:
      'Downloads a single test execution with its evidence, readable without a network connection. `html` is one self-contained file with screenshots and video embedded; `zip` adds the raw artifacts (including trace archives) plus a machine-readable `data.json`; `md` and `json` are text only. Add `print=1` to an HTML export to open the browser print dialog for "Save as PDF". Evidence beyond the configured size budget is listed in the report as omitted.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['html', 'zip', 'json', 'md'] } },
      { name: 'print', in: 'query', required: false, schema: { type: 'string', enum: ['1'] } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');
  const format = requireExportFormat(event);

  const bundle = await collectExecutionBundle(db, id, {
    maxCases: 1,
    sourceUrl: exportSourceUrl(event, `/test-run-cases/${id}`),
    piwiVersion: exportPiwiVersion(event),
  });
  if (!bundle) {
    throw createError({ statusCode: 404, message: 'Test run case not found' });
  }

  return sendExport(event, bundle, format, id);
});
