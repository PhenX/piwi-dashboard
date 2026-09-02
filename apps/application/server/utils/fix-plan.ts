/**
 * A fix plan — everything an agent needs to repair one failure cluster, in a
 * single answer.
 *
 * The parts already existed and were scattered across four tools: the
 * diagnosis, the validated patch, the ranked locator replacement, the failing
 * tests, the source line to edit. An agent asking four questions and stitching
 * the answers together gets a worse result than one that is handed the plan.
 *
 * The last field is the one that matters most. `verify` tells the agent exactly
 * which command proves the work, and that Piwi will record the cluster as fixed
 * when those tests pass — so the loop closes without a human deciding whether
 * it worked.
 *
 * Nothing here leaves the machine it runs on: the dashboard is self-hosted, the
 * model is whatever the operator configured, and the patch was validated
 * against their own source. That is the whole point of doing this locally.
 */
import { and, desc, eq } from 'drizzle-orm';
import { failureClusters, failureDiagnoses, testCases, testRunsCases } from '../database/schema';
import { getLocatorHealingBatch } from './locator-healing';
import { validatePatch, type PatchValidation } from '#shared/patch';
import { parseCallsiteLocation } from '#shared/callsite-location';
import { buildRetryCommand } from '#shared/retry-command';
import type { LocatorEdit } from '#shared/locator-healing.types';
import type { DrizzleDB } from '#shared/handlers/db';

/** Executions inspected for locator suggestions — enough to cover a cluster. */
const MAX_HEALED_CASES = 5;

export interface FixPlanEdit {
  filePath: string;
  /** 1-based line the failing locator sits on, when the trace identified it. */
  line: number | null;
  /** The line as captured, so an agent can match before rewriting. */
  currentLine: string | null;
  /** The locator that broke. */
  failingLocator: string | null;
  /** The ranked replacement to use instead. */
  suggestedLocator: string | null;
  /** Stability score of the suggestion, 0-100. */
  score: number | null;
  /**
   * The ranked replacement as a ready-to-apply edit: the failing line rewritten,
   * plus a git-applyable unified diff. Null when there is no captured source line
   * to rewrite. Deterministic locator-line rewrite only — never model output.
   */
  edit: LocatorEdit | null;
  executionId: number;
}

export interface FixPlan {
  cluster: {
    id: number;
    title: string | null;
    signature: string;
    errorType: string | null;
    status: string;
    occurrences: number;
    /** Set when a previous fix landed and later broke again. */
    fixVerification: string | null;
  };
  diagnosis: {
    category: string | null;
    confidence: string | null;
    rootCause: string | null;
    summary: string | null;
    /** Unified diff proposed by the model. */
    patch: string | null;
    /** Whether that patch still applies to the current source. */
    patchValidation: PatchValidation | null;
  } | null;
  /** Concrete locator rewrites, one per failing call site. */
  edits: FixPlanEdit[];
  failingTests: Array<{ testCaseId: number; title: string; filePath: string; executionId: number }>;
  ownership: { owner: string | null; source: string | null };
  verify: {
    /** Playwright invocation that runs exactly the affected tests. */
    command: string;
    /** What happens on the dashboard when it passes. */
    expectation: string;
  };
}

/** Shell-quote a title for `-g`, since test titles routinely contain spaces. */
function quote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

/**
 * Build the plan for a cluster, or `null` when the cluster does not exist.
 * Every section degrades independently: a cluster with no diagnosis still
 * yields the failing tests and the verification command.
 */
export async function buildFixPlan(db: DrizzleDB, clusterId: number): Promise<FixPlan | null> {
  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const caseRows = await db
    .select({
      executionId: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      title: testCases.title,
      filePath: testCases.filePath,
      owner: testCases.owner,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.failureClusterId, clusterId))
    .orderBy(desc(testRunsCases.id))
    .limit(100);

  // One entry per test, newest execution first — an agent wants the current
  // shape of each failure, not every historical attempt at it.
  const seen = new Set<number>();
  const failingTests = caseRows
    .filter((row) => (seen.has(row.testCaseId) ? false : (seen.add(row.testCaseId), true)))
    .map((row) => ({
      testCaseId: row.testCaseId,
      title: row.title,
      filePath: row.filePath,
      executionId: row.executionId,
      owner: row.owner,
    }));

  const [diagnosisRow] = await db
    .select()
    .from(failureDiagnoses)
    .where(and(eq(failureDiagnoses.clusterId, clusterId), eq(failureDiagnoses.status, 'completed')))
    .orderBy(desc(failureDiagnoses.id))
    .limit(1);

  let diagnosis: FixPlan['diagnosis'] = null;
  if (diagnosisRow) {
    const details = diagnosisRow.details as { suggestedFix?: { patch?: unknown; patchValidation?: unknown } } | null;
    const patch = typeof details?.suggestedFix?.patch === 'string' ? details.suggestedFix.patch : null;
    diagnosis = {
      category: diagnosisRow.category,
      confidence: diagnosisRow.confidence,
      rootCause: diagnosisRow.rootCause,
      summary: diagnosisRow.summary,
      patch,
      // Prefer the validation stored at diagnosis time; fall back to a
      // structural re-parse so a plan always says whether the patch is usable.
      patchValidation:
        (details?.suggestedFix?.patchValidation as PatchValidation | undefined) ??
        (patch ? validatePatch(patch, new Map()) : null),
    };
  }

  const healingTargets = failingTests.slice(0, MAX_HEALED_CASES).map((test) => test.executionId);
  const healing = await getLocatorHealingBatch(db, healingTargets).catch(() => new Map());

  const edits: FixPlanEdit[] = [];
  for (const test of failingTests.slice(0, MAX_HEALED_CASES)) {
    const result = healing.get(test.executionId);
    const recommended = result?.recommendation?.recommended ?? null;
    if (!result || result.applicable === false || !recommended) continue;

    const loc = parseCallsiteLocation(result.location);
    edits.push({
      filePath: loc?.file || test.filePath,
      line: result.sourceLine?.line ?? loc?.line ?? null,
      currentLine: result.sourceLine?.text ?? null,
      failingLocator: result.failingLocator
        ? `${result.failingLocator.method}(${JSON.stringify(result.failingLocator.args)})`
        : null,
      suggestedLocator: recommended.locator,
      score: recommended.score ?? null,
      // The ready-to-apply edit is computed once by the healing lookup (with the
      // captured source snippet, so its diff carries context).
      edit: result.edit ?? null,
      executionId: test.executionId,
    });
  }

  // Ownership here is only what the test declared. CODEOWNERS resolution needs
  // an SCM client, which pulls in node-only crypto — the server enriches this
  // afterwards via `enrichFixPlanOwnership`, keeping this module bundleable for
  // the in-browser demo.
  const declaredOwner = failingTests.find((test) => test.owner)?.owner ?? null;

  // Files portion — POSIX-normalized, quoted and deduped by the same builder the
  // UI's retry command uses (so a Windows-captured path can't silently fail to
  // match), then scoped to exactly this cluster's tests by title.
  const fileCmd = buildRetryCommand(
    failingTests.map((test) => ({ filePath: test.filePath, title: test.title })),
    { mode: 'file' },
  );
  const titles = failingTests.slice(0, 5).map((test) => test.title);
  const grep = titles.length ? ` -g ${quote(titles.join('|'))}` : '';

  return {
    cluster: {
      id: cluster.id,
      title: cluster.title,
      signature: cluster.signature,
      errorType: cluster.errorType,
      status: cluster.status,
      occurrences: cluster.occurrences,
      fixVerification: cluster.fixVerification,
    },
    diagnosis,
    edits,
    failingTests: failingTests.map(({ owner: _owner, ...rest }) => rest),
    ownership: { owner: declaredOwner, source: declaredOwner ? 'annotation' : null },
    verify: {
      command: `${fileCmd || 'npx playwright test'}${grep}`,
      expectation:
        'Run the full suite afterwards. When every test in this cluster passes in one full run, Piwi records the fix — with the commit and how long the cluster was open — and the cluster stops being reported as open.',
    },
  };
}
