import { describe, test, expect } from 'vitest';
import {
  EMBEDDING_INPUT_VERSION,
  buildEmbedText,
  cosineSimilarity,
  embeddingModelTag,
  parseEmbedding,
} from '../../server/utils/cluster-similarity';

describe('cluster-similarity', () => {
  test('identical vectors have cosine 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  test('orthogonal vectors have cosine 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  test('opposite vectors have cosine -1', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 6);
  });

  test('similar vectors score high, dissimilar low', () => {
    const a = [0.9, 0.1, 0.05];
    const near = [0.88, 0.12, 0.06];
    const far = [0.1, 0.9, 0.8];
    expect(cosineSimilarity(a, near)).toBeGreaterThan(0.99);
    expect(cosineSimilarity(a, far)).toBeLessThan(0.5);
  });

  test('mismatched lengths and zero vectors return 0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  test('parseEmbedding round-trips a JSON number array', () => {
    expect(parseEmbedding(JSON.stringify([1, 2.5, -3]))).toEqual([1, 2.5, -3]);
  });

  test('parseEmbedding rejects null, non-arrays, and non-numeric arrays', () => {
    expect(parseEmbedding(null)).toBeNull();
    expect(parseEmbedding('not json')).toBeNull();
    expect(parseEmbedding('{"a":1}')).toBeNull();
    expect(parseEmbedding('["a","b"]')).toBeNull();
  });

  test('embeddingModelTag combines model id and input-recipe version', () => {
    expect(embeddingModelTag('text-embedding-3-small')).toBe(`text-embedding-3-small#v${EMBEDDING_INPUT_VERSION}`);
  });
});

describe('buildEmbedText', () => {
  test('leads with error type, signature and selector, then the cleaned sample', () => {
    const text = buildEmbedText({
      errorType: 'timeout',
      signature: 'Timeout <N>ms exceeded',
      selector: "getByTestId('save')",
      sampleError: '\u001b[31mTimeout 30000ms exceeded\u001b[39m waiting for https://app.example.com/save',
    });
    expect(text.startsWith('timeout\nTimeout <N>ms exceeded')).toBe(true);
    expect(text).toContain("getByTestId('save')");
    expect(text).not.toContain('\u001b');
    expect(text).not.toContain('30000');
    expect(text).not.toContain('https://app.example.com');
    expect(text).toContain('<URL>');
  });

  test('collapses internal stack frames and caps the output length', () => {
    const frames = Array.from({ length: 200 }, (_, i) => `    at fn (node_modules/pw/lib/f${i}.js:1:1)`).join('\n');
    const text = buildEmbedText({
      errorType: 'assertion',
      signature: 'boom',
      selector: null,
      sampleError: `boom\n${frames}`,
    });
    expect(text).toContain('internal frame');
    expect(text.length).toBeLessThanOrEqual(2000);
  });

  test('a cluster without a sample error still embeds its signature', () => {
    expect(buildEmbedText({ errorType: null, signature: 'sig only', selector: null, sampleError: null })).toBe(
      'sig only',
    );
  });
});
