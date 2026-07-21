<script setup lang="ts">
import { VisXYContainer, VisArea, VisAxis } from '@unovis/vue';
import { CurveType } from '@unovis/ts';
import type { AnalyticsWastedTime } from '#shared/analytics/types';

const props = defineProps<{ query: Record<string, string> }>();

const {
  data: wasted,
  pending,
  error,
  refresh,
} = await useAnalyticsWidget<AnalyticsWastedTime>('wasted-time', () => props.query);

type DataPoint = { date: Date; waitMinutes: number; failedExecMinutes: number };

const chartData = computed<DataPoint[]>(
  () =>
    wasted.value?.points.map((p) => ({
      date: new Date(p.date),
      waitMinutes: p.waitMinutes,
      failedExecMinutes: p.failedExecMinutes,
    })) ?? [],
);

const hasData = computed(() => chartData.value.some((p) => p.waitMinutes > 0 || p.failedExecMinutes > 0));

const x = (d: DataPoint) => d.date;
const areaColors = ['rgb(245, 158, 11)', 'rgb(239, 68, 68)'] as const;

const xyContainerRef = ref<UnovisContainerRef | null>(null);
const { tooltipData, tooltipPos, onRenderComplete } = useChartMarkers(xyContainerRef, chartData, {
  x: (d) => d.date,
  series: [
    { y: (d) => d.waitMinutes, color: areaColors[0] },
    { y: (d) => d.failedExecMinutes, color: areaColors[1] },
  ],
});

const legendItems = [
  { color: areaColors[0], label: 'Wait steps' },
  { color: areaColors[1], label: 'Failed attempts' },
];

const subtitle = computed(() => {
  if (!wasted.value) return undefined;
  const total = wasted.value.totalWaitMinutes + wasted.value.totalFailedExecMinutes;
  const label = total < 60 ? `${Math.round(total)} min` : `${Math.round((total / 60) * 10) / 10} h`;
  return `${label} of CI time produced no signal`;
});

const reclaim = computed(() => wasted.value?.timeoutReclaimable ?? null);
const reclaimLabel = computed(() => {
  const m = reclaim.value?.estimatedMinutes ?? 0;
  return m < 60 ? `${Math.round(m)} min` : `${Math.round((m / 60) * 10) / 10} h`;
});
</script>

<template>
  <ChartCard icon="i-lucide-hourglass" title="Wasted CI time" :subtitle="subtitle" help="analytics.wasted-time">
    <template #legend>
      <ChartLegend :items="legendItems" dense />
    </template>

    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load wasted time: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="!hasData" text="No wasted time recorded in this period." />
    <div v-else class="w-full relative">
      <VisXYContainer
        ref="xyContainerRef"
        :data="chartData"
        :height="220"
        :padding="{ top: 10, right: 10, bottom: 0, left: 0 }"
        :on-render-complete="onRenderComplete"
      >
        <VisArea
          :x="x"
          :y="[(d: DataPoint) => d.waitMinutes, (d: DataPoint) => d.failedExecMinutes]"
          :color="areaColors"
          :curve-type="CurveType.MonotoneX"
        />
        <VisAxis
          type="x"
          :tick-format="(d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })"
        />
        <VisAxis type="y" label="Minutes" :tick-format="(d: number) => d.toString()" />
      </VisXYContainer>

      <div
        v-if="tooltipData"
        class="fixed z-50 pointer-events-none bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-[240px]"
        :style="{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }"
      >
        <div class="p-2 text-sm text-gray-900 dark:text-gray-100">
          <div class="font-semibold mb-1">
            {{ new Date(tooltipData.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}
          </div>
          <div><span class="text-amber-500">&#9679;</span> Wait steps: {{ tooltipData.waitMinutes }} min</div>
          <div><span class="text-red-500">&#9679;</span> Failed attempts: {{ tooltipData.failedExecMinutes }} min</div>
        </div>
      </div>

      <div
        v-if="reclaim"
        class="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
      >
        <UIcon name="i-lucide-scissors" class="mt-0.5 shrink-0 text-amber-500" />
        <div class="text-gray-700 dark:text-gray-300">
          Up to <span class="font-semibold">≈{{ reclaimLabel }}</span> of this is avoidable —
          {{ reclaim.oversizedCount }} oversized {{ reclaim.oversizedCount === 1 ? 'timeout' : 'timeouts' }} and
          {{ reclaim.staleSlowCount }} stale <code class="text-xs">test.slow()</code>
          {{ reclaim.staleSlowCount === 1 ? 'mark' : 'marks' }} inflate the failed-attempt time above.
          <NuxtLink
            v-if="reclaim.topProjectId"
            :to="`/projects/${reclaim.topProjectId}#performance`"
            class="text-primary hover:underline"
            >Review</NuxtLink
          >
        </div>
      </div>

      <div v-if="wasted && wasted.byProject.length > 0" class="mt-4 space-y-1">
        <div
          v-for="project in wasted.byProject.slice(0, 5)"
          :key="project.projectId"
          class="flex items-center justify-between text-sm"
        >
          <NuxtLink :to="`/projects/${project.projectId}`" class="truncate hover:text-primary">
            {{ project.label || project.name }}
          </NuxtLink>
          <span class="tabular-nums text-gray-500 dark:text-gray-400 shrink-0">
            {{ Math.round(project.waitMinutes + project.failedExecMinutes) }} min
          </span>
        </div>
      </div>
    </div>
  </ChartCard>
</template>
