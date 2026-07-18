<script setup lang="ts">
import { VisXYContainer, VisArea, VisAxis, VisLine } from '@unovis/vue';
import { CurveType } from '@unovis/ts';
import type { AnalyticsCiTimeTrend } from '#shared/analytics/types';

const props = defineProps<{ query: Record<string, string> }>();

const {
  data: trend,
  pending,
  error,
  refresh,
} = await useAnalyticsWidget<AnalyticsCiTimeTrend>('ci-time-trend', () => props.query);

type DataPoint = { date: Date; totalMinutes: number; runCount: number };

const chartData = computed<DataPoint[]>(
  () => trend.value?.points.map((p) => ({ date: new Date(p.date), totalMinutes: p.totalMinutes, runCount: p.runCount })) ?? [],
);

const hasData = computed(() => chartData.value.some((p) => p.runCount > 0));

const x = (d: DataPoint) => d.date;
const y = (d: DataPoint) => d.totalMinutes;
const lineColor = 'rgb(59, 130, 246)';

const xyContainerRef = ref<UnovisContainerRef | null>(null);
const { tooltipData, tooltipPos, onRenderComplete } = useChartMarkers(xyContainerRef, chartData, {
  x: (d) => d.date,
  series: [{ y: (d) => d.totalMinutes, color: lineColor }],
});

const deltaBadge = computed(() => {
  if (!trend.value || trend.value.deltaPct === null) return null;
  const pct = trend.value.deltaPct;
  return {
    label: `${pct > 0 ? '+' : ''}${pct}% vs previous period`,
    class: pct > 25 ? 'text-red-600 dark:text-red-400' : pct < -10 ? 'text-green-600 dark:text-green-400' : 'text-gray-500',
  };
});

const subtitle = computed(() => {
  if (!trend.value) return undefined;
  const total = trend.value.totalMinutes;
  const label = total < 60 ? `${Math.round(total)} min` : `${Math.round((total / 60) * 10) / 10} h`;
  return `${label} across ${trend.value.runCount} runs`;
});
</script>

<template>
  <ChartCard icon="i-lucide-timer" title="CI time" :subtitle="subtitle" help="analytics.ci-time">
    <template #actions>
      <span v-if="deltaBadge" class="text-xs font-medium tabular-nums" :class="deltaBadge.class">
        {{ deltaBadge.label }}
      </span>
    </template>

    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load CI time: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="!hasData" text="No runs in this period." />
    <div v-else class="w-full relative">
      <VisXYContainer
        ref="xyContainerRef"
        :data="chartData"
        :height="220"
        :padding="{ top: 10, right: 10, bottom: 0, left: 0 }"
        :on-render-complete="onRenderComplete"
      >
        <VisArea :x="x" :y="y" :color="'rgba(59, 130, 246, 0.15)'" :curve-type="CurveType.MonotoneX" />
        <VisLine :x="x" :y="y" :color="lineColor" :curve-type="CurveType.MonotoneX" :line-width="2" />
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
          <div>{{ tooltipData.totalMinutes }} minutes</div>
          <div class="text-gray-400 text-xs">{{ tooltipData.runCount }} runs</div>
        </div>
      </div>
    </div>
  </ChartCard>
</template>
