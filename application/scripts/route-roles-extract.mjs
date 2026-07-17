// Pure extraction of per-route required roles from the server route files.
//
// Roles are declared once, at runtime, as `const REQUIRED_ROLES: Role[] = [...]`
// in each route handler (the source of truth used by `requireAuth`). Nitro's
// OpenAPI meta extractor can't resolve those enum/variable references into the
// generated spec, so this module reads them statically and maps each route file
// to its OpenAPI `{method} {path}` key. Shared by the generator script and the
// freshness test so they can never disagree.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENUM_TO_STRING = { ADMINISTRATOR: 'administrator', REPORTER: 'reporter', USER: 'user' };
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Map a route file path to its OpenAPI `{method} {path}` key, or null. */
export function fileToOperationKey(relPath) {
  // relPath is relative to the server dir, e.g. "api/projects/[id].get.ts" or
  // "routes/mcp.post.ts". `server/api/**` is served under `/api`; `server/routes/**`
  // under the site root.
  const methodMatch = /\.(get|post|put|patch|delete)\.ts$/.exec(relPath);
  if (!methodMatch) return null;
  const method = methodMatch[1];
  if (!HTTP_METHODS.has(method)) return null;

  const withoutMethod = relPath.slice(0, -`.${method}.ts`.length);
  const parts = withoutMethod.split('/');
  const base = parts.shift(); // 'api' | 'routes'
  const rest = parts
    .filter((s) => s !== 'index')
    .map(
      (seg) =>
        seg
          .replace(/\[\.\.\.(\w+)\]/g, '{$1}') // [...path] → {path}
          .replace(/\[(\w+)\]/g, '{$1}'), // [id] → {id}
    );
  const prefix = base === 'api' ? ['api'] : [];
  const path = '/' + [...prefix, ...rest].join('/');
  return `${method} ${path}`;
}

/** Extract the documented roles for a route file's source, or null if none. */
export function extractRoles(source) {
  const match = /const REQUIRED_ROLES: Role\[\] = \[([^\]]*)\]/.exec(source);
  if (!match) return null;
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => {
      const m = /Role\.([A-Z_]+)/.exec(tok);
      if (!m || !ENUM_TO_STRING[m[1]]) throw new Error(`Unmapped role token: ${tok}`);
      return ENUM_TO_STRING[m[1]];
    });
}

/** Build the `{method} {path}` → roles[] map from the server route files. */
export function buildRouteRoles(serverDir) {
  const map = {};
  for (const base of ['api', 'routes']) {
    const dir = join(serverDir, base);
    let files;
    try {
      files = walk(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = file.slice(serverDir.length + 1);
      const key = fileToOperationKey(rel);
      if (!key) continue;
      const roles = extractRoles(readFileSync(file, 'utf8'));
      if (roles && roles.length) map[key] = roles;
    }
  }
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}
