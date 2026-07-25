import { describe, it, expect } from 'vitest';
import { collectTestMetadata, collectTestTags } from '../src/internal/collect/test-meta.js';

describe('collectTestTags', () => {
  it('reads the tags Playwright folded together from the title and the test option', () => {
    expect(collectTestTags({ tags: ['@smoke', '@critical'] })).toEqual(['smoke', 'critical']);
  });

  it('returns an empty array when the test declared none', () => {
    expect(collectTestTags({ tags: [] })).toEqual([]);
  });

  // A `TestCase` reaching the reporter from an older Playwright, or from a
  // hand-rolled harness, has no `tags` at all — that must not throw.
  it('tolerates a TestCase without a tags property', () => {
    expect(collectTestTags({})).toEqual([]);
    expect(collectTestTags({ tags: undefined })).toEqual([]);
  });
});

describe('collectTestMetadata', () => {
  it('parses piwi: annotations into ownership metadata', () => {
    expect(
      collectTestMetadata([
        { type: 'piwi:owner', description: '@checkout-team' },
        { type: 'piwi:priority', description: 'critical' },
      ]),
    ).toEqual({ owner: '@checkout-team', priority: 'critical' });
  });

  it('returns null when only Playwright marks are present', () => {
    expect(collectTestMetadata([{ type: 'skip', description: 'broken' }])).toBeNull();
  });

  it('returns null for an empty annotation list', () => {
    expect(collectTestMetadata([])).toBeNull();
  });
});
