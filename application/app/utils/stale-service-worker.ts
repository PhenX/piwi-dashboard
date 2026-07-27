/**
 * A non-demo build briefly shipped a Workbox precache worker at the root
 * (`/sw.js`) — a `disable` vs `disabled` typo in `nuxt.config.ts`. The build was
 * fixed, but nothing ever unregisters a worker already installed, and the Tauri
 * desktop webview persists the registration across app updates with no successor
 * worker for `autoUpdate` to replace it with — so the desktop app stays pinned to
 * stale, cached client code and mutations (e.g. saving a locator pick) silently
 * do nothing. `evictStaleRootServiceWorker` (the .client plugin) removes it.
 *
 * This predicate decides whether a registration is that stray worker. It must
 * NEVER match the self-hosted Playwright trace-viewer worker
 * (`/trace-viewer/sw.bundle.js`), which is required for the embedded viewer.
 * Pure and unit-tested.
 */
export function isStrayRootWorker(scriptUrl: string, scope: string): boolean {
  let scriptPath: string;
  let scopePath: string;
  try {
    scriptPath = new URL(scriptUrl, 'http://x').pathname;
    scopePath = new URL(scope, 'http://x').pathname;
  } catch {
    return false;
  }
  // Anything scoped to the trace viewer is off-limits, whatever it's named.
  if (scopePath.includes('/trace-viewer/')) return false;
  // The Workbox default filename is `sw.js`; the trace viewer's is `sw.bundle.js`.
  return /\/sw\.js$/.test(scriptPath);
}
