import { describe, test, expect } from 'vitest';
import { renderEventSubject, type RunFinishedPayload, type ClusterNewPayload } from '#shared/notification-events';

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
});
