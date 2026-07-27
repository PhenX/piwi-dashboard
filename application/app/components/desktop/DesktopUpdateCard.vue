<script setup lang="ts">
/**
 * Desktop shell only: check for and install app updates. Renders nothing
 * without the IPC bridge; on builds without update support (dev builds,
 * releases made without the signing key) it explains why instead of showing a
 * dead button. Progress arrives as `piwi:update-progress` events while the
 * shell downloads and installs.
 *
 * Two install shapes, told apart by `exits_on_install` from the shell (never
 * by sniffing the platform here): on macOS the app stays up and the user
 * chooses when to restart, while on Windows the installer needs the app gone
 * and closes it mid-install — so there the card promises a quit, not a
 * restart button that would never render.
 */
const props = defineProps<{ currentVersion?: string | null }>();

interface UpdateStatus {
  state: 'unsupported' | 'uptodate' | 'available';
  version: string | null;
  notes: string | null;
  date: string | null;
  exits_on_install: boolean;
}

const toast = useToast();

const available = ref(false);
const checking = ref(false);
const installing = ref(false);
const installed = ref(false);
const status = ref<UpdateStatus | null>(null);
const progress = ref<{ downloaded: number; total: number | null } | null>(null);

let unlisten: (() => void) | null = null;

onMounted(() => {
  available.value = !!tauriCore();
});

onScopeDispose(() => {
  unlisten?.();
});

async function check() {
  const core = tauriCore();
  if (!core || checking.value) return;
  checking.value = true;
  try {
    status.value = await core.invoke<UpdateStatus>('desktop_check_update');
  } catch (error) {
    toast.add({ title: 'Update check failed', description: errorMessage(error), color: 'error' });
  } finally {
    checking.value = false;
  }
}

async function install() {
  const core = tauriCore();
  const events = tauriEvent();
  if (!core || installing.value) return;
  installing.value = true;
  progress.value = { downloaded: 0, total: null };
  try {
    if (events && !unlisten) {
      unlisten = await events.listen<{ downloaded: number; total: number | null }>(
        'piwi:update-progress',
        ({ payload }) => {
          progress.value = payload;
        },
      );
    }
    await core.invoke('desktop_install_update');
    installed.value = true;
  } catch (error) {
    toast.add({ title: 'Update failed', description: errorMessage(error), color: 'error' });
    progress.value = null;
  } finally {
    installing.value = false;
  }
}

async function restart() {
  const core = tauriCore();
  if (!core) return;
  try {
    await core.invoke('desktop_restart_app');
  } catch {
    // The process is replacing itself — a dropped IPC response is expected.
  }
}

const progressPercent = computed(() => {
  const p = progress.value;
  if (!p?.total) return null;
  return Math.min(100, Math.round((p.downloaded / p.total) * 100));
});

/** Windows closes the app to install; macOS installs alongside it. */
const exitsOnInstall = computed(() => status.value?.exits_on_install === true);
</script>

<template>
  <SectionCard v-if="available" icon="i-lucide-arrow-up-circle" title="Updates">
    <template #subtitle>
      Updates come from GitHub releases{{ currentVersion ? ` — you are on v${currentVersion}` : '' }}.
    </template>

    <div class="space-y-3">
      <div v-if="!status" class="flex items-center justify-between gap-3">
        <p class="text-sm text-muted">Check GitHub for a newer version of the desktop app.</p>
        <UButton size="xs" icon="i-lucide-refresh-cw" :loading="checking" @click="check">Check for updates</UButton>
      </div>

      <template v-else-if="status.state === 'unsupported'">
        <p class="text-sm text-muted">
          This build has no update channel — dev builds and releases made without the update signing key cannot
          self-update. Grab new versions from the
          <ULink
            to="https://github.com/piwitests/platform/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline"
            >latest release</ULink
          >.
        </p>
      </template>

      <template v-else-if="status.state === 'uptodate'">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm flex items-center gap-2">
            <UIcon name="i-lucide-check-circle" class="size-4 text-success" /> You're on the latest version.
          </p>
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="checking"
            @click="check"
          >
            Check again
          </UButton>
        </div>
      </template>

      <template v-else>
        <div class="flex items-start justify-between gap-3">
          <div class="space-y-1 min-w-0">
            <p class="text-sm font-medium">Version {{ status.version }} is available</p>
            <p v-if="status.notes" class="text-xs text-muted whitespace-pre-wrap line-clamp-6">{{ status.notes }}</p>
          </div>
          <UButton
            v-if="!installed"
            size="xs"
            icon="i-lucide-download"
            :loading="installing"
            class="shrink-0"
            @click="install"
          >
            {{ installing ? 'Installing…' : exitsOnInstall ? 'Install and quit' : 'Install update' }}
          </UButton>
          <UButton
            v-else-if="!exitsOnInstall"
            size="xs"
            color="success"
            icon="i-lucide-rotate-cw"
            class="shrink-0"
            @click="restart"
          >
            Restart now
          </UButton>
        </div>
        <UProgress v-if="installing && progressPercent !== null" :model-value="progressPercent" size="sm" />
        <p v-if="exitsOnInstall && !installed" class="text-xs text-muted">
          Piwi closes while the installer runs — Windows cannot replace an app that is open.
        </p>
        <p v-else-if="installed" class="text-xs text-muted">
          The update is installed — it applies the next time the app starts.
        </p>
      </template>
    </div>
  </SectionCard>
</template>
