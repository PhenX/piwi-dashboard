import { describe, it, expect } from 'vitest';
import { buildPromptPreview } from '../../shared/ai-prompt-preview';

describe('buildPromptPreview', () => {
  const preview = buildPromptPreview({
    system: 'You are a senior test engineer.',
    user: '## Error\nTimeoutError',
    imageCount: 2,
    jsonSchema: { type: 'object', properties: { summary: { type: 'string' } } },
    model: 'claude-sonnet-5',
  });

  it('labels each part of the request', () => {
    for (const heading of ['REQUEST', 'SYSTEM', 'USER', 'IMAGES', 'RESPONSE FORMAT (JSON SCHEMA)']) {
      expect(preview).toContain(heading);
    }
  });

  it('carries the system prompt and the user message verbatim', () => {
    expect(preview).toContain('You are a senior test engineer.');
    expect(preview).toContain('TimeoutError');
  });

  it('reports images rather than pretending they are in the text', () => {
    expect(preview).toContain('2 screenshots attached');
    expect(buildPromptPreview({ system: 's', user: 'u', imageCount: 1 })).toContain('1 screenshot attached');
  });

  it('serializes the response schema', () => {
    expect(preview).toContain('"summary"');
  });

  it('names the model when known', () => {
    expect(preview).toContain('claude-sonnet-5');
  });

  // The preview is built before a diagnosis runs, so it cannot contain what the
  // run itself adds. Saying so is the difference between a useful audit and a
  // misleading one.
  it('states what it cannot include', () => {
    expect(preview).toContain('Not included');
    expect(preview).toContain('research block');
  });

  it('omits the image and schema sections when there are none', () => {
    const bare = buildPromptPreview({ system: 's', user: 'u' });
    expect(bare).not.toContain('IMAGES');
    expect(bare).not.toContain('RESPONSE FORMAT');
  });

  it('marks an empty system prompt rather than rendering a blank block', () => {
    expect(buildPromptPreview({ system: '', user: 'u' })).toContain('(none)');
  });
});
