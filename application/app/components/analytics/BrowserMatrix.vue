<script setup lang="ts">
import type { AnalyticsBrowserMatrix } from '#shared/analytics/types';

const props = defineProps<{ query: Record<string, string> }>();

const {
  data: matrix,
  pending,
  error,
  refresh,
} = await useAnalyticsWidget<AnalyticsBrowserMatrix>('browser-matrix', () => props.query);

function cellClass(rate: number | null): string {
  if (rate === null) return 'bg-gray-100 dark:bg-gray-800 text-gray-400';
  if (rate >= 99.5) return 'bg-green-500/85 text-white';
  if (rate >= 90) return 'bg-green-500/45';
  if (rate >= 75) return 'bg-amber-500/50';
  if (rate >= 50) return 'bg-orange-500/60';
  return 'bg-red-500/70 text-white';
}
</script>

<template>
  <SectionCard icon="i-lucide-monitor-smartphone" title="Browser matrix" help="analytics.browser-matrix">
    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load the browser matrix: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="!matrix || matrix.rows.length === 0" text="No runs with browser data in this period." />
    <TableScroller v-else min-width="30rem">
      <table class="w-full text-sm border-separate border-spacing-1">
        <thead>
          <tr>
            <th class="text-left text-xs text-gray-500 uppercase tracking-wider font-medium pr-2">Project</th>
            <th
              v-for="browser in matrix.browsers"
              :key="browser"
              class="text-xs text-gray-500 uppercase tracking-wider font-medium px-1 text-center"
            >
              {{ browser }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in matrix.rows" :key="row.projectId">
            <td class="pr-2 max-w-[12rem]">
              <NuxtLink :to="`/projects/${row.projectId}`" class="truncate hover:text-primary block" :title="row.label || row.name">
                {{ row.label || row.name }}
              </NuxtLink>
            </td>
            <td
              v-for="(rate, index) in row.cells"
              :key="index"
              class="text-center tabular-nums rounded-md px-2 py-1.5 font-medium"
              :class="cellClass(rate)"
              :title="`${row.label || row.name} · ${matrix.browsers[index]}: ${rate !== null ? `${rate}% passed` : 'no tests'}`"
            >
              {{ rate !== null ? `${Math.round(rate)}%` : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </TableScroller>
  </SectionCard>
</template>
