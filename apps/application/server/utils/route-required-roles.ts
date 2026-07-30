import type { H3Event } from 'h3';
import { getRequestURL } from 'h3';
import type { RouterContext } from 'rou3';
import type { Role } from '#shared/types';
import { buildRoleRouter, matchRequiredRoles } from './route-roles-match';
// Nitro compiles each route's extracted meta into this internal virtual module;
// its types are declared ambiently in shared/nitro-virtual.d.ts.
import { handlersMeta } from '#nitro-internal-virtual/server-handlers-meta';

// Built once from the compiled route metas; the set of routes is fixed per build.
let router: RouterContext<Role[]> | undefined;

/**
 * The roles allowed to call the current route, from its `x-required-roles`
 * OpenAPI meta — the single source of truth, also surfaced in the `/docs`
 * reference. Returns null when the route declares no role restriction (public
 * or token-authenticated), leaving `requireAuth` to enforce sign-in only.
 */
export function getRouteRequiredRoles(event: H3Event): Role[] | null {
  router ??= buildRoleRouter(handlersMeta);
  return matchRequiredRoles(router, event.method, getRequestURL(event).pathname);
}
