import { createRouter, addRoute, findRoute, type RouterContext } from 'rou3';
import type { Role } from '#shared/types';

/**
 * A route handler's extracted meta, as produced by Nitro's OpenAPI meta
 * extractor. Only the fields this module needs are typed.
 */
export interface RouteMetaEntry {
  route?: string;
  method?: string;
  meta?: { openAPI?: Record<string, unknown> } | null;
}

/**
 * Build a router mapping `(method, route pattern)` → required roles from the
 * route handlers' `x-required-roles` meta. Routes with no (or empty) role
 * restriction are skipped, so a lookup miss means "authenticated, any role".
 *
 * This is the same router library (rou3) Nitro uses to dispatch requests, so a
 * concrete path matches its handler's pattern exactly as it did at routing time.
 */
export function buildRoleRouter(metas: RouteMetaEntry[]): RouterContext<Role[]> {
  const router = createRouter<Role[]>();
  for (const entry of metas) {
    if (!entry.route) continue;
    const roles = entry.meta?.openAPI?.['x-required-roles'];
    if (Array.isArray(roles) && roles.length > 0) {
      addRoute(router, (entry.method || '').toUpperCase() || undefined, entry.route, roles as Role[]);
    }
  }
  return router;
}

/** The required roles for a method + pathname, or null when unrestricted. */
export function matchRequiredRoles(
  router: RouterContext<Role[]>,
  method: string | undefined,
  pathname: string,
): Role[] | null {
  return findRoute(router, (method || '').toUpperCase(), pathname)?.data ?? null;
}
