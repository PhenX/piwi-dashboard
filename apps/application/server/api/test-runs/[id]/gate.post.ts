import { and, eq } from 'drizzle-orm';
import { getDatabase } from '../../../database';
import { failureClusters, projects, testCases, testRuns, testRunsCases } from '../../../database/schema';
import { requireProjectAccess } from '../../../utils/project-access';
import { computeRunInsights } from '#shared/handlers/run-insights';
import { evaluateGatePolicy, isEmptyPolicy, type GateFacts, type GatePolicy } from '@piwitests/core/gate';
import { parseTagFilter } from '#shared/utils/tag-filter';
import { getQuarantinedCaseIds } from '#shared/handlers/quarantine';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Evaluate a CI gate policy against a finished run',
    description:
      'Applies a pass/fail policy to a run and returns every violation, so a pipeline can block a merge on the analysis rather than on the raw exit code of `playwright test`. Rules: `requireTags` (every test carrying the tag must pass), `maxFailed`, `maxNewRegressions`, `maxNewFlaky`, `failOnNewCluster`, and `failOnFlaky` (any flaky test in the run). A required tag that matches no test in the run is itself a violation, so a typo cannot silently pass. Evaluation is read-only — the run is not modified.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              requireTags: { type: 'array', items: { type: 'string' } },
              maxFailed: { type: 'integer', minimum: 0 },
              maxNewRegressions: { type: 'integer', minimum: 0 },
              maxNewFlaky: { type: 'integer', minimum: 0 },
              failOnNewCluster: { type: 'boolean' },
              maxQuarantined: { type: 'integer', minimum: 0 },
              failOnFlaky: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
});

const FAIL_STATUSES = ['failed', 'timedOut', 'timedout'];

/** Read a non-negative integer, or undefined when the rule was not requested. */
function optionalCount(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw apiError({ statusCode: 400, message: 'Invalid test run ID' });

  const db = await getDatabase();
  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, id));
  if (!run) throw apiError({ statusCode: 404, message: 'Test run not found' });

  await requireProjectAccess(event, run.projectId);

  const body = (await readBody(event)) as Record<string, unknown> | null;
  const policy: GatePolicy = {
    requireTags: parseTagFilter(Array.isArray(body?.requireTags) ? body.requireTags.join(',') : undefined),
    maxFailed: optionalCount(body?.maxFailed),
    maxNewRegressions: optionalCount(body?.maxNewRegressions),
    maxNewFlaky: optionalCount(body?.maxNewFlaky),
    maxQuarantined: optionalCount(body?.maxQuarantined),
    failOnNewCluster: body?.failOnNewCluster === true,
    failOnFlaky: body?.failOnFlaky === true,
  };

  if (isEmptyPolicy(policy)) {
    throw apiError({
      statusCode: 400,
      message:
        'Gate policy is empty — pass at least one of requireTags, maxFailed, maxNewRegressions, maxNewFlaky, maxQuarantined, failOnNewCluster or failOnFlaky',
    });
  }

  if (run.status === 'running' || run.status === 'initializing') {
    throw apiError({ statusCode: 409, message: `Run #${id} has not finished yet (status: ${run.status})` });
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, run.projectId));

  const caseRows = await db
    .select({
      id: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      tags: testRunsCases.tags,
      title: testCases.title,
      filePath: testCases.filePath,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, id));

  // A test with retries has one row per attempt. It counts as passing when any
  // attempt passed, so a flaky-but-recovered test does not trip a required tag
  // — `maxNewFlaky` is the rule for that, and conflating the two would make
  // `requireTags` impossible to satisfy on any suite with retries enabled.
  const passedCaseIds = new Set<number>();
  for (const row of caseRows) {
    if (row.status === 'passed') passedCaseIds.add(row.testCaseId);
  }

  // A quarantined test still ran and still reported — it is only excluded from
  // the verdict. Counting it would defeat the point; hiding that it failed
  // would make a green gate untrustworthy, so the count is reported instead.
  const quarantined = await getQuarantinedCaseIds(db, run.projectId);
  const failingCaseIds = new Set(
    caseRows
      .filter((row) => FAIL_STATUSES.includes(row.status) && !passedCaseIds.has(row.testCaseId))
      .map((row) => row.testCaseId),
  );
  const quarantinedFailures = [...failingCaseIds].filter((id) => quarantined.has(id)).length;
  const countedFailures = Math.max(0, failingCaseIds.size - quarantinedFailures);

  const failingByTag: GateFacts['failingByTag'] = {};
  const unmatchedTags: string[] = [];

  for (const tag of policy.requireTags ?? []) {
    const tagged = caseRows.filter((row) => (Array.isArray(row.tags) ? (row.tags as string[]) : []).includes(tag));
    if (tagged.length === 0) {
      unmatchedTags.push(tag);
      failingByTag[tag] = [];
      continue;
    }

    // One entry per failing test, not per failing attempt.
    const reported = new Set<number>();
    failingByTag[tag] = tagged
      .filter((row) => {
        if (!FAIL_STATUSES.includes(row.status)) return false;
        if (passedCaseIds.has(row.testCaseId)) return false;
        if (quarantined.has(row.testCaseId)) return false;
        if (reported.has(row.testCaseId)) return false;
        reported.add(row.testCaseId);
        return true;
      })
      .map((row) => ({ title: row.title, filePath: row.filePath, executionId: row.id }));
  }

  const insights = await computeRunInsights(db, id).catch(() => null);

  const newClusters = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(and(eq(failureClusters.firstSeenRunId, id), eq(failureClusters.projectId, run.projectId)));

  const siteUrl = (process.env.PIWI_SITE_URL || '').replace(/\/$/, '');

  const facts: GateFacts = {
    runId: id,
    runUrl: siteUrl ? `${siteUrl}/test-runs/${id}` : `/test-runs/${id}`,
    projectName: project?.label || project?.name || 'unknown',
    status: run.status,
    totalTests: run.totalTests,
    failedTests: countedFailures,
    newRegressions: insights?.newRegressions.length ?? 0,
    newFlaky: insights?.newFlaky.length ?? 0,
    newClusters: newClusters.length,
    failingByTag,
    unmatchedTags,
    quarantinedFailures,
    quarantinedTotal: quarantined.size,
    flakyTests: run.flakyTests ?? 0,
  };

  return evaluateGatePolicy(facts, policy);
});
