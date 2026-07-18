<script setup lang="ts">
import { VisXYContainer, VisStackedBar, VisAxis } from '@unovis/vue';
import type { AnalyticsRegressionVelocity } from '#shared/analytics/types';

const props = defineProps<{ query: Record<string, string> }>();

const {
  data: velocity,
  pending,
  error,
  refresh,
} = await useAnalyticsWidget<AnalyticsRegressionVelocity>('regression-velocity', () => props.query);

type DataPoint = { date: Date; regressions: number; newFlaky: number };

const chartData = computed<DataPoint[]>(
  () =>
    velocity.value?.points.map((p) => ({
      date: new Date(p.date),
      regressions: p.regressions,
      newFlaky: p.newFlaky,
    })) ?? [],
);

const hasData = computed(() => chartData.value.some((p) => p.regressions > 0 || p.newFlaky > 0));

const x = (d: DataPoint) => d.date;
const barColors = ['rgb(239, 68, 68)', 'rgb(147, 51, 234)'] as const;

const legendItems = [
  { color: barColors[0], label: 'New regressions' },
  { color: barColors[1], label: 'Newly flaky' },
];

const deltaBadge = computed(() => {
  if (!velocity.value || velocity.value.deltaPct === null) return null;
  const pct = velocity.value.deltaPct;
  return {
    label: `${pct > 0 ? '+' : ''}${pct}% vs previous period`,
    // Fewer regressions is good, more is bad.
    class: pct > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400',
  };
});

const subtitle = computed(() => {
  if (!velocity.value) return undefined;
  return `${velocity.value.totalRegressions} new regressions, ${velocity.value.totalNewFlaky} newly flaky`;
});
</script>

<template>
  <ChartCard
    icon="i-lucide-git-pull-request-arrow"
    title="Regression velocity"
    :subtitle="subtitle"
    help="analytics.regression-velocity"
  >
    <template #legend>
      <ChartLegend :items="legendItems" dense />
    </template>
    <template #actions>
      <span v-if="deltaBadge" class="text-xs font-medium tabular-nums" :class="deltaBadge.class">
        {{ deltaBadge.label }}
      </span>
    </template>

    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load regression velocity: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="!hasData" icon="i-lucide-shield-check" text="No new regressions in this period." />
    <div v-else class="w-full">
      <VisXYContainer :data="chartData" :height="220" :padding="{ top: 10, right: 10, bottom: 0, left: 0 }">
        <VisStackedBar
          :x="x"
          :y="[(d: DataPoint) => d.regressions, (d: DataPoint) => d.newFlaky]"
          :color="barColors"
          :rounded-corners="2"
        />
        <VisAxis
          type="x"
          :tick-format="(d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })"
        />
        <VisAxis type="y" label="Count" :tick-format="(d: number) => d.toString()" />
      </VisXYContainer>
    </div>
  </ChartCard>
</template>
