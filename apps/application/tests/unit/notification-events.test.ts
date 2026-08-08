import { describe, test, expect } from 'vitest';
import {
  renderEventSubject,
  buildTopFailures,
  truncateExcerpt,
  TOP_FAILURES_LIMIT,
  ERROR_EXCERPT_MAX,
  type RunFinishedPayload,
  type ClusterNewPayload,
} from '#shared/notification-events';

const runPayload: RunFinishedPayload = {
  runId: 1,
  projectId: 2,
  projectName: 'my-project',
  status: 'failed',
  totalTests: 10,
  failedTests: 2,
  passedTests: 8,
  flakyTests: 0,
};

const clusterPayload: ClusterNewPayload = {
  clusterId: 5,
  projectId: 2,
  projectName: 'my-project',
  signature: 'TimeoutError: locator not visible',
  runId: 1,
};

describe('renderEventSubject', () => {
  test('run.finished / run.failed / run.failed.default_branch include the run status and project', () => {
    expect(renderEventSubject('run.finished', runPayload)).toBe('Test run failed — my-project');
    expect(renderEventSubject('run.failed', runPayload)).toBe('Test run failed — my-project');
    expect(renderEventSubject('run.failed.default_branch', runPayload)).toBe('Test run failed — my-project');
  });

  test('appends the branch name in parentheses when present', () => {
    expect(renderEventSubject('run.finished', { ...runPayload, branch: 'main' })).toBe(
      'Test run failed — my-project (main)',
    );
  });

  test('cluster.new names the project, not the signature', () => {
    expect(renderEventSubject('cluster.new', clusterPayload)).toBe('New failure cluster — my-project');
  });

  test('flakiness.spike and perf.regression produce distinct subjects', () => {
    expect(renderEventSubject('flakiness.spike', runPayload)).toBe('Flakiness spike — my-project');
    expect(renderEventSubject('perf.regression', runPayload)).toBe('Performance regression — my-project');
  });

  test('auto_heal.pr_opened names the PR number and project', () => {
    expect(
      renderEventSubject('auto_heal.pr_opened', {
        projectId: 2,
        projectName: 'my-project',
        runId: 1,
        prNumber: 42,
        prUrl: 'https://github.com/acme/app/pull/42',
        branch: 'piwi/heal/1-abc',
        editCount: 1,
      }),
    ).toBe('Auto-heal opened PR #42 — my-project');
  });
});

describe('truncateExcerpt', () => {
  test('returns undefined for empty/whitespace input', () => {
    expect(truncateExcerpt(undefined)).toBeUndefined();
    expect(truncateExcerpt(null)).toBeUndefined();
    expect(truncateExcerpt('   \n  ')).toBeUndefined();
  });

  test('strips ANSI colour codes and trims', () => {
    const esc = String.fromCharCode(27);
    expect(truncateExcerpt(`  ${esc}[31mError${esc}[0m: boom  `)).toBe('Error: boom');
  });

  test('caps to ERROR_EXCERPT_MAX with an ellipsis', () => {
    const long = 'x'.repeat(ERROR_EXCERPT_MAX + 50);
    const out = truncateExcerpt(long)!;
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(ERROR_EXCERPT_MAX + 1); // max chars + ellipsis
  });
});

describe('buildTopFailures', () => {
  test('caps to the limit and maps fields, dropping empty ones', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      title: `test ${i}`,
      filePath: i === 0 ? 'tests/a.spec.ts' : null,
      error: i === 0 ? 'boom' : null,
      testCaseId: i,
      executionId: i + 100,
    }));
    const out = buildTopFailures(rows);
    expect(out).toHaveLength(TOP_FAILURES_LIMIT);
    expect(out[0]).toEqual({
      title: 'test 0',
      filePath: 'tests/a.spec.ts',
      errorExcerpt: 'boom',
      testCaseId: 0,
      executionId: 100,
    });
    // Row without filePath/error omits those keys entirely
    expect(out[1]).toEqual({ title: 'test 1', testCaseId: 1, executionId: 101 });
  });

  test('respects a custom limit', () => {
    const rows = [{ title: 'a' }, { title: 'b' }];
    expect(buildTopFailures(rows, 1)).toHaveLength(1);
  });
});
