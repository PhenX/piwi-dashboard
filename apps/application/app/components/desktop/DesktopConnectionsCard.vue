<script setup lang="ts">
/**
 * Desktop shell only: choose which Piwi instance this app points at.
 *
 * Local mode (the bundled server on this computer) is the default. Connect mode
 * points the window at a shared team instance's own origin so the native app
 * shows the team's data. This card lists "This computer (local)" plus any saved
 * team instances, adds a new one from a URL, and switches between them (the shell
 * relaunches onto the chosen instance).
 *
 * It renders only inside the shell — the card talks to the native IPC bridge and
 * shows nothing in a plain browser. The bridge is present in both modes, so the
 * card is also how a user connected to a remote instance switches back to local.
 */
const { available, loading, busy, connections, active, add, remove, connect } = useDesktopConnections();

const url = ref('');
const label = ref('');
const adding = ref(false);

const connectedRemotely = computed(() => active.value?.kind === 'remote');

async function onAdd() {
  if (!url.value.trim()) return;
  adding.value = true;
  try {
    const ok = await add(url.value, label.value);
    if (ok) {
      url.value = '';
      label.value = '';
    }
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <SectionCard v-if="available" icon="i-lucide-server" title="Instance">
    <template #subtitle>
      Point this app at your team's shared Piwi instance, or keep using the private server on this computer.
    </template>

    <div v-if="loading" class="flex items-center gap-2 text-sm text-muted">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" /> Checking…
    </div>

    <div v-else class="space-y-5">
      <!-- Where the app is pointed right now. -->
      <div
        class="flex items-start gap-2 rounded-lg border border-default p-3 text-sm"
        :class="connectedRemotely ? 'bg-primary/5' : 'bg-elevated/50'"
      >
        <UIcon
          :name="connectedRemotely ? 'i-lucide-cloud' : 'i-lucide-monitor'"
          class="size-4 mt-0.5 shrink-0 text-muted"
        />
        <div class="min-w-0">
          <p class="font-medium">
            {{ connectedRemotely ? `Connected to ${active?.label}` : 'Using the local server on this computer' }}
          </p>
          <p v-if="connectedRemotely" class="text-xs text-muted break-all">{{ active?.origin }}</p>
          <p v-else class="text-xs text-muted">
            Runs and results stay on this machine and are private to you. Add a team instance to share them.
          </p>
        </div>
      </div>

      <!-- The list of instances to switch between. -->
      <ul class="divide-y divide-default rounded-lg border border-default">
        <li v-for="c in connections" :key="c.id" class="flex items-center gap-3 p-3">
          <UIcon
            :name="c.kind === 'local' ? 'i-lucide-monitor' : 'i-lucide-cloud'"
            class="size-4 shrink-0 text-muted"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm truncate">{{ c.label }}</span>
              <UBadge v-if="c.active" color="primary" variant="subtle" size="xs">Active</UBadge>
            </div>
            <p class="text-xs text-muted truncate">
              {{ c.kind === 'local' ? 'Runs on this computer' : c.origin }}
            </p>
          </div>
          <UButton
            v-if="!c.active"
            size="xs"
            variant="soft"
            color="neutral"
            :disabled="busy"
            icon="i-lucide-arrow-right-left"
            @click="connect(c.id)"
          >
            Connect
          </UButton>
          <UButton
            v-if="c.kind === 'remote'"
            size="xs"
            variant="ghost"
            color="neutral"
            :disabled="busy"
            icon="i-lucide-trash-2"
            :aria-label="`Remove ${c.label}`"
            @click="remove(c.id)"
          />
        </li>
      </ul>

      <!-- Add a team instance. -->
      <form class="space-y-3" @submit.prevent="onAdd">
        <div class="space-y-1">
          <label class="text-sm font-medium">Add a team instance</label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <UInput
              v-model="url"
              placeholder="https://piwi.example.com"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              class="flex-1"
              :disabled="adding"
            />
            <UInput v-model="label" placeholder="Name (optional)" class="sm:w-48" :disabled="adding" />
            <UButton type="submit" :loading="adding" :disabled="!url.trim() || busy" icon="i-lucide-plus">
              Add
            </UButton>
          </div>
        </div>

        <div class="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-muted">
          <UIcon name="i-lucide-shield-alert" class="size-4 mt-0.5 shrink-0 text-warning" />
          <p>
            Connecting to an instance trusts its web app with actions on this computer — running local tests, reading
            linked folders, saving downloads and showing notifications. Add only instances your team runs. You sign in
            on the instance's own login page, and you can switch back to local at any time.
          </p>
        </div>
      </form>
    </div>
  </SectionCard>
</template>
