/**
 * LLM adjudication for the ambiguous similarity band. When two clusters are
 * close enough to suspect but not auto-merge, a reasoning model decides whether
 * they share a root cause. Used sparingly (budget-capped) by the reconciler.
 *
 * Beyond the error text, the prompt carries usage context when the caller can
 * provide it — which tests each cluster affects and how much the two clusters
 * overlap — because test-set overlap discriminates cases the text alone cannot
 * (same test, reworded message → likely one cause; disjoint test sets with
 * similar boilerplate → likely distinct problems).
 */

import { callAiProvider } from './ai-provider';
import type { ResolvedAiRole } from '~~/types/api';

const ADJUDICATION_SYSTEM_PROMPT = `You are triaging automated software-test failures. Given two failure clusters,
decide whether they share the SAME underlying root cause (and should be merged into one) or are genuinely different
problems. Weigh the usage context as well as the error text: the same tests failing in both clusters suggests one
cause whose message changed; two clusters co-occurring in the same runs across many unrelated tests may be a shared
environment event; different locators or fully disjoint test sets are evidence of distinct problems. Be conservative:
only answer merge=true when the evidence clearly points to one cause. Reply strictly as JSON.`;

const ADJUDICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    merge: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string' },
  },
  required: ['merge', 'confidence', 'reason'],
  additionalProperties: false,
} as const;

export interface ClusterAffectedTest {
  file: string;
  title: string;
  occurrences: number;
}

export interface ClusterForAdjudication {
  signature: string;
  errorType: string | null;
  sampleError: string | null;
  /** Playwright locator extracted from the error, when the cluster has one. */
  selector?: string | null;
  /** Most-affected tests (by linked failure count), a small sample. */
  affectedTests?: ClusterAffectedTest[];
  /** Distinct test cases with failures in this cluster. */
  totalTests?: number;
  /** Distinct runs in which this cluster produced failures. */
  totalRuns?: number;
}

/** How much two clusters' failure populations intersect. */
export interface ClusterPairOverlap {
  /** Distinct test cases that have failures in BOTH clusters. */
  sharedTests: number;
  /** Distinct runs in which BOTH clusters produced failures. */
  sharedRuns: number;
}

export interface AdjudicationResult {
  merge: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function block(label: string, c: ClusterForAdjudication): string {
  const lines = [`${label}:`, `- error type: ${c.errorType ?? 'unknown'}`, `- signature: ${c.signature}`];
  if (c.selector) lines.push(`- locator: ${c.selector}`);
  if (c.totalTests !== undefined && c.totalRuns !== undefined) {
    lines.push(`- affects ${c.totalTests} distinct test(s) across ${c.totalRuns} run(s)`);
  }
  if (c.affectedTests?.length) {
    lines.push('- most-affected tests:');
    for (const t of c.affectedTests) lines.push(`  - ${t.file} › ${t.title} (${t.occurrences}×)`);
  }
  lines.push(`- sample error: ${(c.sampleError ?? '').slice(0, 1500)}`);
  return lines.join('\n');
}

export async function adjudicateClusterPair(
  role: ResolvedAiRole,
  a: ClusterForAdjudication,
  b: ClusterForAdjudication,
  overlap?: ClusterPairOverlap,
): Promise<AdjudicationResult | null> {
  const sections = [block('Cluster A', a), block('Cluster B', b)];
  if (overlap) {
    sections.push(
      [
        'Overlap between the two clusters:',
        `- ${overlap.sharedTests} distinct test(s) have failures in both clusters`,
        `- both clusters produced failures together in ${overlap.sharedRuns} run(s)`,
      ].join('\n'),
    );
  }
  const user = `${sections.join('\n\n')}\n\nDo these two clusters share the same root cause?`;
  const res = await callAiProvider(role, {
    system: ADJUDICATION_SYSTEM_PROMPT,
    user,
    jsonSchema: ADJUDICATION_JSON_SCHEMA as unknown as object,
    maxTokens: 512,
    effort: 'low',
  });
  try {
    const j = JSON.parse(res.text) as Partial<AdjudicationResult>;
    if (typeof j.merge !== 'boolean') return null;
    const confidence =
      j.confidence === 'high' || j.confidence === 'medium' || j.confidence === 'low' ? j.confidence : 'low';
    return { merge: j.merge, confidence, reason: String(j.reason ?? '').slice(0, 500) };
  } catch {
    return null;
  }
}
