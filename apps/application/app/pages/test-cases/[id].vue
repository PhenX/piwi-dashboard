<script setup lang="ts">
import type { TestCaseHistoryPoint, MarkerInfo, MarkersResponse } from '~~/types/api';
import type { TableColumn } from '@nuxt/ui';
import { CASE_STATUS_SERIES, legendOf } from '~/utils/chart';

const route = useRoute();
const testCaseId = route.params.id;

const { data: testCase, refresh } = await useFetch(`/api/test-cases/${testCaseId}`);
const { data: historyData } = await useFetch(`/api/test-cases/${testCaseId}/history`, {
  transform: (r: { items: TestCaseHistoryPoint[] }) => r.items,
});

// Project timeline markers, overlaid on the history chart for context.
const historyMarkers = ref<MarkerInfo[]>([]);
watch(
  () => testCase.value?.project?.id,
  async (pid) => {
    if (!pid) return;
    try {
      historyMarkers.value = (await $fetch<MarkersResponse>(`/api/projects/${pid}/markers`)).markers ?? [];
    } catch {
      // markers are optional context
    }
  },
  { immediate: true },
);
function goToProjectTimeline() {
  const pid = testCase.value?.project?.id;
  if (pid) navigateTo(`/projects/${pid}?tab=timeline`);
}

useHead(
  computed(() => ({
    title: `${testCase.value?.title || `Test case #${testCaseId}`} — Piwi Dashboard`,
  })),
);

const passRate = computed(() => {
  const t = testCase.value;
  if (!t || !t.totalRuns) return null;
  return Math.round(((t.passedRuns + t.skippedRuns) / t.totalRuns) * 100);
});

// Desktop shell: reproduce this test on this machine. Selected by title so no
// line number is needed; repeat ×20 with a trace is the flake-hunting preset.
const reproduceCases = computed(() =>
  testCase.value?.filePath ? [{ filePath: testCase.value.filePath, title: testCase.value.title, line: null }] : [],
);

const clusterColor = (status: string) => {
  return status === 'open' ? 'error' : status === 'resolved' ? 'success' : 'neutral';
};

interface ExecutionRow {
  id: number;
  status: string;
  duration: number | null;
  error: string | null;
  retries: number | null;
  workerIndex: number | null;
  browser: unknown;
  runId: number;
  runStatus: string;
  runLabel: string | null;
  startTime: string | Date;
}

const executionColumns: TableColumn<ExecutionRow>[] = [
  {
    accessorKey: 'startTime',
    header: 'Date',
  },
  {
    accessorKey: 'status',
    header: 'Status',
  },
  {
    accessorKey: 'duration',
    header: 'Duration',
  },
  {
    accessorKey: 'retries',
    header: 'Retries',
  },
  {
    accessorKey: 'runId',
    header: 'Run',
  },
  {
    accessorKey: 'error',
    header: 'Error',
  },
  {
    id: 'actions',
    header: 'Actions',
  },
];
</script>

<template>
  <UDashboardPanel id="test-case-evolution">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              ...(testCase?.project?.id
                ? [
                    {
                      label: testCase.project.name || 'Project',
                      to: `/projects/${testCase.project.id}`,
                    },
                  ]
                : [{ label: 'Project' }]),
              { label: testCase?.title || `Test case #${testCaseId}` },
            ]"
          />
        </template>
        <template #right>
          <DesktopRunLocallyButton
            :project-id="testCase?.project?.id"
            :project-label="testCase?.project?.label ?? testCase?.project?.name"
            :cases="reproduceCases"
            label="Reproduce locally"
            :preset-options="{ mode: 'grep', repeatEach: 20, trace: true }"
            class="mr-2"
          />
          <NavbarActions :actions="[{ label: 'Refresh', icon: 'i-lucide-refresh-cw', onClick: () => refresh() }]" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 p-4" data-shot="test-case-detail">
        <!-- Header -->
        <div class="flex items-start gap-4 flex-wrap">
          <div class="flex-1 min-w-0">
            <h1 class="text-xl font-bold truncate">{{ testCase?.title }}</h1>
            <OpenInIdeLink
              v-if="testCase?.filePath"
              :file-path="testCase.filePath"
              :project-key="testCase?.project?.id"
              :project-name="testCase?.project?.name"
              class="text-sm text-gray-500 mt-0.5"
            />
            <div v-if="testCase?.project" class="flex items-center gap-2 mt-2">
              <UBadge color="neutral" variant="soft" size="xs" class="font-mono">
                {{ testCase.project.name }}
              </UBadge>
              <UBadge v-if="testCase?.flakyRuns > 0" color="warning" variant="soft" size="xs">
                {{ testCase.flakyRuns }} flaky run{{ testCase.flakyRuns === 1 ? '' : 's' }}
              </UBadge>
            </div>
          </div>
          <NuxtLink
            v-if="testCase?.lastExecutionId"
            :to="`/test-run-cases/${testCase.lastExecutionId}`"
            class="shrink-0"
          >
            <UButton size="sm" variant="outline" trailing-icon="i-lucide-arrow-right"> Latest execution </UButton>
          </NuxtLink>
        </div>

        <!-- Stats cards -->
        <StatTileGrid>
          <StatTile label="Total runs" :value="testCase?.totalRuns ?? 0" />
          <StatTile
            label="Pass rate"
            :value="passRate !== null ? `${passRate}%` : '—'"
            :value-class="
              (passRate ?? 0) >= 80 ? 'text-green-600' : (passRate ?? 0) >= 50 ? 'text-yellow-600' : 'text-red-600'
            "
          />
          <StatTile label="Failed" :value="testCase?.failedRuns ?? 0" value-class="text-red-600" />
          <StatTile label="Avg duration">
            <DurationValue :ms="testCase?.avgDuration" />
          </StatTile>
          <StatTile
            label="Flaky"
            :value="testCase?.flakyRuns ?? 0"
            :value-class="(testCase?.flakyRuns ?? 0) > 0 ? 'text-purple-600' : ''"
          >
            <template #label> Flaky <HelpHint topic="case.flaky-count" /> </template>
          </StatTile>
          <StatTile
            label="Last run"
            size="sm"
            :value="testCase?.lastRunAt ? formatRelativeTime(testCase.lastRunAt) : '—'"
          />
        </StatTileGrid>

        <!-- Evolution charts -->
        <div v-if="historyData && historyData.length > 1" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="Duration trend"
            icon="i-lucide-trending-up"
            help="case.history-chart"
            :legend="legendOf(CASE_STATUS_SERIES)"
          >
            <TestCaseHistoryChart
              :data="historyData"
              :height="200"
              :markers="historyMarkers"
              @marker-click="goToProjectTimeline"
            />
          </ChartCard>

          <ChartCard title="Status history" icon="i-lucide-check-circle" help="case.sparkline">
            <div class="flex items-center gap-1 flex-wrap max-h-[200px] overflow-y-auto py-1">
              <UTooltip
                v-for="(point, i) in historyData"
                :key="point.id"
                :text="`Run #${point.runId}: ${point.status} — ${new Date(point.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`"
              >
                <NuxtLink
                  :to="`/test-run-cases/${point.id}`"
                  :class="{
                    'bg-red-500 hover:bg-red-600': point.status === 'failed' || point.status === 'timedOut',
                    'bg-green-500 hover:bg-green-600': point.status === 'passed',
                    'bg-yellow-500 hover:bg-yellow-600': point.status === 'skipped',
                    'bg-gray-400 hover:bg-gray-500': !['passed', 'failed', 'skipped', 'timedOut'].includes(
                      point.status,
                    ),
                  }"
                  class="size-3.5 rounded-sm inline-block transition-colors"
                  :title="`Run #${point.runId}: ${point.status}`"
                />
              </UTooltip>
              <span v-if="historyData.length === 0" class="text-sm text-gray-400">No history yet</span>
            </div>
          </ChartCard>
        </div>

        <div v-else-if="historyData && historyData.length <= 1" class="text-center py-6 text-gray-400">
          <UIcon name="i-lucide-trending-up" class="size-6 mx-auto mb-1" />
          <p class="text-sm">Need at least 2 runs to show trends.</p>
        </div>

        <!-- Recent executions -->
        <SectionCard
          icon="i-lucide-list-checks"
          :title="`Recent executions (${testCase?.recentExecutions?.length ?? 0})`"
        >
          <UTable
            v-if="testCase?.recentExecutions?.length"
            :data="testCase.recentExecutions"
            :columns="executionColumns"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default',
            }"
          >
            <template #startTime-cell="{ row }">
              <span class="text-xs whitespace-nowrap">
                <span class="text-gray-500">{{
                  new Date(row.original.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                }}</span>
                <span class="text-gray-400 ml-1">{{
                  new Date(row.original.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                }}</span>
              </span>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="getStatusColor(row.original.status)" variant="subtle" class="capitalize">{{
                row.original.status
              }}</UBadge>
            </template>
            <template #duration-cell="{ row }">
              <DurationValue v-if="row.original.duration !== null" :ms="row.original.duration" />
              <span v-else class="text-gray-400">&mdash;</span>
            </template>
            <template #retries-cell="{ row }">
              {{ row.original.retries && row.original.retries > 0 ? row.original.retries : '' }}
            </template>
            <template #runId-cell="{ row }">
              <NuxtLink :to="`/test-runs/${row.original.runId}`" class="text-primary hover:underline">
                {{
                  row.original.runLabel ? `${row.original.runLabel} (#${row.original.runId})` : `#${row.original.runId}`
                }}
              </NuxtLink>
            </template>
            <template #error-cell="{ row }">
              <span
                v-if="row.original.error"
                class="text-red-600 text-xs truncate max-w-xs block"
                :title="row.original.error"
              >
                {{ row.original.error.length > 80 ? `${row.original.error.substring(0, 80)}…` : row.original.error }}
              </span>
            </template>
            <template #actions-header>
              <div class="text-right">Actions</div>
            </template>
            <template #actions-cell="{ row }">
              <div class="flex justify-end">
                <UButton
                  :to="`/test-run-cases/${row.original.id}`"
                  size="sm"
                  variant="outline"
                  trailing-icon="i-lucide-arrow-right"
                >
                  View
                </UButton>
              </div>
            </template>
          </UTable>
          <EmptyState v-else icon="i-lucide-inbox" text="No executions yet" />
        </SectionCard>

        <!-- Failure clusters -->
        <SectionCard
          v-if="testCase?.failureClusters?.length"
          icon="i-lucide-bug"
          :title="`Failure clusters (${testCase.failureClusters.length})`"
          help="cluster.concept"
        >
          <div class="space-y-2">
            <div
              v-for="cluster in testCase.failureClusters"
              :key="cluster.id"
              class="flex items-center justify-between py-2 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <div class="flex items-center gap-2 min-w-0">
                <UBadge :color="clusterColor(cluster.status)" variant="soft" size="xs" class="capitalize">
                  {{ cluster.status }}
                </UBadge>
                <span class="text-sm truncate">{{ cluster.signature }}</span>
                <span v-if="cluster.occurrences > 1" class="text-xs text-gray-400 shrink-0">
                  {{ cluster.occurrences }} occurrences
                </span>
              </div>
              <UButton
                :to="`/failure-clusters/${cluster.id}`"
                size="xs"
                variant="outline"
                trailing-icon="i-lucide-arrow-right"
              >
                View
              </UButton>
            </div>
          </div>
        </SectionCard>

        <!-- Entity links -->
        <SectionCard v-if="testCase?.links?.length" icon="i-lucide-link" title="Links" help="shared.entity-links">
          <EntityLinks
            entity-type="test_case"
            :entity-id="Number(testCaseId)"
            :links="(testCase.links as any) ?? null"
          />
        </SectionCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
