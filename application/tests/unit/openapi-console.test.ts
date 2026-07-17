import { describe, test, expect } from 'vitest';
import {
  substitutePath,
  buildQuery,
  schemaExample,
  requestBodyExample,
  hasJsonBody,
  buildCurl,
  buildFetchSnippet,
} from '../../app/utils/openapi-console';
import type { OpenApiOperation } from '../../app/utils/openapi';

describe('substitutePath', () => {
  test('substitutes and URL-encodes path params', () => {
    expect(substitutePath('/api/projects/{id}', { id: '42' })).toBe('/api/projects/42');
    expect(substitutePath('/api/projects/{id}', { id: 'a/b' })).toBe('/api/projects/a%2Fb');
  });

  test('leaves an unfilled placeholder in place', () => {
    expect(substitutePath('/api/projects/{id}', {})).toBe('/api/projects/{id}');
  });
});

describe('buildQuery', () => {
  test('builds a query string from non-empty values', () => {
    expect(buildQuery({ a: '1', b: '2' })).toBe('?a=1&b=2');
  });

  test('skips empty and undefined values, and encodes', () => {
    expect(buildQuery({ a: '', b: undefined, c: 'x y' })).toBe('?c=x+y');
    expect(buildQuery({})).toBe('');
  });
});

describe('schemaExample', () => {
  test('builds a nested object example honoring enums and formats', () => {
    const example = schemaExample(
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'integer' },
          active: { type: 'boolean' },
          role: { type: 'string', enum: ['admin', 'user'] },
          when: { type: 'string', format: 'date-time' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      null,
    );
    expect(example).toEqual({
      name: 'string',
      count: 0,
      active: false,
      role: 'admin',
      when: '2024-01-01T00:00:00Z',
      tags: ['string'],
    });
  });

  test('prefers an explicit example or default', () => {
    expect(schemaExample({ type: 'string', example: 'hi' }, null)).toBe('hi');
    expect(schemaExample({ type: 'integer', default: 7 }, null)).toBe(7);
  });
});

describe('requestBodyExample / hasJsonBody', () => {
  const op: OpenApiOperation = {
    requestBody: {
      content: {
        'application/json': {
          schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
      },
    },
  };

  test('detects a JSON body and renders a pretty example', () => {
    expect(hasJsonBody(op)).toBe(true);
    expect(requestBodyExample(op, null)).toBe('{\n  "name": "string"\n}');
  });

  test('returns null / false when there is no JSON body', () => {
    const multipart: OpenApiOperation = { requestBody: { content: { 'multipart/form-data': {} } } };
    expect(hasJsonBody(multipart)).toBe(false);
    expect(requestBodyExample(multipart, null)).toBeNull();
    expect(requestBodyExample({}, null)).toBeNull();
  });
});

describe('buildCurl', () => {
  test('builds a single-line GET with no method flag', () => {
    expect(buildCurl({ method: 'get', url: 'http://x/api/health', headers: {} })).toBe(`curl 'http://x/api/health'`);
  });

  test('includes method, headers, and body', () => {
    const curl = buildCurl({
      method: 'post',
      url: 'http://x/api/projects',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer pd_1' },
      body: '{"name":"a"}',
    });
    expect(curl).toBe(
      `curl -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer pd_1' -d '{"name":"a"}' 'http://x/api/projects'`,
    );
    expect(curl).not.toContain('\n');
  });

  test('escapes single quotes in values', () => {
    expect(buildCurl({ method: 'post', url: 'http://x', headers: {}, body: `a'b` })).toContain(`'a'\\''b'`);
  });
});

describe('buildFetchSnippet', () => {
  test('emits a fetch call with method, headers, and body', () => {
    const snippet = buildFetchSnippet({
      method: 'post',
      url: 'http://x/api/projects',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"a"}',
    });
    expect(snippet).toContain('await fetch("http://x/api/projects"');
    expect(snippet).toContain('method: "POST"');
    expect(snippet).toContain('"Content-Type":"application/json"');
    expect(snippet).toContain('const data = await res.json();');
  });
});
