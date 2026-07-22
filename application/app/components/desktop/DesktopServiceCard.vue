<script setup lang="ts">
/**
 * Desktop build only: drive the native "Run in background" and "Start on login"
 * options from the app UI.
 *
 * These are OS/tray-level controls, so the card talks to the Tauri shell over
 * the IPC bridge (window.__TAURI__, injected into the desktop webview). When the
 * bridge is absent — the same URL opened in a normal browser, or an older shell
 * that predates it — it degrades to tray instructions rather than showing dead
 * switches.
 */
interface TauriCore {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function tauriCore(): TauriCore | null {
  const g = globalThis as unknown as { __TAURI__?: { core?: TauriCore } };
  return g.__TAURI__?.core ?? null;
}

const toast = useToast();

const loading = ref(true);
const available = ref(false);
const busy = ref(false);
const runInBackground = ref(false);
const startOnLogin = ref(false);

async function refresh() {
  const core = tauriCore();
  if (!core) {
    available.value = false;
    loading.value = false;
    return;
  }
  try {
    const s = await core.invoke<{ run_in_background: boolean; start_on_login: boolean }>(
      'desktop_get_service_settings',
    );
    runInBackground.value = !!s.run_in_background;
    startOnLogin.value = !!s.start_on_login;
    available.value = true;
  } catch {
    available.value = false;
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

async function setRunInBackground(value: boolean) {
  const core = tauriCore();
  if (!core) return;
  busy.value = true;
  try {
    await core.invoke('desktop_set_run_in_background', { enabled: value });
    runInBackground.value = value;
  } catch {
    toast.add({ title: 'Could not update "Run in background"', color: 'error' });
  } finally {
    busy.value = false;
  }
}

async function setStartOnLogin(value: boolean) {
  const core = tauriCore();
  if (!core) return;
  busy.value = true;
  try {
    await core.invoke('desktop_set_start_on_login', { enabled: value });
    startOnLogin.value = value;
  } catch {
    toast.add({ title: 'Could not update "Start on login"', color: 'error' });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <SectionCard icon="i-lucide-monitor-cog" title="Desktop app">
    <template #subtitle> Keep Piwi running in the background and start it automatically when you log in. </template>

    <div v-if="loading" class="flex items-center gap-2 text-sm text-muted">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" /> Checking…
    </div>

    <div v-else-if="available" class="space-y-4">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-0.5">
          <p class="text-sm font-medium">Run in background</p>
          <p class="text-xs text-muted">Closing the window keeps the server running in the tray instead of quitting.</p>
        </div>
        <USwitch :model-value="runInBackground" :disabled="busy" @update:model-value="setRunInBackground" />
      </div>
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-0.5">
          <p class="text-sm font-medium">Start on login</p>
          <p class="text-xs text-muted">
            Launch Piwi automatically (hidden in the tray) when you sign in to your computer.
          </p>
        </div>
        <USwitch :model-value="startOnLogin" :disabled="busy" @update:model-value="setStartOnLogin" />
      </div>
    </div>

    <div v-else class="space-y-1 text-sm text-muted">
      <p>Manage these from the Piwi tray icon:</p>
      <p class="text-xs">
        Right-click the Piwi icon in your system tray for <strong>Run in background</strong> and
        <strong>Start on login</strong>. On Windows the icon may be hidden under the “show hidden icons” arrow (▲) next
        to the clock — drag it onto the taskbar to keep it in view.
      </p>
    </div>
  </SectionCard>
</template>
