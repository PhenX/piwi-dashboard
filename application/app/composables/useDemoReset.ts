import { ref } from 'vue';

/**
 * Shared "reset the demo database" action, used by the demo banner button and
 * the settings page. Wipes the in-browser SQLite DB and reloads: the next load
 * re-seeds from scratch, and because the seed rebases every timestamp to the
 * current moment, the fresh data is always dated relative to now.
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
