/**
 * The Piwi instances this desktop shell can point at, and which one is active
 * (desktop shell only).
 *
 * By default the app runs a private, single-user server on this computer ("local
 * mode"). Connect mode instead points the window at a shared team instance's own
 * origin, so the native app shows the team's runs, clusters and diagnoses rather
 * than a second empty database. The saved list and the active choice live in the
 * shell's own settings store — which instance a laptop talks to is a fact about
 * the laptop, never synced to any server.
 *
 * Every accessor feature-detects the native IPC bridge and no-ops in a plain
 * browser, so a page may mount the card unconditionally. The bridge is present in
 * both modes (the shell injects it whether the webview is on the loopback server
 * or a remote origin), which is what lets the user switch back from a remote
 * instance.
 */

export interface DesktopConnection {
  id: string;
  label: string;
  /** `scheme://host[:port]` for a remote instance; empty for the local one. */
  origin: string;
  kind: 'local' | 'remote';
  active: boolean;
}

export function useDesktopConnections() {
  const toast = useToast();

  /** The IPC bridge exists — resolved on mount so SSR renders nothing. */
  const available = ref(false);
  const loading = ref(true);
  const busy = ref(false);
  const connections = ref<DesktopConnection[]>([]);

  const active = computed(() => connections.value.find((c) => c.active) ?? null);

  async function refresh() {
    const core = tauriCore();
    if (!core) {
      available.value = false;
      return;
    }
    available.value = true;
    try {
      connections.value = await core.invoke<DesktopConnection[]>('desktop_list_connections');
    } catch (error) {
      toast.add({ title: 'Could not load connections', description: errorMessage(error), color: 'error' });
    }
  }

  // Resolve the bridge synchronously on mount so the card appears at once inside
  // the shell and never renders in a plain browser (where SSR emits nothing).
  onMounted(async () => {
    available.value = !!tauriCore();
    if (available.value) await refresh();
    loading.value = false;
  });

  /** Save a remote instance from a typed URL. Does not switch to it. */
  async function add(url: string, label?: string): Promise<boolean> {
    const core = tauriCore();
    if (!core) return false;
    busy.value = true;
    try {
      const trimmedLabel = label?.trim();
      await core.invoke('desktop_add_connection', { url, label: trimmedLabel || null });
      await refresh();
      return true;
    } catch (error) {
      toast.add({ title: 'Could not add the instance', description: errorMessage(error), color: 'error' });
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** Forget a saved instance. */
  async function remove(id: string): Promise<void> {
    const core = tauriCore();
    if (!core) return;
    busy.value = true;
    try {
      await core.invoke('desktop_remove_connection', { id });
      await refresh();
    } catch (error) {
      toast.add({ title: 'Could not remove the instance', description: errorMessage(error), color: 'error' });
    } finally {
      busy.value = false;
    }
  }

  /**
   * Switch the active instance. The shell relaunches onto the chosen one, so in
   * the normal case this call never resolves — the webview is torn down and
   * reloaded on the new target. It only returns (rejecting) when the switch is
   * refused before the relaunch, e.g. the id no longer exists.
   */
  async function connect(id: string): Promise<void> {
    const core = tauriCore();
    if (!core) return;
    busy.value = true;
    try {
      await core.invoke('desktop_set_active_connection', { id });
    } catch (error) {
      busy.value = false;
      toast.add({ title: 'Could not switch instance', description: errorMessage(error), color: 'error' });
    }
  }

  return { available, loading, busy, connections, active, refresh, add, remove, connect };
}
