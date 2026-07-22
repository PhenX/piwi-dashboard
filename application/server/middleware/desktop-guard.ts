// Local-access guard for the desktop (Tauri) build.
//
// Inert unless the desktop shell sets PIWI_DESKTOP_TOKEN, so it has zero effect
// on the server / Docker / npx deployments. When active, every /api and /mcp
// request must carry the per-launch token — either the `piwi_token` cookie the
// shell obtains via /__piwi/session (which rides along on SSR-internal fetches
// and EventSource streams, exactly like the auth session cookie) or an
// `x-piwi-token` header. Combined with the loopback-only bind, this keeps the
// bundled server reachable only by the desktop app itself, not by other local
// processes or web pages open in the user's browser.
export default defineEventHandler((event) => {
  const token = process.env.PIWI_DESKTOP_TOKEN;
  if (!token) return; // not the desktop build — no-op

  const path = event.path || '';
  if (!path.startsWith('/api/') && !path.startsWith('/mcp')) return;

  const presented = getCookie(event, 'piwi_token') || getRequestHeader(event, 'x-piwi-token');
  if (presented === token) return;

  throw createError({ statusCode: 401, statusMessage: 'Desktop access token required' });
});
