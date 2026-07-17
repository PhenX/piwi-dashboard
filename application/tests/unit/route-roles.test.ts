import { describe, test, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
// The extractor is plain ESM shared with the generator script.
import { buildRouteRoles, fileToOperationKey, extractRoles } from '../../scripts/route-roles-extract.mjs';
import { ROUTE_ROLES } from '../../app/utils/route-roles.generated';

const serverDir = resolve(fileURLToPath(new URL('../../server', import.meta.url)));

describe('fileToOperationKey', () => {
  test('maps api routes, dynamic + catch-all segments, and index', () => {
    expect(fileToOperationKey('api/projects/index.get.ts')).toBe('get /api/projects');
    expect(fileToOperationKey('api/projects/[id].delete.ts')).toBe('delete /api/projects/{id}');
    expect(fileToOperationKey('api/test-runs/[id]/cases/[caseId]/dom-snapshot.get.ts')).toBe(
      'get /api/test-runs/{id}/cases/{caseId}/dom-snapshot',
    );
    expect(fileToOperationKey('api/files/[...path].get.ts')).toBe('get /api/files/{path}');
  });

  test('routes/** map to the site root, not under /api', () => {
    expect(fileToOperationKey('routes/mcp.post.ts')).toBe('post /mcp');
  });

  test('ignores non-method files', () => {
    expect(fileToOperationKey('api/projects/helpers.ts')).toBeNull();
  });
});

describe('extractRoles', () => {
  test('maps the Role enum members to lowercase strings', () => {
    expect(extractRoles('const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];')).toEqual([
      'administrator',
      'reporter',
    ]);
    expect(extractRoles('const REQUIRED_ROLES: Role[] = [];')).toEqual([]);
    expect(extractRoles('no roles here')).toBeNull();
  });
});

describe('route-roles.generated.ts', () => {
  test('is in sync with the server route sources (run `npm run app:gen:route-roles`)', () => {
    expect(ROUTE_ROLES).toEqual(buildRouteRoles(serverDir));
  });

  test('every mapped role is a known role', () => {
    const known = new Set(['administrator', 'reporter', 'user']);
    for (const roles of Object.values(ROUTE_ROLES)) {
      for (const role of roles) expect(known.has(role)).toBe(true);
    }
  });
});
