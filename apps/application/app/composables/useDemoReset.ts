import { ref } from 'vue';

/**
 * Ask the demo service worker to drop its own in-memory SQLite instance. The
 * window-side `resetDemoDb()` only clears this context + IndexedDB; the service
 * worker (which actually answers the API queries) keeps a separate in-memory
 * copy that would otherwise keep serving the old, possibly obsolete-schema data
 * after the reload. Resolves once the SW acknowledges, or after a short timeout
 * so an unresponsive/absent SW never blocks the reset.
 */
async function resetServiceWorkerDemoDb(): Promise<void> {
  if (!import.meta.client || !('serviceWorker' in navigator)) return;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(resolve, 2000);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve();
    };
    controller.postMessage({ type: 'piwi-demo-reset' }, [channel.port2]);
  });
}

/**
 * Shared "reset the demo database" action, used by the demo banner button, the
 * settings page and the "new demo data" staleness prompt. Wipes the in-browser
 * SQLite DB — both the window copy and the service worker's — and reloads: the
 * next load re-seeds from scratch, and because the seed rebases every timestamp
 * to the current moment, the fresh data is always dated relative to now.
 */
export function useDemoReset() {
  const isResetting = ref(false);
  const toast = useToast();

  async function resetDemo() {
    if (isResetting.value) return;
    isResetting.value = true;
    try {
      const { resetDemoDb } = await import('~/demo/db.client');
      await resetDemoDb();
      await resetServiceWorkerDemoDb();
      toast.add({
        title: 'Demo reset',
        description: 'Reloading with fresh sample data dated to now.',
        icon: 'i-lucide-refresh-cw',
        color: 'success',
      });
      // Brief delay so the success toast is visible before the reload clears the page.
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast.add({
        title: 'Reset failed',
        description: String(e),
        icon: 'i-lucide-x-circle',
        color: 'error',
      });
      isResetting.value = false;
    }
  }

  return { isResetting, resetDemo };
}
