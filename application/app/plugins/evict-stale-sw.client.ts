import { isStrayRootWorker } from '~/utils/stale-service-worker';

/**
 * Evict the stray root service worker a pre-fix build left in the webview.
 *
 * Non-demo builds briefly registered a Workbox `/sw.js` precache worker that
 * nothing ever unregisters (see `stale-service-worker.ts`). Browsers can be
 * cleared by hand, but the Tauri desktop webview keeps the registration across
 * updates and post-fix builds emit no successor worker for `autoUpdate` to swap
 * in — so the desktop app is pinned to stale cached client code with no recovery
 * path, and mutations like saving a locator pick appear to do nothing.
 *
 * On non-demo startup, unregister ONLY that root `/sw.js` worker (never the
 * Playwright trace-viewer worker), drop its Workbox caches, and reload once so
 * the page loads current code from the network. No-op when nothing is stray.
 */
export default defineNuxtPlugin(() => {
  if (useRuntimeConfig().public.demoMode) return; // the demo relies on its own SW
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  void (async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      let evicted = false;
      for (const reg of regs) {
        const scriptUrl = reg.active?.scriptURL ?? reg.waiting?.scriptURL ?? reg.installing?.scriptURL ?? '';
        if (isStrayRootWorker(scriptUrl, reg.scope)) {
          await reg.unregister();
          evicted = true;
        }
      }
      if (!evicted) return;

      if (globalThis.caches) {
        for (const key of await caches.keys()) {
          if (key.includes('workbox')) await caches.delete(key);
        }
      }
      // Reload once (guarded against a loop) so current, uncached code loads.
      if (!sessionStorage.getItem('piwi-sw-evicted')) {
        sessionStorage.setItem('piwi-sw-evicted', '1');
        location.reload();
      }
    } catch {
      // Best-effort cleanup — never block app startup over it.
    }
  })();
});
