import { describe, test, expect } from 'vitest';
import {
  buildExtractionPrompt,
  parseExtractedJsonLoose,
  validateExtractedFunction,
  EXTRACT_JSON_SCHEMA,
} from '../../shared/test-function-extract-prompt';

const validResponse = {
  name: 'addToCart',
  kind: 'helper',
  params: [],
  steps: [{ action: 'click', target: { role: 'button', name: 'Add to cart' } }],
};

describe('buildExtractionPrompt', () => {
  test('embeds the trimmed code between fences and the JSON schema', () => {
    const prompt = buildExtractionPrompt('  async login() { /* ... */ }  \n');
    expect(prompt).toContain('async login() { /* ... */ }');
    expect(prompt).not.toContain('  async login');
    expect(prompt).toContain(JSON.stringify(EXTRACT_JSON_SCHEMA, null, 2));
    expect(prompt).toContain('Respond with ONLY a JSON object');
  });

  test('carries the extraction rules verbatim (kind/steps/paramSources guidance)', () => {
    const prompt = buildExtractionPrompt('x');
    expect(prompt).toContain('"kind" is "page-object-method"');
    expect(prompt).toContain('Never invent a step');
  });
});

describe('parseExtractedJsonLoose', () => {
  test('parses plain JSON', () => {
    expect(parseExtractedJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  test('strips a markdown code fence', () => {
    expect(parseExtractedJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('slices from first { to last } when there is surrounding prose', () => {
    expect(parseExtractedJsonLoose('Sure, here you go:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });

  test('throws when no JSON object can be found at all', () => {
    expect(() => parseExtractedJsonLoose('not json at all, sorry')).toThrow();
  });
});

describe('validateExtractedFunction', () => {
  test('applies the same defaults as the AI-calling path', () => {
    const proposal = validateExtractedFunction(JSON.stringify(validResponse));
    expect(proposal.receiver).toBeNull();
    expect(proposal.importName).toBeNull();
    expect(proposal.returnsPage).toBe(false);
    expect(proposal.paramSources).toEqual([]);
    expect(proposal.confidence).toBe(0.7);
  });

  test('preserves an explicit confidence', () => {
    const proposal = validateExtractedFunction(JSON.stringify({ ...validResponse, confidence: 0.42 }));
    expect(proposal.confidence).toBe(0.42);
  });

  test('rejects unparseable text with a friendly message', () => {
    expect(() => validateExtractedFunction('garbage, not json')).toThrow("wasn't valid JSON");
  });

  test('rejects a response with no steps (schema requires at least one)', () => {
    expect(() => validateExtractedFunction(JSON.stringify({ ...validResponse, steps: [] }))).toThrow(
      "couldn't produce a valid pattern",
    );
  });

  test('rejects an invalid step action', () => {
    const bad = { ...validResponse, steps: [{ action: 'hover', target: { role: 'button' } }] };
    expect(() => validateExtractedFunction(JSON.stringify(bad))).toThrow("couldn't produce a valid pattern");
  });

  test('notes default to null when the model omits them', () => {
    expect(validateExtractedFunction(JSON.stringify(validResponse)).notes).toBeNull();
  });

  test('notes are preserved when the model explains what it could not represent', () => {
    const withNotes = { ...validResponse, notes: 'focusVSelect() is a helper I cannot see inside.' };
    expect(validateExtractedFunction(JSON.stringify(withNotes)).notes).toContain('focusVSelect');
  });
});

/**
 * The options-bag shape most real Playwright helpers take. Before object
 * params existed these validated only by being mistyped as `string`, which
 * produced a non-compiling generated call.
 */
describe('validateExtractedFunction — object params', () => {
  const objectResponse = {
    name: 'selectOption',
    kind: 'helper',
    params: [
      { name: 'source', type: 'object', fields: ['label', 'testId'] },
      { name: 'option', type: 'object', fields: ['value'] },
    ],
    steps: [
      { action: 'click', target: { role: 'combobox' } },
      { action: 'click', target: { role: 'option' } },
    ],
    paramSources: [
      { param: 'source', path: 'label', stepIndex: 0, from: 'text' },
      { param: 'option', path: 'value', stepIndex: 1, from: 'text' },
    ],
    confidence: 0.5,
  };

  test('accepts object params with fields and field-targeted param sources', () => {
    const proposal = validateExtractedFunction(JSON.stringify(objectResponse));
    expect(proposal.params[0]).toMatchObject({ name: 'source', type: 'object', fields: ['label', 'testId'] });
    expect(proposal.paramSources[0]).toMatchObject({ param: 'source', path: 'label' });
  });

  test('a scalar param still validates with no path', () => {
    const scalar = {
      ...objectResponse,
      params: [{ name: 'sku', type: 'string' }],
      paramSources: [{ param: 'sku', stepIndex: 0, from: 'testId' }],
    };
    const proposal = validateExtractedFunction(JSON.stringify(scalar));
    expect(proposal.params[0]).toMatchObject({ name: 'sku', type: 'string' });
    expect(proposal.paramSources[0]!.path).toBeUndefined();
  });

  test('rejects a param type outside the allowed set', () => {
    const bad = { ...objectResponse, params: [{ name: 'source', type: 'array' }] };
    expect(() => validateExtractedFunction(JSON.stringify(bad))).toThrow("couldn't produce a valid pattern");
  });
});
