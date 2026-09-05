<script setup lang="ts">
import { describeCluster, clusterSignatureLine } from '#shared/describe-cluster';
import { getProviderIcon } from '#shared/link-detect';
import type { TableColumn } from '@nuxt/ui';
import type { ProjectFailureCluster } from '~~/types/api';

const props = defineProps<{
  projectId: string | number;
}>();

const emit = defineEmits<{ count: [total: number] }>();

const statusFilter = ref<string | undefined>(undefined);
const {
  data: clusters,
  pending: loading,
  refresh,
} = await useFetch(
  () => {
    const params = new URLSearchParams();
    if (statusFilter.value) params.set('status', statusFilter.value);
    const qs = params.toString();
    return `/api/projects/${props.projectId}/failure-clusters${qs ? `?${qs}` : ''}`;
  },
  {
    lazy: true,
    server: false,
    watch: [statusFilter],
    transform: (r: { items: ProjectFailureCluster[] }) => r.items,
  },
);

// Only the unfiltered list stands for the project's cluster count.
watch(clusters, (list) => {
  if (list && !statusFilter.value) emit('count', list.length);
});

const resolutionOf = (cluster: ProjectFailureCluster) => fixVerificationBadge(cluster.fixVerification);

// ── Bulk status ─────────────────────────────────────────────────────────────
// Multi-select the clusters and set them all to one status at once, so a
// project's backlog doesn't have to be triaged a row at a time.
const toast = useToast();
const { canWrite } = useAuth();
const selectedIds = ref<Set<number>>(new Set());
const rows = computed(() => clusters.value ?? []);
const selectedCount = computed(() => selectedIds.value.size);
const allSelected = computed(() => rows.value.length > 0 && rows.value.every((c) => selectedIds.value.has(c.id)));
const someSelected = computed(() => selectedIds.value.size > 0 && !allSelected.value);
const bulkBusy = ref(false);

function toggleRow(id: number) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}
function toggleAll() {
  selectedIds.value = allSelected.value ? new Set() : new Set(rows.value.map((c) => c.id));
}
function clearSelection() {
  selectedIds.value = new Set();
}
// Drop selections that scroll out when the status filter changes.
watch(clusters, () => {
  const present = new Set(rows.value.map((c) => c.id));
  const filtered = new Set([...selectedIds.value].filter((id) => present.has(id)));
  if (filtered.size !== selectedIds.value.size) selectedIds.value = filtered;
});

async function setStatus(status: 'open' | 'resolved' | 'ignored') {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  bulkBusy.value = true;
  let succeeded = 0;
  let failed = 0;
  try {
    for (const id of ids) {
      try {
        await $fetch(`/api/failure-clusters/${id}/status`, { method: 'PATCH', body: { status } });
        succeeded++;
      } catch {
        failed++;
      }
    }
    const label = `${succeeded} cluster${succeeded === 1 ? '' : 's'} set to ${status}`;
    if (failed === 0) toast.add({ title: label, color: 'success' });
    else
      toast.add({
        title: label,
        description: `${failed} could not be updated.`,
        color: succeeded > 0 ? 'warning' : 'error',
      });
    if (succeeded > 0) {
      clearSelection();
      await refresh();
    }
  } finally {
    bulkBusy.value = false;
  }
}

const columns = computed<TableColumn<ProjectFailureCluster>[]>(() => [
  ...(canWrite.value ? [{ id: 'select', header: '' } as TableColumn<ProjectFailureCluster>] : []),
  { accessorKey: 'signature', header: createSortHeader<ProjectFailureCluster>('Signature') },
  { accessorKey: 'errorType', header: createSortHeader<ProjectFailureCluster>('Type') },
  { accessorKey: 'status', header: createSortHeader<ProjectFailureCluster>('Status') },
  { accessorKey: 'affectedTests', header: createSortHeader<ProjectFailureCluster>('Tests') },
  { accessorKey: 'occurrences', header: createSortHeader<ProjectFailureCluster>('Occurrences') },
  { accessorKey: 'diagnosis', header: 'AI' },
  { accessorKey: 'lastSeenAt', header: createSortHeader<ProjectFailureCluster>('Last seen') },
]);
</script>

<template>
  <UCard data-shot="failure-clusters">
    <template #header>
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500 inline-flex items-center gap-1">
          Ongoing failure signatures grouped by normalized error.
          <HelpHint topic="cluster.concept" />
        </p>
        <USelect
          v-model="statusFilter"
          :items="[
            { label: 'All', value: undefined },
            { label: 'Open', value: 'open' },
            { label: 'Resolved', value: 'resolved' },
            { label: 'Ignored', value: 'ignored' },
          ]"
          size="xs"
          class="w-32"
        />
      </div>
    </template>

    <!-- Bulk status bar — appears once clusters are selected. -->
    <div
      v-if="canWrite && selectedCount > 0"
      class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2"
    >
      <span class="text-sm font-medium" aria-live="polite"> {{ selectedCount }} selected </span>
      <div class="flex flex-wrap items-center gap-2 ml-auto">
        <UDropdownMenu
          :items="[
            { label: 'Open', onSelect: () => setStatus('open') },
            { label: 'Resolved', onSelect: () => setStatus('resolved') },
            { label: 'Ignored', onSelect: () => setStatus('ignored') },
          ]"
        >
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-triangle-alert"
            trailing-icon="i-lucide-chevron-down"
            :loading="bulkBusy"
          >
            Set status…
          </UButton>
        </UDropdownMenu>
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="clearSelection">Clear</UButton>
      </div>
    </div>

    <TableScroller min-width="48rem" :bleed="false">
      <UTable :data="clusters ?? []" :columns="columns" :loading="loading">
        <template #select-header>
          <input
            type="checkbox"
            class="size-4 cursor-pointer accent-primary focus-visible:ring-2 focus-visible:ring-primary rounded"
            :checked="allSelected"
            :indeterminate.prop="someSelected"
            :aria-label="allSelected ? 'Deselect all clusters' : 'Select all clusters'"
            @change="toggleAll"
          />
        </template>
        <template #select-cell="{ row }">
          <input
            type="checkbox"
            class="size-4 cursor-pointer accent-primary focus-visible:ring-2 focus-visible:ring-primary rounded"
            :checked="selectedIds.has(row.original.id)"
            :aria-label="`Select cluster ${describeCluster(row.original)}`"
            @change="toggleRow(row.original.id)"
          />
        </template>

        <template #signature-cell="{ row }">
          <div class="min-w-0 space-y-0.5">
            <div class="flex items-center gap-1.5 min-w-0">
              <NuxtLink
                :to="`/failure-clusters/${row.original.id}`"
                class="text-sm text-primary hover:underline truncate"
                :title="row.original.signature"
              >
                {{ describeCluster(row.original) }}
              </NuxtLink>
              <a
                v-if="row.original.issueLink"
                :href="row.original.issueLink.url"
                target="_blank"
                rel="noopener noreferrer"
                class="shrink-0"
                :title="`Known issue: ${row.original.issueLink.key ?? row.original.issueLink.url}`"
                @click.stop
              >
                <UBadge color="neutral" variant="subtle" size="xs" class="gap-1">
                  <UIcon :name="getProviderIcon(row.original.issueLink.provider as any)" class="size-3" />
                  {{ row.original.issueLink.key ?? 'Issue' }}
                </UBadge>
              </a>
            </div>
            <p v-if="clusterSignatureLine(row.original)" class="text-xs text-gray-500 font-mono truncate">
              {{ row.original.signature }}
            </p>
            <p v-if="row.original.triageNote" class="text-xs text-gray-500 italic truncate">
              {{ row.original.triageNote }}
            </p>
          </div>
        </template>

        <template #errorType-cell="{ row }">
          <UBadge
            v-if="row.original.errorType"
            :color="clusterErrorTypeColor(row.original.errorType)"
            variant="subtle"
            size="sm"
          >
            {{ row.original.errorType }}
          </UBadge>
          <span v-else class="text-gray-400 text-xs">—</span>
        </template>

        <!-- Triage status is what a human declared; the resolution badge below it
             is what the runs actually showed. They disagree often enough — a
             cluster fixed but never triaged — that both have to be visible. -->
        <template #status-cell="{ row }">
          <div class="space-y-1">
            <UBadge :color="clusterStatusColor(row.original.status)" variant="subtle" size="sm">
              {{ formatTriageStatus(row.original.status) }}
            </UBadge>
            <UTooltip v-if="resolutionOf(row.original)" :text="resolutionOf(row.original)!.hint">
              <UBadge :color="resolutionOf(row.original)!.color" variant="subtle" size="sm" class="gap-1">
                <UIcon :name="resolutionOf(row.original)!.icon" class="size-3" />
                {{ resolutionOf(row.original)!.label }}
              </UBadge>
            </UTooltip>
          </div>
        </template>

        <template #affectedTests-cell="{ row }">
          <span class="text-sm tabular-nums">{{ row.original.affectedTests }}</span>
        </template>

        <template #occurrences-cell="{ row }">
          <span class="text-sm tabular-nums">{{ row.original.occurrences }}</span>
        </template>

        <template #diagnosis-cell="{ row }">
          <UBadge
            v-if="row.original.diagnosis?.status === 'completed' && row.original.diagnosis.category"
            color="neutral"
            variant="subtle"
            size="sm"
            class="gap-1"
          >
            <UIcon name="i-lucide-sparkles" class="size-3" />
            {{ row.original.diagnosis.category }}
          </UBadge>
          <span v-else class="text-gray-400 text-xs">—</span>
        </template>

        <template #lastSeenAt-cell="{ row }">
          <div class="text-sm text-gray-500 whitespace-nowrap">
            <NuxtLink :to="`/test-runs/${row.original.lastSeenRunId}`" class="text-primary hover:underline">
              run #{{ row.original.lastSeenRunId }}
            </NuxtLink>
            <span v-if="row.original.lastSeenAt" class="ml-1 text-xs text-gray-400">
              ({{ formatRelativeTime(row.original.lastSeenAt) }})
            </span>
          </div>
        </template>
      </UTable>
    </TableScroller>

    <EmptyState
      v-if="!loading && clusters && clusters.length === 0"
      text="No failure clusters recorded for this project."
      :padded="false"
      class="py-4"
    />
  </UCard>
</template>
