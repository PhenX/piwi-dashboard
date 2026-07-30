/**
 * True when the dashboard is running inside the Tauri desktop shell.
 *
 * The desktop launcher starts the bundled server with `NUXT_PUBLIC_DESKTOP=true`
 * (see `desktop/src-tauri/src/lib.rs`), which Nuxt maps onto
 * `runtimeConfig.public.desktop`. A runtime env override can surface as the
 * string `"true"` or a real boolean depending on how it is parsed, so normalise
 * with `String()` — the same guard the server uses in `isAuthEnabled`.
 *
 * Desktop mode is single-user and local-only (auth is off, the access token is
 * enforced by the desktop guard), so the UI uses this to hide account/user
 * management and to surface the local connection details (data location,
 * reporter token, MCP endpoint).
 */
export function useIsDesktop(): boolean {
  const config = useRuntimeConfig();
  return String(config.public.desktop) === 'true';
}
