import { describe, test, expect } from 'vitest';
import { buildDiagnosisVersionValues } from '#shared/handlers/diagnosis-versions';

describe('buildDiagnosisVersionValues', () => {
  const row = {
    id: 42,
    clusterId: 7,
    scope: 'cluster',
    testRunsCaseId: null,
    status: 'completed',
    provider: 'demo',
    model: 'demo-simulated',
    category: 'infrastructure',
    confidence: 'high',
    summary: 'summary',
    rootCause: 'root cause',
    details: { confidenceScore: 80 },
    error: null,
    inputTokens: 100,
    outputTokens: 40,
    durationMs: 1234,
    contextSha: 'abc',
  };

  test('maps diagnosis id to diagnosisId and preserves the identifying columns', () => {
    const v = buildDiagnosisVersionValues(row);
    expect(v.diagnosisId).toBe(42);
    expect(v.clusterId).toBe(7);
    expect(v.scope).toBe('cluster');
    expect(v.category).toBe('infrastructure');
    expect(v.details).toEqual({ confidenceScore: 80 });
    expect(v.createdAt).toBeInstanceOf(Date);
  });

  test('defaults optional testRunsCaseId/contextSha to null', () => {
    const { testRunsCaseId, ...rest } = row;
    void testRunsCaseId;
    const v = buildDiagnosisVersionValues({ ...rest, testRunsCaseId: undefined as unknown as null });
    expect(v.testRunsCaseId).toBeNull();
  });

  test('uses the provided createdAt when given', () => {
    const when = new Date('2025-01-01T00:00:00Z');
    expect(buildDiagnosisVersionValues(row, when).createdAt).toBe(when);
  });
});
