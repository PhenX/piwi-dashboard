<script setup lang="ts">
import { describeCluster } from '#shared/describe-cluster';
import { getProviderIcon } from '#shared/link-detect';
import type { LinkProvider } from '#shared/link-detect';
import type { OpenFailureCluster } from '~~/types/api';

const props = defineProps<{
  clusters: OpenFailureCluster[];
  canWrite: boolean;
}>();

const emit = defineEmits<{ changed: [] }>();

const toast = useToast();

const PREVIEW_LIMIT = 10;

// Rows the user has just resolved/ignored — dropped from the list at once so the
// action reads as "handled", before the background refresh catches up.
const removedIds = ref(new Set<number>());

watch(
  () => props.clusters.map((c) => c.id).join(','),
  () => {
    // Drop ids the refresh already removed so the set can't grow unbounded.
    const present = new Set(props.clusters.map((c) => c.id));
    for (const id of removedIds.value) if (!present.has(id)) removedIds.value.delete(id);
  },
);

const rows = computed(() => props.clusters.filter((c) => !removedIds.value.has(c.id)));

const expanded = ref(false);
const visibleRows = computed(() => (expanded.value ? rows.value : rows.value.slice(0, PREVIEW_LIMIT)));
const hasMore = computed(() => rows.value.length > PREVIEW_LIMIT);

// ── Selection & keyboard (j/k move, o opens, r/i triage) ─────────────────────

const selectedIndex = ref(-1);

watch(visibleRows, (list) => {
  if (selectedIndex.value >= list.length) selectedIndex.value = list.length - 1;
});

function clusterHref(cluster: OpenFailureCluster): string {
  return `/failure-clusters/${cluster.id}`;
}

function open(cluster: OpenFailureCluster): void {
  navigateTo(clusterHref(cluster));
}

async function setStatus(cluster: OpenFailureCluster, status: 'resolved' | 'ignored'): Promise<void> {
  if (!props.canWrite) return;
  try {
    await $fetch(`/api/failure-clusters/${cluster.id}/status`, { method: 'PATCH', body: { status } });
    removedIds.value = new Set([...removedIds.value, cluster.id]);
    toast.add({
      title: `${describeCluster(cluster)} set to ${formatTriageStatus(status)}`,
      color: 'success',
    });
    emit('changed');
  } catch (e) {
    toast.add({ title: 'Could not update the cluster', description: errorMessage(e), color: 'error' });
  }
}

function onKeydown(e: KeyboardEvent): void {
  // Never hijack typing or a modified chord.
  const target = e.target as HTMLElement | null;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  const list = visibleRows.value;
  if (list.length === 0) return;

  switch (e.key) {
    case 'j':
      e.preventDefault();
      selectedIndex.value = Math.min(list.length - 1, Math.max(0, selectedIndex.value + 1));
      break;
    case 'k':
      e.preventDefault();
      selectedIndex.value = Math.max(0, (selectedIndex.value < 0 ? 0 : selectedIndex.value) - 1);
      break;
    case 'o': {
      const sel = list[selectedIndex.value];
      if (sel) {
        e.preventDefault();
        open(sel);
      }
      break;
    }
    case 'r': {
      const sel = list[selectedIndex.value];
      if (sel && props.canWrite) {
        e.preventDefault();
        void setStatus(sel, 'resolved');
      }
      break;
    }
    case 'i': {
      const sel = list[selectedIndex.value];
      if (sel && props.canWrite) {
        e.preventDefault();
        void setStatus(sel, 'ignored');
      }
      break;
    }
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

function ageTitle(cluster: OpenFailureCluster): string {
  return cluster.lastSeenAt ? prettyDateFormat(cluster.lastSeenAt) : '';
}
</script>

<template>
  <SectionCard icon="i-lucide-inbox" title="Open failures" help="home.open-failures">
    <template #actions>
      <UButton
        v-if="hasMore && !expanded"
        variant="ghost"
        size="sm"
        trailing-icon="i-lucide-chevron-down"
        @click="expanded = true"
      >
        Show all {{ rows.length }}
      </UButton>
      <UButton
        v-else-if="expanded"
        variant="ghost"
        size="sm"
        trailing-icon="i-lucide-chevron-up"
        @click="expanded = false"
      >
        Show less
      </UButton>
    </template>

    <p v-if="rows.length === 0" class="py-3 text-sm text-gray-500 dark:text-gray-400">
      No open failure clusters — nothing needs triage right now.
    </p>

    <div v-else class="divide-y divide-gray-100 dark:divide-gray-800">
      <div
        v-for="(cluster, index) in visibleRows"
        :key="cluster.id"
        role="button"
        tabindex="0"
        :aria-current="index === selectedIndex ? 'true' : undefined"
        class="group flex flex-col gap-2 py-3 px-2 -mx-2 rounded-md cursor-pointer md:flex-row md:items-center md:gap-4 hover:bg-gray-50 dark:hover:bg-gray-800/60"
        :class="index === selectedIndex ? 'bg-primary/5 ring-1 ring-primary/30' : ''"
        @click="open(cluster)"
        @mouseenter="selectedIndex = index"
        @keydown.enter="open(cluster)"
      >
        <!-- Name + project -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <NuxtLink
              :to="clusterHref(cluster)"
              class="text-sm font-medium text-primary hover:underline truncate"
              :title="cluster.signature"
              @click.stop
            >
              {{ describeCluster(cluster) }}
            </NuxtLink>
            <a
              v-if="cluster.issueLink"
              :href="cluster.issueLink.url"
              target="_blank"
              rel="noopener noreferrer"
              class="shrink-0"
              :title="`Known issue: ${cluster.issueLink.key ?? cluster.issueLink.url}`"
              @click.stop
            >
              <UBadge color="neutral" variant="subtle" size="xs" class="gap-1">
                <UIcon :name="getProviderIcon(cluster.issueLink.provider as LinkProvider)" class="size-3" />
                {{ cluster.issueLink.key ?? 'Issue' }}
              </UBadge>
            </a>
          </div>
          <div class="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span class="truncate">{{ cluster.projectLabel || cluster.projectName }}</span>
            <span v-if="cluster.owner" class="shrink-0">· {{ cluster.owner.name }}</span>
          </div>
        </div>

        <!-- Meta: tests · age · triage status -->
        <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 shrink-0">
          <span class="tabular-nums whitespace-nowrap">
            {{ cluster.affectedTests }} {{ cluster.affectedTests === 1 ? 'test' : 'tests' }}
          </span>
          <ClientOnly>
            <span v-if="cluster.lastSeenAt" :title="ageTitle(cluster)" class="whitespace-nowrap">
              {{ formatRelativeTime(cluster.lastSeenAt) }}
            </span>
          </ClientOnly>
          <UBadge :color="clusterStatusColor(cluster.status)" variant="subtle" size="xs">
            {{ formatTriageStatus(cluster.status) }}
          </UBadge>
        </div>

        <!-- Triage actions (reporter / admin) -->
        <div
          v-if="canWrite"
          class="flex items-center gap-1 shrink-0 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
        >
          <UButton
            size="xs"
            color="success"
            variant="ghost"
            icon="i-lucide-check"
            :title="`Mark ${describeCluster(cluster)} resolved`"
            @click.stop="setStatus(cluster, 'resolved')"
          >
            Resolve
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-bell-off"
            :title="`Ignore ${describeCluster(cluster)}`"
            @click.stop="setStatus(cluster, 'ignored')"
          >
            Ignore
          </UButton>
        </div>
      </div>
    </div>
  </SectionCard>
</template>
