<script setup lang="ts">
import type { AnalyticsHeatmap } from '#shared/analytics/types';

const props = defineProps<{ query: Record<string, string> }>();

const {
  data: heatmap,
  pending,
  error,
  refresh,
} = await useAnalyticsWidget<AnalyticsHeatmap>('pass-rate-heatmap', () => props.query);

function cellStyle(rate: number | null): Record<string, string> {
  if (rate === null) return {};
  // Green (high) → amber → red (low), with alpha rising as it worsens.
  if (rate >= 99.5) return { backgroundColor: 'rgba(34, 197, 94, 0.85)' };
  if (rate >= 90) return { backgroundColor: 'rgba(34, 197, 94, 0.5)' };
  if (rate >= 75) return { backgroundColor: 'rgba(245, 158, 11, 0.55)' };
  if (rate >= 50) return { backgroundColor: 'rgba(249, 115, 22, 0.65)' };
  return { backgroundColor: 'rgba(239, 68, 68, 0.75)' };
}

function cellTitle(row: { name: string; label: string | null }, index: number, rate: number | null): string {
  const date = heatmap.value?.buckets[index] ?? '';
  const span = (heatmap.value?.bucketDays ?? 1) > 1 ? ` (${heatmap.value!.bucketDays} days)` : '';
  return `${row.label || row.name} · ${date}${span}: ${rate !== null ? `${rate}% passed` : 'no runs'}`;
}

const legendItems = [
  { color: 'rgba(34, 197, 94, 0.85)', label: '100%' },
  { color: 'rgba(34, 197, 94, 0.5)', label: '≥ 90%' },
  { color: 'rgba(245, 158, 11, 0.55)', label: '≥ 75%' },
  { color: 'rgba(249, 115, 22, 0.65)', label: '≥ 50%' },
  { color: 'rgba(239, 68, 68, 0.75)', label: '< 50%' },
];

const subtitle = computed(() => {
  const bucketDays = heatmap.value?.bucketDays ?? 1;
  return bucketDays > 1 ? `One cell = ${bucketDays} days` : 'One cell = one day';
});
</script>

<template>
  <ChartCard icon="i-lucide-grid-3x3" title="Pass rate heatmap" :subtitle="subtitle" help="analytics.heatmap">
    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load the heatmap: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="!heatmap || heatmap.rows.length === 0" text="No runs in this period." />
    <TableScroller v-else min-width="40rem">
      <div class="space-y-1">
        <div
          v-for="row in heatmap.rows"
          :key="row.projectId"
          class="grid items-center gap-2"
          style="grid-template-columns: 10rem 1fr"
        >
          <NuxtLink
            :to="`/projects/${row.projectId}`"
            class="text-sm truncate hover:text-primary"
            :title="row.label || row.name"
          >
            {{ row.label || row.name }}
          </NuxtLink>
          <div class="flex gap-px">
            <div
              v-for="(rate, index) in row.cells"
              :key="index"
              class="h-6 flex-1 rounded-sm min-w-1 bg-gray-100 dark:bg-gray-800"
              :style="cellStyle(rate)"
              :title="cellTitle(row, index, rate)"
            />
          </div>
        </div>
        <div class="grid gap-2" style="grid-template-columns: 10rem 1fr">
          <span />
          <div class="flex justify-between text-xs text-gray-400">
            <span>{{ heatmap.buckets[0] }}</span>
            <span>{{ heatmap.buckets[heatmap.buckets.length - 1] }}</span>
          </div>
        </div>
        <ChartLegend :items="legendItems" dense />
      </div>
    </TableScroller>
  </ChartCard>
</template>
