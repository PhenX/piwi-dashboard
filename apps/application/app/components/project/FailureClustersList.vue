<script setup lang="ts">
import { describeCluster, clusterSignatureLine } from '#shared/describe-cluster';
import type { TableColumn } from '@nuxt/ui';
import type { ProjectFailureCluster } from '~~/types/api';

const props = defineProps<{
  projectId: string | number;
}>();

const statusFilter = ref<string | undefined>(undefined);
const { data: clusters, pending: loading } = await useFetch(
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

const resolutionOf = (cluster: ProjectFailureCluster) => fixVerificationBadge(cluster.fixVerification);

const columns: TableColumn<ProjectFailureCluster>[] = [
  { accessorKey: 'signature', header: createSortHeader<ProjectFailureCluster>('Signature') },
  { accessorKey: 'errorType', header: createSortHeader<ProjectFailureCluster>('Type') },
  { accessorKey: 'status', header: createSortHeader<ProjectFailureCluster>('Status') },
  { accessorKey: 'affectedTests', header: createSortHeader<ProjectFailureCluster>('Tests') },
  { accessorKey: 'occurrences', header: createSortHeader<ProjectFailureCluster>('Occurrences') },
  { accessorKey: 'diagnosis', header: 'AI' },
  { accessorKey: 'lastSeenAt', header: createSortHeader<ProjectFailureCluster>('Last seen') },
  { id: 'actions', header: 'Actions' },
];
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

    <TableScroller min-width="48rem" :bleed="false">
      <UTable :data="clusters ?? []" :columns="columns" :loading="loading">
        <template #actions-header>
          <div class="text-right">Actions</div>
        </template>

        <template #signature-cell="{ row }">
          <div class="min-w-0 space-y-0.5">
            <NuxtLink
              :to="`/failure-clusters/${row.original.id}`"
              class="text-sm text-primary hover:underline truncate block"
              :title="row.original.signature"
            >
              {{ describeCluster(row.original) }}
            </NuxtLink>
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
              {{ row.original.status }}
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

        <template #actions-cell="{ row }">
          <div class="flex justify-end">
            <UButton
              :to="`/failure-clusters/${row.original.id}`"
              size="sm"
              variant="outline"
              trailing-icon="i-lucide-arrow-right"
            >
              View
            </UButton>
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
