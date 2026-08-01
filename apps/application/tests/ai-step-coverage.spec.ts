/**
 * End-to-end coverage for the AI-step usage surface: submit a run whose test
 * cases carry the reporter's `aiUsage` manifest, then assert the project
 * `ai-steps` endpoint aggregates it. Exercises the full ingest path
 * (submit → sanitize → the `ai_usage` column) that the handler unit test cannot.
 */
import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

const RUN_START = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const SHARED = 'tests/__piwi__/login.spec.ts/sign-in.the-email-field.aaaa1111.json';
const FLOW = 'tests/__piwi__/login.spec.ts/sign-in.sign-in-flow.bbbb2222.json';

test('project ai-steps endpoint aggregates the reporter AI-step usage manifest', async ({ request }) => {
  const res = await request.post('/api/test-runs/submit', {
    data: {
      projectName: PROJECT.AI_STEPS,
      status: 'passed',
      startTime: RUN_START,
      duration: 2000,
      totalTests: 2,
      passedTests: 2,
      failedTests: 0,
      skippedTests: 0,
      testCases: [
        {
          title: 'sign in',
          status: 'passed',
          duration: 500,
          location: 'tests/auth/login.spec.ts:1:1',
          // Two artifacts; the email locator is shared with the test below.
          aiUsage: { entries: [FLOW, SHARED] },
        },
        {
          title: 'reset password',
          status: 'passed',
          duration: 400,
          location: 'tests/auth/reset.spec.ts:1:1',
          aiUsage: { entries: [SHARED] },
        },
      ],
    },
  });
  expect(res.ok()).toBeTruthy();
  const { projectId } = (await res.json()) as { projectId: number };
  expect(projectId).toBeGreaterThan(0);

  const covRes = await request.get(`/api/projects/${projectId}/ai-steps`);
  expect(covRes.ok()).toBeTruthy();
  const cov = (await covRes.json()) as {
    summary: { artifactCount: number; testCount: number; runCount: number; replayCount: number };
    artifacts: Array<{ entry: string; testCount: number; replayCount: number; lastSeen: string | null }>;
  };

  expect(cov.summary.artifactCount).toBe(2);
  expect(cov.summary.testCount).toBe(2);
  expect(cov.summary.replayCount).toBe(3);

  const shared = cov.artifacts.find((a) => a.entry === SHARED);
  const flow = cov.artifacts.find((a) => a.entry === FLOW);
  expect(shared, 'shared artifact present').toBeTruthy();
  expect(shared!.testCount, 'email locator is exercised by both tests').toBe(2);
  expect(flow!.testCount).toBe(1);
  expect(typeof shared!.lastSeen).toBe('string');
});

test('ai-steps endpoint 404s for an unknown project', async ({ request }) => {
  expect((await request.get('/api/projects/9999999/ai-steps')).status()).toBe(404);
});
