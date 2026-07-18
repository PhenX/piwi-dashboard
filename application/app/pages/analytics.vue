<script setup lang="ts">
import type { Component } from 'vue';
import { ANALYTICS_WIDGETS, type AnalyticsWidgetId } from '#shared/analytics/registry';
import type { TestRunForChart } from '~~/types/api';
import {
  InsightsFeed,
  PortfolioScorecard,
  PassRateHeatmap,
  CiTimeTrendChart,
  WastedTimeChart,
  GlobalFlakyLeaderboard,
  ClusterLandscape,
} from '#components';

useHead({ title: 'Analytics - Piwi Dashboard' });

const { state, scopeQuery } = useAnalyticsScope();

// Environment options for the scope bar (same source as the home filters).
const { data: recentTestRuns } = await useFetch<TestRunForChart[]>('/api/test-runs/recent', {
  lazy: true,
  server: false,
  default: () => [] as TestRunForChart[],
});

const availableEnvironments = computed(() => {
  const envSet = new Set<string>();
  for (const run of recentTestRuns.value ?? []) {
    if (run.environment) envSet.add(run.environment);
  }
  return [...envSet].sort();
});

/**
 * Widget id → component. Keyed by the registry union, so registering a widget
 * without wiring its component (or vice versa) is a compile error.
 */
const WIDGET_COMPONENTS: Record<AnalyticsWidgetId, Component> = {
  insights: InsightsFeed,
  portfolio: PortfolioScorecard,
  'pass-rate-heatmap': PassRateHeatmap,
  'ci-time-trend': CiTimeTrendChart,
  'wasted-time': WastedTimeChart,
  'flaky-leaderboard': GlobalFlakyLeaderboard,
  'cluster-landscape': ClusterLandscape,
};
</script>

<template>
  <UDashboardPanel id="analytics">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb :items="[{ label: 'Analytics', icon: 'i-lucide-chart-line', to: '/analytics' }]" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-6 space-y-6">
        <FilterToolbar>
          <AnalyticsScopeBar v-model="state" :available-environments="availableEnvironments" />
        </FilterToolbar>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <div
            v-for="widget in ANALYTICS_WIDGETS"
            :key="widget.id"
            :class="widget.size === 'full' ? 'xl:col-span-2' : ''"
          >
            <component :is="WIDGET_COMPONENTS[widget.id]" :query="scopeQuery" />
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
