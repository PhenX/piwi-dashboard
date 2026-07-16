import { describe, test, expect } from 'vitest';
import {
  methodBadgeColor,
  operationAnchor,
  groupOperationsByTag,
  operationRequiresAuth,
  operationIsPublic,
  resolveSchema,
  schemaTypeLabel,
  type OpenApiSpec,
} from '../../app/utils/openapi';

describe('methodBadgeColor', () => {
  test('maps common methods to distinct colors', () => {
    expect(methodBadgeColor('get')).toBe('success');
    expect(methodBadgeColor('GET')).toBe('success');
    expect(methodBadgeColor('post')).toBe('info');
    expect(methodBadgeColor('put')).toBe('warning');
    expect(methodBadgeColor('patch')).toBe('warning');
    expect(methodBadgeColor('delete')).toBe('error');
    expect(methodBadgeColor('head')).toBe('neutral');
  });
});

describe('operationAnchor', () => {
  test('produces a slug from method + path', () => {
    expect(operationAnchor('get', '/api/projects/{id}')).toBe('op-get-api-projects-id');
  });

  test('collapses non-alphanumerics and trims dashes', () => {
    expect(operationAnchor('POST', '/api/test-runs/upload')).toBe('op-post-api-test-runs-upload');
  });
});

describe('groupOperationsByTag', () => {
  const spec: OpenApiSpec = {
    paths: {
      '/api/projects': {
        get: { tags: ['Projects'], summary: 'List projects' },
        post: { tags: ['Projects'], summary: 'Create project' },
      },
      '/api/health': {
        get: { tags: ['System'], summary: 'Health' },
      },
      '/api/orphan': {
        get: { summary: 'No tag' },
      },
    },
  };

  test('groups operations by their first tag, sorted by tag name', () => {
    const groups = groupOperationsByTag(spec);
    expect(groups.map((g) => g.tag)).toEqual(['Other', 'Projects', 'System']);
    const projects = groups.find((g) => g.tag === 'Projects');
    expect(projects?.operations.map((o) => o.method)).toEqual(['get', 'post']);
  });

  test('falls back to "Other" when an operation has no tag', () => {
    const groups = groupOperationsByTag(spec);
    expect(groups.find((g) => g.tag === 'Other')?.operations[0]?.path).toBe('/api/orphan');
  });

  test('merges path-level and operation-level parameters', () => {
    const withParams: OpenApiSpec = {
      paths: {
        '/api/x/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true }],
          get: { parameters: [{ name: 'q', in: 'query' }] },
        },
      },
    };
    const op = groupOperationsByTag(withParams)[0]?.operations[0];
    expect(op?.parameters.map((p) => p.name)).toEqual(['id', 'q']);
  });

  test('returns an empty array for a spec without paths', () => {
    expect(groupOperationsByTag(null)).toEqual([]);
    expect(groupOperationsByTag({})).toEqual([]);
  });
});

describe('operationRequiresAuth / operationIsPublic', () => {
  test('an empty security array marks an operation explicitly public', () => {
    const op = { security: [] };
    expect(operationIsPublic(op)).toBe(true);
    expect(operationRequiresAuth(op, {})).toBe(false);
  });

  test('a non-empty security array requires auth', () => {
    const op = { security: [{ bearerAuth: [] }] };
    expect(operationIsPublic(op)).toBe(false);
    expect(operationRequiresAuth(op, {})).toBe(true);
  });

  test('an absent security field inherits the spec-level default', () => {
    const op = { summary: 'x' };
    expect(operationRequiresAuth(op, { security: [{ bearerAuth: [] }] })).toBe(true);
    expect(operationRequiresAuth(op, { security: [] })).toBe(false);
    expect(operationRequiresAuth(op, {})).toBe(false);
  });
});

describe('resolveSchema', () => {
  const spec: OpenApiSpec = {
    components: { schemas: { Project: { type: 'object', properties: { id: { type: 'string' } } } } },
  };

  test('resolves a local component reference', () => {
    const resolved = resolveSchema({ $ref: '#/components/schemas/Project' }, spec);
    expect(resolved?.type).toBe('object');
    expect(resolved?.properties?.id?.type).toBe('string');
  });

  test('returns the schema unchanged when there is no ref', () => {
    const schema = { type: 'string' as const };
    expect(resolveSchema(schema, spec)).toBe(schema);
  });

  test('returns the ref schema untouched when the target is missing', () => {
    const schema = { $ref: '#/components/schemas/Missing' };
    expect(resolveSchema(schema, spec)).toBe(schema);
  });
});

describe('schemaTypeLabel', () => {
  test('renders scalar, array, and object types', () => {
    expect(schemaTypeLabel({ type: 'string' })).toBe('string');
    expect(schemaTypeLabel({ type: 'array', items: { type: 'number' } })).toBe('array<number>');
    expect(schemaTypeLabel({ properties: { a: { type: 'string' } } })).toBe('object');
    expect(schemaTypeLabel({ type: ['string', 'null'] })).toBe('string | null');
    expect(schemaTypeLabel(undefined)).toBe('any');
  });
});
