/**
 * Client-side implementations of the AI-diagnosis endpoints for demo mode.
 *
 * The demo has no real AI provider, but it still tells a fully-grounded story: for
 * every failing cluster it generates a diagnosis from that cluster's *actual* seeded
 * evidence (occurrences, failure rate, affected tests, browsers) and the canned SCM
 * history, then streams believable "thinking" tokens before returning a structured
 * result. Suggested-fix patches are validated for real against the seeded source
 * files, so the "verified patch" badge means the same thing it does in production.
 *
 * Diagnoses are persisted to the in-browser DB so they survive reloads; a
 * force-refresh snapshots the previous result into the version history first.
 */

import { eq, and } from 'drizzle-orm';
import {
  failureDiagnoses,
  failureDiagnosisVersions,
  testRunsCases,
  testRuns,
  failureClusters,
} from '../../../server/database/schema';
import type { FailureDiagnosis } from '../../../server/database/schema';
import { getDemoDb } from '../db.client';
import { CONTEXT_LIMIT_FIELDS, DEFAULT_CONTEXT_LIMITS } from '#shared/ai-context-limits';
import { validatePatch } from '#shared/patch';
import { buildDiagnosisVersionValues } from '#shared/handlers/diagnosis-versions';
import { collectClusterEvidence } from './diagnosis-context';
import type { ClusterEvidence } from './diagnosis-context';
import { getDemoScmProject, DEMO_FIX_PATCHES } from '../demo-scm';
import { publishDemoNotificationEvent } from '../run-events';

const DEMO_MODEL = 'demo-simulated';

/** GET /api/ai/status */
export async function apiGetAiStatus() {
  return { configured: true, provider: 'demo', model: DEMO_MODEL, autoDiagnose: false, source: 'demo' };
}

// ── Scripted diagnosis generation ────────────────────────────────────────────

type DiagnosisKind =
  | 'timeout-interaction'
  | 'goto-timeout'
  | 'http-500'
  | 'assertion-count'
  | 'strict-mode'
  | 'element-not-found'
  | 'generic';

function diagnosisKind(errorType: string | null, sampleError: string | null): DiagnosisKind {
  const e = sampleError ?? '';
  if (errorType === 'strict-mode') return 'strict-mode';
  if (/page\.goto/.test(e)) return 'goto-timeout';
  if (/Element not found|page\.fill/.test(e)) return 'element-not-found';
  if (errorType === 'timeout' || errorType === 'navigation') return 'timeout-interaction';
  if (/\b500\b|Server error/.test(e)) return 'http-500';
  if (errorType === 'assertion') return 'assertion-count';
  return 'generic';
}

interface DiagnosisScript {
  category: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  severity: 'blocker' | 'high' | 'medium' | 'low';
  affectedArea: string;
  summary: string;
  rootCause: string;
  hypotheses: Array<{ category: string; likelihood: number; rootCause: string; evidence: string[] }>;
  evidence: string[];
  investigationSteps: string[];
  preventionTips: string[];
  suggestedFix: { description: string; file: string | null; code: string | null; patch: string | null };
  thinkingChunks: string[];
}

/** First affected test's short name, for interpolation. */
function firstTest(ev: ClusterEvidence): string {
  return ev.affectedTests[0]?.title ?? ev.rep?.title ?? 'the affected test';
}

function browsersSentence(ev: ClusterEvidence): string {
  if (!ev.browsers.length) return 'all browsers';
  return ev.browsers.map((b) => `${b.name} (${b.count})`).join(', ');
}

function buildScript(kind: DiagnosisKind, ev: ClusterEvidence): DiagnosisScript {
  const proj = getDemoScmProject(ev.cluster.projectId);
  const suspect = proj?.commits.find((c) => c.sha === proj.suspectShas[0]);
  const suspectLine = suspect ? `\`${suspect.sha.slice(0, 7)}\` "${suspect.message}"` : 'a recent commit';
  const rate = ev.failureRatePct;
  const runs = `${ev.failedRuns}/${ev.runsInProject} runs (${rate}%)`;
  const tests = ev.affectedTests.length;

  switch (kind) {
    case 'timeout-interaction':
      return {
        category: 'infrastructure',
        confidence: 'high',
        confidenceScore: 82,
        severity: 'high',
        affectedArea: 'checkout / payment',
        summary: `${firstTest(ev)} times out clicking the target element — the page renders slowly on CI and the click races the render.`,
        rootCause: `The locator times out because the target element is present in the DOM but not yet interactive when the click fires. ${suspect ? `The introduction of ${suspectLine} added a third-party script fetch that delays the form becoming interactive; ` : ''}on a loaded CI runner this consistently exceeds the default 30s timeout.`,
        hypotheses: [
          {
            category: 'infrastructure',
            likelihood: 82,
            rootCause:
              'Slow CI runner renders the form too late; the click exceeds the timeout before the element is interactive.',
            evidence: [
              `Failure rate correlates with CI load — ${runs} [recurrenceFlakiness]`,
              'Element present in the DOM but not interactive at click time [steps]',
            ],
          },
          {
            category: 'test-bug',
            likelihood: 38,
            rootCause: 'The test clicks without an explicit wait for the element to be ready.',
            evidence: ['No waitForLoadState/waitFor precedes the click [testSource]'],
          },
        ],
        evidence: [
          `TimeoutError fires during the click across ${tests} test(s) [executionError]`,
          `Recurs in ${runs}, and the SCM diff shows a new async dependency [scmInvestigation]`,
          `Affects ${browsersSentence(ev)} [browserDistribution]`,
        ],
        investigationSteps: [
          'Re-run the cluster on a low-load runner to confirm CI variability is the driver',
          'Check whether the page fires a network-idle event before the target becomes interactive',
        ],
        preventionTips: [
          'Await page.waitForLoadState("networkidle") before interacting with dynamically loaded content',
          'Add a CI-aware timeout multiplier for critical interactions',
        ],
        suggestedFix: {
          description:
            'Wait for the network to settle before clicking, so the click no longer races the third-party form render.',
          file: DEMO_FIX_PATCHES.checkoutWait.file,
          code: null,
          patch: DEMO_FIX_PATCHES.checkoutWait.patch,
        },
        thinkingChunks: [
          'Starting from the error signature — this is a **locator timeout**, not an assertion failure.\n\n',
          `The cluster recurs in **${runs}**. A deterministic bug would fail every run; an intermittent rate this shape points at timing.\n\n`,
          'The element is in the DOM (the locator resolves) but the click never lands — so it is present-but-not-interactive.\n\n',
          `Cross-referencing the SCM diff: ${suspectLine} added a third-party payment SDK fetched before the form is enabled.\n\n`,
          'On a loaded CI runner that fetch pushes interactivity past the 30s timeout. Primary hypothesis: infrastructure-amplified race. Writing it up.\n\n',
        ],
      };

    case 'goto-timeout':
      return {
        category: 'infrastructure',
        confidence: 'high',
        confidenceScore: 78,
        severity: 'high',
        affectedArea: 'mobile navigation',
        summary: `page.goto exceeds the 30s navigation timeout on ${browsersSentence(ev)} — the landing page ships heavy unoptimized assets.`,
        rootCause: `The navigation timeout is exceeded during initial page load. ${suspect ? `${suspectLine} added a full-bleed hero image with no optimization; ` : ''}on throttled mobile CI networks the load never completes inside the default timeout.`,
        hypotheses: [
          {
            category: 'infrastructure',
            likelihood: 78,
            rootCause: 'Heavy unoptimized assets push mobile page load past the goto timeout on CI networks.',
            evidence: [
              'Timeout occurs on the main navigation load, not a later interaction [executionError]',
              `Only affects the mobile browser profile — ${browsersSentence(ev)} [browserDistribution]`,
            ],
          },
          {
            category: 'environment',
            likelihood: 34,
            rootCause: 'CI network throttling specific to the mobile project profile.',
            evidence: [`Page load time tracks asset deploys [webVitals]`],
          },
        ],
        evidence: [
          `page.goto TimeoutError across ${tests} test(s) [executionError]`,
          `Recurs in ${runs} [recurrenceFlakiness]`,
          `A new large asset was added in the diff [scmInvestigation]`,
        ],
        investigationSteps: [
          'Measure page weight and largest-contentful-paint on the mobile profile',
          'Compare goto timing on local mobile emulation vs CI',
        ],
        preventionTips: [
          'Set browser-specific navigation timeouts via Playwright config projects',
          'Optimize landing-page assets for mobile (responsive images, lazy-loading)',
        ],
        suggestedFix: {
          description: 'Raise the navigation timeout for the mobile profile while the asset weight is addressed.',
          file: DEMO_FIX_PATCHES.mobileTimeout.file,
          code: null,
          patch: DEMO_FIX_PATCHES.mobileTimeout.patch,
        },
        thinkingChunks: [
          'The error is a **navigation timeout** (page.goto), so this is about page load, not an element.\n\n',
          `It only shows up on ${browsersSentence(ev)} — a browser-specific signal, which argues against a universal app bug.\n\n`,
          `The SCM diff has ${suspectLine}, adding a large hero image. That inflates load weight on mobile.\n\n`,
          `Recurrence is ${runs}, consistent with a slow-but-not-always-over-the-line load on variable CI networks. Concluding: infrastructure.\n\n`,
        ],
      };

    case 'http-500':
      return {
        category: 'app-bug',
        confidence: 'high',
        confidenceScore: 90,
        severity: 'blocker',
        affectedArea: 'authentication / login',
        summary: `The endpoint returns HTTP 500 instead of the expected status — a server-side regression in the login handler.`,
        rootCause: `The assertion fails because the endpoint responds 500. ${suspect ? `${suspectLine} changed credential verification to return null instead of throwing, and the login handler then dereferences a null user → unhandled exception → 500.` : 'An unhandled exception in the handler produces a 500 on the affected path.'}`,
        hypotheses: [
          {
            category: 'app-bug',
            likelihood: 90,
            rootCause:
              'The login handler dereferences a null user after the auth refactor, throwing and returning 500.',
            evidence: [
              'Expected vs Received shows a 500 where 200 was expected [executionError]',
              'Backend logs show an unhandled exception on the request [serverLogs]',
              `The auth refactor commit changed the null-user path [scmInvestigation]`,
            ],
          },
        ],
        evidence: [
          `Received 500 across ${tests} auth test(s) [executionError]`,
          'Server logs capture the 5xx and stack on the failing request [serverLogs]',
          `Started after ${suspectLine} [scmInvestigation]`,
        ],
        investigationSteps: [
          'Inspect the server stack trace behind the 500 on the login route',
          'Confirm the null-user branch in the refactored handler',
        ],
        preventionTips: [
          'Add integration tests exercising the auth endpoint with missing/invalid users',
          'Add error monitoring on 5xx responses for the auth route',
        ],
        suggestedFix: {
          description:
            'Restore the missing-user guard the refactor dropped, so the handler returns 401 instead of dereferencing null.',
          file: DEMO_FIX_PATCHES.authGuard.file,
          code: null,
          patch: DEMO_FIX_PATCHES.authGuard.patch,
        },
        thinkingChunks: [
          'The assertion compares status codes — Expected 200, Received 500. A 500 is server-side, so this is very likely an app bug, not a test bug.\n\n',
          'The backend server logs on the failing request show an unhandled exception, not a timeout — confirming a thrown error.\n\n',
          `The SCM diff points at ${suspectLine}: verifyCredentials now returns null instead of throwing, and the handler still reads user.id.\n\n`,
          `That null dereference is the 500. Recurrence is ${runs}. High confidence: app-bug in the login handler. Writing the fix.\n\n`,
        ],
      };

    case 'strict-mode':
      return {
        category: 'test-flakiness',
        confidence: 'medium',
        confidenceScore: 66,
        severity: 'medium',
        affectedArea: 'UI components / button',
        summary: `Strict-mode violation: getByRole('button') matches multiple rendered variants, so the unscoped locator is ambiguous.`,
        rootCause: `The component page now renders several button variants side by side, so getByRole('button') resolves to more than one element and Playwright's strict mode throws. ${suspect ? `The variants were added in ${suspectLine}.` : ''} The locator needs scoping.`,
        hypotheses: [
          {
            category: 'test-bug',
            likelihood: 66,
            rootCause:
              "getByRole('button') matches multiple button variants; the locator must be scoped by name or container.",
            evidence: [
              'Strict-mode violation resolving to multiple elements [executionError]',
              'The ARIA snapshot shows several button nodes on the page [ariaSnapshot]',
              'Locator healing offers a scoped, higher-stability alternative [locatorHealing]',
            ],
          },
        ],
        evidence: [
          'Deterministic strict-mode violation, not intermittent [recurrenceFlakiness]',
          'Multiple buttons rendered by design [ariaSnapshot]',
          'A name-scoped locator disambiguates [locatorHealing]',
        ],
        investigationSteps: [
          'Confirm the page intentionally renders multiple button variants',
          'Pick a scoping strategy (name filter or container) with the component owner',
        ],
        preventionTips: [
          'Scope locators to a container when multiple matches are expected',
          'Add data-testid attributes to disambiguate similar components',
        ],
        suggestedFix: {
          description: 'Scope the locator to a specific variant with a name filter so it matches exactly one button.',
          file: DEMO_FIX_PATCHES.buttonScope.file,
          code: null,
          patch: DEMO_FIX_PATCHES.buttonScope.patch,
        },
        thinkingChunks: [
          'The error text says **strict mode violation** — the locator matched more than one element. That is a locator problem, not an app failure.\n\n',
          'The ARIA snapshot confirms several button nodes are present on the page at once.\n\n',
          `This is deterministic (${runs}) — it fails the same way every time, which rules out a race.\n\n`,
          'Locator healing already ranks a name-scoped alternative highest. The fix is to scope the query. Concluding: test-bug / flakiness.\n\n',
        ],
      };

    case 'assertion-count':
      return {
        category: 'app-bug',
        confidence: 'medium',
        confidenceScore: 64,
        severity: 'medium',
        affectedArea: 'checkout / cart',
        summary: `An assertion expected a non-zero value but received 0 — the computed cart state is empty when it should not be.`,
        rootCause: `The received value is 0 where a positive count was expected, so the underlying state (cart contents / total) was not populated by the time of the assertion. This is consistent with a data or state bug rather than a timing issue given its recurrence.`,
        hypotheses: [
          {
            category: 'app-bug',
            likelihood: 64,
            rootCause: 'The cart state is not updated before the assertion reads it — a state/data bug.',
            evidence: [
              `Received 0 where a positive value was expected [executionError]`,
              `Recurs in ${runs} [recurrenceFlakiness]`,
            ],
          },
          {
            category: 'test-bug',
            likelihood: 40,
            rootCause: 'The assertion runs before the async cart update resolves.',
            evidence: ['No explicit wait for the cart state precedes the assertion [steps]'],
          },
        ],
        evidence: [
          `Expected a positive count, received 0 [executionError]`,
          `Consistent across ${runs} [recurrenceFlakiness]`,
        ],
        investigationSteps: [
          'Log the cart state immediately before the assertion',
          'Confirm whether the update is async and unawaited',
        ],
        preventionTips: ['Await the state mutation (or poll) before asserting derived counts'],
        suggestedFix: {
          description:
            'Poll for the expected cart count before asserting, so an async update cannot race the assertion.',
          file: 'tests/checkout/cart.spec.ts',
          code: 'await expect.poll(() => cart.itemCount()).toBeGreaterThan(0);',
          patch: null,
        },
        thinkingChunks: [
          'Expected a positive count, Received 0 — the derived state is empty at assertion time.\n\n',
          `It recurs in ${runs}. Persistent enough to be a real state bug rather than pure flake, but I will keep a timing hypothesis open.\n\n`,
          'Most likely the cart update has not landed before the assertion reads it. Recommending a poll and a state-population check.\n\n',
        ],
      };

    case 'element-not-found':
      return {
        category: 'app-bug',
        confidence: 'medium',
        confidenceScore: 60,
        severity: 'medium',
        affectedArea: 'mobile forms',
        summary: `page.fill fails because the target input is not present — the field is missing or not yet mounted when the test acts.`,
        rootCause: `The element the test fills cannot be found. Either the field was renamed/removed, or it mounts after the test tries to interact. Locator healing can suggest the element's current identity when it was renamed.`,
        hypotheses: [
          {
            category: 'app-bug',
            likelihood: 55,
            rootCause: 'The input was renamed or removed, so the selector no longer matches.',
            evidence: ['Element-not-found on a fill action [executionError]'],
          },
          {
            category: 'test-bug',
            likelihood: 45,
            rootCause: 'The test acts before the field is mounted.',
            evidence: ['No wait for the field precedes the fill [steps]'],
          },
        ],
        evidence: [
          `Element not found on fill across ${tests} test(s) [executionError]`,
          `Recurs in ${runs} [recurrenceFlakiness]`,
        ],
        investigationSteps: [
          'Confirm the field still exists with the expected selector',
          'Check whether the field mounts asynchronously',
        ],
        preventionTips: ['Prefer role/label locators over brittle selectors', 'Await the field before filling'],
        suggestedFix: {
          description:
            'Wait for the field to be attached before filling, and verify its current locator via locator healing.',
          file: 'tests/mobile/forms.spec.ts',
          code: "await page.getByLabel('Email').waitFor();\nawait page.getByLabel('Email').fill('user@example.com');",
          patch: null,
        },
        thinkingChunks: [
          'The failing action is a fill that cannot find its target element.\n\n',
          `Recurrence is ${runs}. I need to separate "element renamed" (app change) from "acted too early" (test bug).\n\n`,
          'Recommending a waitFor plus a locator-healing check of the current identity. Confidence medium.\n\n',
        ],
      };

    default:
      return {
        category: 'unknown',
        confidence: 'low',
        confidenceScore: 45,
        severity: 'medium',
        affectedArea: ev.rep?.filePath ?? 'unknown',
        summary: `${firstTest(ev)} fails, but the available evidence is not conclusive about the root cause.`,
        rootCause:
          'The failure signature does not match a known pattern with high confidence. More evidence (trace, server logs, or a baseline diff) would narrow it down.',
        hypotheses: [
          {
            category: 'unknown',
            likelihood: 45,
            rootCause: 'Insufficient evidence to assign a confident category.',
            evidence: [`Recurs in ${runs} [recurrenceFlakiness]`],
          },
        ],
        evidence: [`Failure recurs in ${runs} [recurrenceFlakiness]`, 'Error signature is unmatched [executionError]'],
        investigationSteps: [
          'Enable trace recording to capture the failing action',
          'Pin a baseline commit to fetch the SCM diff',
        ],
        preventionTips: ['Capture traces and server logs on failure for richer diagnosis'],
        suggestedFix: {
          description: 'Gather a trace and re-run diagnosis with a pinned baseline.',
          file: null,
          code: null,
          patch: null,
        },
        thinkingChunks: [
          'The error signature does not match a known template cleanly.\n\n',
          `Recurrence is ${runs}. Without a trace or a baseline diff I cannot assign high confidence.\n\n`,
          'Reporting a low-confidence result and the evidence that would sharpen it.\n\n',
        ],
      };
  }
}

/** Build a full diagnosis details payload + top-level fields from a cluster's evidence. */
async function generateDiagnosis(
  clusterId: number,
  opts: { additionalContext?: string | null; selectedCommitShas?: string[] | null },
) {
  const db = await getDemoDb();
  const ev = await collectClusterEvidence(db, clusterId);
  if (!ev) throw new Error(`Cluster ${clusterId} not found`);

  const kind = diagnosisKind(ev.cluster.errorType, ev.cluster.sampleError);
  const script = buildScript(kind, ev);

  const proj = getDemoScmProject(ev.cluster.projectId);
  const autoSelectedCommits = proj?.suspectShas.slice(0, 3) ?? [];

  // Validate the suggested patch for real against the seeded source files.
  const sourceFiles = new Map((proj?.sourceFiles ?? []).map((f) => [f.path, f.content] as const));
  const patchValidation = script.suggestedFix.patch ? validatePatch(script.suggestedFix.patch, sourceFiles) : null;

  // Realistic two-stage pipeline token accounting.
  const baseInput = 900 + ev.affectedTests.length * 120 + (ev.rep ? 400 : 0);
  const pipeline = [
    {
      role: 'research',
      model: 'demo-research',
      inputTokens: Math.round(baseInput * 0.6),
      outputTokens: 180,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    {
      role: 'diagnosis',
      model: DEMO_MODEL,
      inputTokens: baseInput,
      outputTokens: 320 + script.hypotheses.length * 40,
      cacheCreationInputTokens: Math.round(baseInput * 0.4),
      cacheReadInputTokens: Math.round(baseInput * 0.5),
    },
  ];
  const inputTokens = pipeline.reduce((s, p) => s + p.inputTokens, 0);
  const outputTokens = pipeline.reduce((s, p) => s + p.outputTokens, 0);

  const details = {
    confidenceScore: script.confidenceScore,
    severity: script.severity,
    affectedArea: script.affectedArea,
    hypotheses: script.hypotheses,
    evidence: script.evidence,
    suggestedFix: script.suggestedFix,
    preventionTips: script.preventionTips,
    investigationSteps: script.investigationSteps,
    pipeline,
    autoSelectedCommits,
    selectedCommitShas: opts.selectedCommitShas ?? null,
    additionalContext: opts.additionalContext ?? null,
    patchValidation,
  };

  return {
    ev,
    thinkingChunks: script.thinkingChunks,
    row: {
      category: script.category,
      confidence: script.confidence,
      summary: script.summary,
      rootCause: script.rootCause,
      details,
      inputTokens,
      outputTokens,
    },
  };
}

// ── Persistence helpers ──────────────────────────────────────────────────────

/** Snapshot the current cluster diagnosis into the version history, then delete it. */
async function snapshotAndClear(db: Awaited<ReturnType<typeof getDemoDb>>, clusterId: number): Promise<void> {
  const [existing] = await db.select().from(failureDiagnoses).where(eq(failureDiagnoses.clusterId, clusterId)).limit(1);
  if (!existing) return;
  await db.insert(failureDiagnosisVersions).values(buildDiagnosisVersionValues(existing, new Date()));
  await db.delete(failureDiagnoses).where(eq(failureDiagnoses.id, existing.id));
}

async function persistDiagnosis(
  clusterId: number | null,
  gen: Awaited<ReturnType<typeof generateDiagnosis>>,
  scope: 'cluster' | 'execution' = 'cluster',
  testRunsCaseId: number | null = null,
): Promise<FailureDiagnosis> {
  const db = await getDemoDb();
  const now = new Date();
  const durationMs = 1800 + gen.thinkingChunks.reduce((s, c) => s + c.length, 0);
  const [saved] = await db
    .insert(failureDiagnoses)
    .values({
      clusterId,
      scope,
      testRunsCaseId,
      status: 'completed',
      provider: 'demo',
      model: DEMO_MODEL,
      category: gen.row.category,
      confidence: gen.row.confidence,
      summary: gen.row.summary,
      rootCause: gen.row.rootCause,
      details: gen.row.details,
      error: null,
      inputTokens: gen.row.inputTokens,
      outputTokens: gen.row.outputTokens,
      durationMs,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Look up project for the notification event — cluster-scoped rows resolve via the
  // cluster; execution-scoped rows carry no cluster and resolve via the execution's run.
  let projectId = 0;
  if (clusterId != null) {
    const [cluster] = await db
      .select({ projectId: failureClusters.projectId })
      .from(failureClusters)
      .where(eq(failureClusters.id, clusterId))
      .limit(1);
    projectId = cluster?.projectId ?? 0;
  } else if (testRunsCaseId != null) {
    const [run] = await db
      .select({ projectId: testRuns.projectId })
      .from(testRunsCases)
      .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
      .where(eq(testRunsCases.id, testRunsCaseId))
      .limit(1);
    projectId = run?.projectId ?? 0;
  }

  publishDemoNotificationEvent({
    type: 'diagnosis.completed',
    clusterId: clusterId ?? 0,
    projectId,
    summary: gen.row.summary,
    rootCause: gen.row.rootCause,
    category: gen.row.category,
    confidence: gen.row.confidence,
  });

  return saved!;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

/** POST /api/failure-clusters/:id/diagnose (non-streaming fallback) */
export async function apiDiagnoseCluster(clusterId: number, body?: Record<string, unknown>): Promise<FailureDiagnosis> {
  const db = await getDemoDb();
  await snapshotAndClear(db, clusterId);
  const gen = await generateDiagnosis(clusterId, {
    additionalContext: (body?.additionalContext as string) ?? null,
    selectedCommitShas: (body?.selectedCommitShas as string[]) ?? null,
  });
  return persistDiagnosis(clusterId, gen);
}

/** POST /api/test-run-cases/:id/diagnose (execution scope) */
export async function apiDiagnoseExecution(
  testRunsCaseId: number,
  body?: Record<string, unknown>,
): Promise<FailureDiagnosis> {
  const db = await getDemoDb();
  const [trc] = await db
    .select({ clusterId: testRunsCases.failureClusterId })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, testRunsCaseId));
  if (!trc) throw new Error('Execution not found');
  // Every failing demo case belongs to a cluster; ground the diagnosis in that cluster's
  // evidence when present (the common path). If a failure ever had no cluster the diagnose
  // action simply wouldn't fire, so a missing cluster is a hard error, not a silent no-op.
  if (!trc.clusterId) throw new Error('Execution has no failure to diagnose');

  // Snapshot/replace any existing execution-scoped row for this case.
  const [existing] = await db
    .select()
    .from(failureDiagnoses)
    .where(and(eq(failureDiagnoses.testRunsCaseId, testRunsCaseId), eq(failureDiagnoses.scope, 'execution')))
    .limit(1);
  if (existing) {
    await db.insert(failureDiagnosisVersions).values(buildDiagnosisVersionValues(existing, new Date()));
    await db.delete(failureDiagnoses).where(eq(failureDiagnoses.id, existing.id));
  }

  const gen = await generateDiagnosis(trc.clusterId, {
    additionalContext: (body?.additionalContext as string) ?? null,
    selectedCommitShas: (body?.selectedCommitShas as string[]) ?? null,
  });
  // Execution-scoped rows persist a null cluster (mirrors the server + keeps the
  // (cluster_id, scope) unique index from colliding across executions of one cluster).
  return persistDiagnosis(null, gen, 'execution', testRunsCaseId);
}

/**
 * POST /api/failure-clusters/:id/diagnose/stream
 *
 * Streams realistic thinking tokens grounded in the cluster's real evidence, then a
 * final structured result. Persists the result to the demo DB so a later GET returns
 * it. `?force=true` snapshots the previous result into the version history first.
 */
export async function apiStreamDiagnoseCluster(
  clusterId: number,
  body?: Record<string, unknown>,
  query?: URLSearchParams,
): Promise<Response> {
  const force = query?.get('force') === 'true';
  const db = await getDemoDb();
  const encoder = new TextEncoder();

  const sse = (stream: ReadableStream) =>
    new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });

  if (force) {
    await snapshotAndClear(db, clusterId);
  } else {
    // If a completed diagnosis already exists, replay it immediately.
    const [existing] = await db
      .select()
      .from(failureDiagnoses)
      .where(eq(failureDiagnoses.clusterId, clusterId))
      .limit(1);
    if (existing?.status === 'completed') {
      const data = JSON.stringify(existing);
      return sse(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`event: result\ndata: ${data}\n\n`));
            controller.close();
          },
        }),
      );
    }
  }

  const gen = await generateDiagnosis(clusterId, {
    additionalContext: (body?.additionalContext as string) ?? null,
    selectedCommitShas: (body?.selectedCommitShas as string[]) ?? null,
  });
  const saved = await persistDiagnosis(clusterId, gen);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (const chunk of gen.thinkingChunks) {
          controller.enqueue(encoder.encode(`event: thinking\ndata: ${JSON.stringify({ text: chunk })}\n\n`));
          await new Promise((r) => setTimeout(r, Math.max(300, Math.min(1100, chunk.length * 4))));
        }
        controller.enqueue(encoder.encode(`event: result\ndata: ${JSON.stringify(saved)}\n\n`));
        controller.close();
      } catch {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return sse(stream);
}

// ── Settings (read-only in demo) ─────────────────────────────────────────────

/** GET /api/settings/ai — presents a read-only, env-managed demo provider. */
export async function apiGetAiSettings() {
  const demoRole = {
    provider: 'demo',
    model: DEMO_MODEL,
    baseUrl: null,
    hasApiKey: true,
    reuse: null,
    envManaged: true,
  };
  return {
    roles: { diagnosis: demoRole, research: null, embedding: null },
    autoDiagnose: false,
    hasScmToken: true,
    envManaged: true,
    customInstructions: null,
  };
}

/** PUT /api/settings/ai — no-op in demo (config is fixed). */
export async function apiPutAiSettings(_body: unknown) {
  return { success: true };
}

/** POST /api/settings/ai/test */
export async function apiTestAiSettings() {
  return {
    success: true as const,
    provider: 'demo',
    model: DEMO_MODEL,
    note: 'Demo provider — diagnoses are simulated from seeded evidence.',
  };
}

/** GET /api/settings/ai/limits */
export async function apiGetAiLimits() {
  return { limits: DEFAULT_CONTEXT_LIMITS, envManaged: [], fields: CONTEXT_LIMIT_FIELDS };
}

/** PUT /api/settings/ai/limits — no-op in demo */
export async function apiPutAiLimits(_body: unknown) {
  return { success: true };
}

/** GET /api/settings/ai/usage — synthesised from stored demo diagnoses. */
export async function apiGetAiUsage() {
  const db = await getDemoDb();
  const rows = await db
    .select({
      model: failureDiagnoses.model,
      inputTokens: failureDiagnoses.inputTokens,
      outputTokens: failureDiagnoses.outputTokens,
    })
    .from(failureDiagnoses)
    .where(eq(failureDiagnoses.status, 'completed'));

  let inputTokens = 0;
  let outputTokens = 0;
  for (const r of rows) {
    inputTokens += r.inputTokens ?? 0;
    outputTokens += r.outputTokens ?? 0;
  }
  const byModel = rows.length ? [{ model: DEMO_MODEL, diagnoses: rows.length, inputTokens, outputTokens }] : [];
  return {
    days: 30,
    totals: { diagnoses: rows.length, inputTokens, outputTokens },
    byModel,
  };
}
