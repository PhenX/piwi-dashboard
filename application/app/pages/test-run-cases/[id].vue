<script setup lang="ts">
import type { PerformanceStep, WebVitals, NetworkRequest, TestCaseHistoryPoint, TraceInfo } from '~~/types/api';
import type { TableColumn } from '@nuxt/ui';
import { getPerformanceHints } from '~/utils/performance-hints';
import { renderAnsi } from '~/utils';
import { condenseErrorText } from '#shared/error-fingerprint';

const route = useRoute();
const router = useRouter();
const testCaseId = route.params.id;

const { data: testCase, refresh } = await useFetch(`/api/test-run-cases/${testCaseId}`);
const historyData = ref<TestCaseHistoryPoint[]>([]);

watch(
  () => testCase.value?.testCaseId,
  async (tcId) => {
    if (tcId) {
      try {
        historyData.value = await $fetch<TestCaseHistoryPoint[]>(`/api/test-cases/${tcId}/history`);
      } catch {
        historyData.value = [];
      }
    } else {
      historyData.value = [];
    }
  },
  { immediate: true },
);

const { data: traceData, refresh: refreshTraces } = await useFetch<TraceInfo[]>(
  `/api/test-run-cases/${testCaseId}/traces`,
);

useHead(
  computed(() => ({
    title: `${testCase.value?.title || `Test run case #${testCaseId}`} — Piwi Dashboard`,
  })),
);

const performanceHints = computed(() => {
  if (!testCase.value) return [];
  return getPerformanceHints(testCase.value);
});

const steps = computed(() => {
  if (!testCase.value?.steps) return [];
  return testCase.value.steps as PerformanceStep[];
});

const webVitals = computed<WebVitals | null>(() => {
  return (testCase.value?.webVitals as unknown as WebVitals | null) ?? null;
});

const networkRequests = computed<NetworkRequest[]>(() => {
  return (testCase.value?.networkRequests as unknown as NetworkRequest[] | null) ?? [];
});

const historicalTiming = computed(() => {
  if (!historyData.value || historyData.value.length < 2 || !testCase.value?.duration) return null;
  const previous = historyData.value.filter((h) => h.duration !== null && h.id !== testCase.value?.id);
  if (previous.length === 0) return null;
  const avg = previous.reduce((sum, h) => sum + (h.duration || 0), 0) / previous.length;
  const current = testCase.value.duration;
  const diff = current - avg;
  const pct = avg > 0 ? Math.round((diff / avg) * 100) : 0;
  return { avg: Math.round(avg), current, diff: Math.round(diff), pct };
});

const metadata = computed(() => {
  return testCase.value?.testRun?.metadata as Record<string, unknown> | null | undefined;
});

const scmInfo = computed(() => {
  const m = metadata.value;
  if (!m?.scm) return null;
  return m.scm as { commit?: string; branch?: string; author?: string; commitMessage?: string };
});

const ciInfo = computed(() => {
  const m = metadata.value;
  if (!m?.ci) return null;
  return m.ci as { provider?: string; buildNumber?: string; buildUrl?: string; workflow?: string };
});

const failureCluster = computed(() => {
  return (testCase.value?.failureCluster ?? null) as {
    id: number;
    sameRunCaseCount: number;
    isNew: boolean;
    firstSeenRunId: number;
    firstSeenAt: string | null;
  } | null;
});

const VALID_TABS = ['steps', 'traces', 'error', 'performance', 'history'];
const activeTab = ref(
  typeof route.query.tab === 'string' && VALID_TABS.includes(route.query.tab) ? route.query.tab : 'steps',
);

// Default a failed case to the Failure tab (unless a tab was pinned in the URL),
// so the error is what you land on. Runs once when the case loads.
watch(
  () => testCase.value?.error,
  (err) => {
    if (err && typeof route.query.tab !== 'string' && activeTab.value === 'steps') {
      activeTab.value = 'error';
    }
  },
  { immediate: true },
);

// Keep the active tab in the URL so a failure can be deep-linked and shared.
watch(activeTab, (tab) => {
  if (route.query.tab === tab) return;
  router.replace({ query: { ...route.query, tab } });
});

const tabItems = computed(() => [
  { label: `Steps (${steps.value.length})`, icon: 'i-lucide-list-checks', value: 'steps', slot: 'steps' },
  { label: 'Traces & Console', icon: 'i-lucide-terminal', value: 'traces', slot: 'traces' },
  { label: 'Failure', icon: 'i-lucide-circle-x', value: 'error', slot: 'error', disabled: !testCase.value?.error },
  {
    label: `Performance (${performanceHints.value.length})`,
    icon: 'i-lucide-gauge',
    value: 'performance',
    slot: 'performance',
    disabled: performanceHints.value.length === 0,
  },
  {
    label: `History (${historyData.value?.length ?? 0})`,
    icon: 'i-lucide-trending-up',
    value: 'history',
    slot: 'history',
    disabled: !historyData.value?.length,
  },
]);

const historyColumns: TableColumn<TestCaseHistoryPoint>[] = [
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
];

const stepCategoryColor: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  navigation: 'info',
  assertion: 'success',
  action: 'warning',
};

const stepColumns: TableColumn<PerformanceStep>[] = [
  {
    id: 'status',
    header: '',
    size: 32,
  },
  {
    accessorKey: 'category',
    header: 'Category',
  },
  {
    accessorKey: 'title',
    header: 'Step',
  },
  {
    accessorKey: 'duration',
    header: 'Duration',
  },
];

const environment = computed(() => testCase.value?.testRun?.environment);

const isDemoMode = Boolean(useRuntimeConfig().public.demoMode);
let eventSource: EventSource | null = null;

const runIsActive = computed(() => {
  const status = testCase.value?.testRun?.status;
  return status === 'running' || status === 'finalizing';
});

function connectToRunStream() {
  if (!import.meta.client || isDemoMode || eventSource) return;
  const runId = testCase.value?.testRun?.id;
  if (!runId) return;

  eventSource = new EventSource(`/api/test-runs/${runId}/stream`);
  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'case-files' && parsed.data?.testRunsCaseId === Number(testCaseId)) {
        refresh();
        refreshTraces();
      } else if (parsed.type === 'run-finished') {
        refresh();
        refreshTraces();
        disconnectRunStream();
      }
    } catch {
      // Ignore non-JSON messages (e.g. heartbeat comments)
    }
  };
  eventSource.onerror = () => {
    // EventSource will auto-reconnect
  };
}

function disconnectRunStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

watch(
  runIsActive,
  (active) => {
    if (active) connectToRunStream();
    else disconnectRunStream();
  },
  { immediate: true },
);

onUnmounted(disconnectRunStream);

const { copyRich, copied: failureCopied } = useCopyRich();

function copyFailure() {
  const tc = testCase.value;
  if (!tc?.error) return;
  const origin = window.location.origin;
  const title = tc.title ?? 'Unknown test';
  const loc = tc.location ?? '';
  // eslint-disable-next-line no-control-regex
  const rawError = tc.error.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const clusterUrl = failureCluster.value ? `${origin}/failure-clusters/${failureCluster.value.id}` : null;
  const testCaseUrl = `${origin}/test-run-cases/${testCaseId}`;
  const stableUrl = testCase.value?.testCaseId ? `${origin}/test-cases/${testCase.value.testCaseId}` : null;

  const plain = [
    `❌ Test failed: ${title}`,
    loc ? `Location: ${loc}` : null,
    '',
    'Error:',
    rawError,
    '',
    clusterUrl ? `Failure cluster: ${clusterUrl}` : null,
    `Execution: ${testCaseUrl}`,
    stableUrl ? `History: ${stableUrl}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const html = [
    `<p><strong>❌ Test failed: ${esc(title)}</strong>${loc ? `<br><code>${esc(loc)}</code>` : ''}</p>`,
    `<p><strong>Error:</strong></p><pre>${renderAnsi(tc.error)}</pre>`,
    `<p>🔗 ${clusterUrl ? `<a href="${clusterUrl}">View failure cluster</a> · ` : ''}<a href="${testCaseUrl}">Execution details</a>${stableUrl ? ` · <a href="${stableUrl}">Test history</a>` : ''}</p>`,
  ].join('');

  copyRich(plain, html, { toast: 'Failure copied' });
}
</script>

<template>
  <UDashboardPanel id="test-run-case-detail">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              ...(testCase?.testRun?.project?.id
                ? [
                    {
                      label: testCase.testRun.project.name || 'Project',
                      to: `/projects/${testCase.testRun.project.id}`,
                    },
                  ]
                : [{ label: 'Project' }]),
              ...(testCase?.testRun?.id
                ? [
                    {
                      label:
                        `Run #${testCase.testRun.id}` + (testCase.testRun.label ? ` — ${testCase.testRun.label}` : ''),
                      to: `/test-runs/${testCase.testRun.id}`,
                    },
                  ]
                : [{ label: 'Test run' }]),
              { label: testCase?.title || `Test run case #${testCaseId}` },
            ]"
          />
        </template>
        <template #right>
          <NuxtLink
            v-if="testCase?.testCaseId"
            :to="`/test-cases/${testCase.testCaseId}`"
            class="text-xs text-gray-500 hover:text-primary mr-2 flex items-center gap-1"
            title="View test case evolution and history"
          >
            <UIcon name="i-lucide-trending-up" class="size-3.5" />
            <span class="hidden sm:inline">Evolution</span>
          </NuxtLink>
          <NavbarActions :actions="[{ label: 'Refresh', icon: 'i-lucide-refresh-cw', onClick: () => refresh() }]" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <DetailPageLayout v-model="activeTab" :tab-items="tabItems">
        <template #summary>
          <TestCaseSummary
            :test-case="(testCase ?? null) as any"
            :scm-info="scmInfo"
            :ci-info="ciInfo"
            :browser="testCase?.browser ?? null"
            :environment="environment"
            :steps-count="steps.length"
            :historical-timing="historicalTiming"
            :traces="traceData ?? []"
            :attachments="(testCase as any)?.attachments ?? []"
            :stable-links="(testCase as any)?.stableLinks ?? null"
            @refresh="refresh()"
          />
        </template>

        <template #tab-error>
          <div class="space-y-4">
            <!-- The error itself, first — it's what you open this tab for -->
            <SectionCard v-if="testCase?.error" icon="i-lucide-circle-x" icon-class="text-red-500" title="Error">
              <template #actions>
                <UTooltip :text="failureCopied ? 'Copied!' : 'Copy failure'">
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :icon="failureCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                    @click="copyFailure"
                  />
                </UTooltip>
              </template>
              <div
                class="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto rounded bg-red-50 dark:bg-red-950/20 p-3"
                v-html="renderAnsi(condenseErrorText(testCase.error))"
              />
            </SectionCard>

            <!-- Cluster hand-off: the full investigation (incl. AI diagnosis) lives on the cluster page -->
            <FailureClusterBanner v-if="failureCluster" :cluster="failureCluster" />

            <!-- Alternative locators for a broken locator — folded to its recommended-fix peek -->
            <LocatorHealingPanel
              v-if="testCase?.error && testCase.testRun?.id"
              storage-key="case-locators"
              :run-id="testCase.testRun.id"
              :test-runs-case-id="Number(testCaseId)"
            />

            <!-- ARIA snapshot captured at failure time — folded by default -->
            <CollapsibleSectionCard
              v-if="testCase?.ariaSnapshot"
              storage-key="case-aria"
              icon="i-lucide-scan-text"
              title="ARIA snapshot"
              help="case.aria"
            >
              <template #folded>Accessibility tree captured at the moment of failure</template>
              <div class="max-h-96 overflow-y-auto">
                <MarkdownPreview :text="'```yaml\n' + testCase.ariaSnapshot + '\n```'" />
              </div>
            </CollapsibleSectionCard>

            <p v-else-if="testCase?.error" class="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
              ARIA snapshot not captured — make sure your test imports
              <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">test</code>
              from the piwi-dashboard fixtures.
            </p>
          </div>
        </template>

        <template #tab-steps>
          <div v-if="steps.length > 0">
            <TableScroller min-width="34rem" :bleed="false">
              <UTable
                :data="steps"
                :columns="stepColumns"
                :ui="{
                  base: 'table-fixed border-separate border-spacing-0 min-w-[34rem]',
                  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                  tbody: '[&>tr]:last:[&>td]:border-b-0',
                  th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                  td: 'border-b border-default',
                }"
              >
                <template #status-cell="{ row }">
                  <span
                    v-if="row.original.failed"
                    class="inline-flex items-center justify-center size-5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs leading-none"
                    title="Step failed"
                    >✗</span
                  >
                </template>
                <template #category-cell="{ row }">
                  <UBadge :color="stepCategoryColor[row.original.category] || 'neutral'" variant="soft" size="xs">
                    {{ row.original.category }}
                  </UBadge>
                </template>
                <template #duration-cell="{ row }">
                  <span
                    :class="`text-sm tabular-nums ${
                      row.original.duration > 2000
                        ? 'text-red-600 font-medium'
                        : row.original.duration > 500
                          ? 'text-orange-500'
                          : 'text-gray-500'
                    }`"
                  >
                    {{ formatDuration(row.original.duration) }}
                  </span>
                </template>
              </UTable>
            </TableScroller>
          </div>
        </template>

        <template #tab-performance>
          <div v-if="performanceHints.length > 0" class="space-y-2">
            <div
              v-for="(hint, index) in performanceHints"
              :key="index"
              :class="[
                'p-3 rounded-lg border',
                hint.type === 'warning'
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                  : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
              ]"
            >
              <div class="flex items-start gap-2">
                <UIcon
                  :name="hint.type === 'warning' ? 'i-lucide-alert-triangle' : 'i-lucide-lightbulb'"
                  :class="hint.type === 'warning' ? 'text-amber-600' : 'text-blue-600'"
                  class="size-4 mt-0.5 shrink-0"
                />
                <div>
                  <p
                    :class="
                      hint.type === 'warning'
                        ? 'text-amber-800 dark:text-amber-200 font-medium'
                        : 'text-blue-800 dark:text-blue-200 font-medium'
                    "
                  >
                    {{ hint.message }}
                  </p>
                  <p
                    :class="
                      hint.type === 'warning'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-blue-700 dark:text-blue-300'
                    "
                    class="mt-1"
                  >
                    {{ hint.details }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <SectionCard
            v-if="webVitals"
            icon="i-lucide-gauge"
            title="Browser performance (Web Vitals)"
            help="case.web-vitals"
          >
            <div class="space-y-4">
              <StatTileGrid v-if="webVitals.navigation" min-tile-width="10rem">
                <StatTile
                  label="TTFB"
                  :value="formatDuration(webVitals.navigation.ttfb)"
                  hint="Time to first byte"
                  :value-class="
                    webVitals.navigation.ttfb > 600
                      ? 'text-red-600'
                      : webVitals.navigation.ttfb > 200
                        ? 'text-orange-500'
                        : 'text-green-600'
                  "
                />
                <StatTile
                  label="DOM Interactive"
                  :value="formatDuration(webVitals.navigation.domInteractive)"
                  hint="DOM interactive"
                  :value-class="
                    webVitals.navigation.domInteractive > 3000
                      ? 'text-red-600'
                      : webVitals.navigation.domInteractive > 1500
                        ? 'text-orange-500'
                        : 'text-green-600'
                  "
                />
                <StatTile
                  label="DOMContentLoaded"
                  :value="formatDuration(webVitals.navigation.domContentLoaded)"
                  hint="DOMContentLoaded"
                  :value-class="
                    webVitals.navigation.domContentLoaded > 3000
                      ? 'text-red-600'
                      : webVitals.navigation.domContentLoaded > 1500
                        ? 'text-orange-500'
                        : 'text-green-600'
                  "
                />
                <StatTile
                  label="Load Complete"
                  :value="formatDuration(webVitals.navigation.loadComplete)"
                  hint="Page fully loaded"
                  :value-class="
                    webVitals.navigation.loadComplete > 5000
                      ? 'text-red-600'
                      : webVitals.navigation.loadComplete > 3000
                        ? 'text-orange-500'
                        : 'text-green-600'
                  "
                />
              </StatTileGrid>

              <StatTileGrid
                v-if="webVitals.paint && (webVitals.paint.firstPaint || webVitals.paint.firstContentfulPaint)"
                min-tile-width="10rem"
                class="pt-2 border-t"
              >
                <StatTile
                  v-if="webVitals.paint.firstPaint !== undefined"
                  label="First Paint (FP)"
                  :value="formatDuration(webVitals.paint.firstPaint)"
                />
                <StatTile
                  v-if="webVitals.paint.firstContentfulPaint !== undefined"
                  label="First Contentful Paint (FCP)"
                  :value="formatDuration(webVitals.paint.firstContentfulPaint)"
                  :value-class="
                    webVitals.paint.firstContentfulPaint > 3000
                      ? 'text-red-600'
                      : webVitals.paint.firstContentfulPaint > 1800
                        ? 'text-orange-500'
                        : 'text-green-600'
                  "
                />
              </StatTileGrid>

              <div v-if="webVitals.navigation?.url" class="text-xs text-gray-400 pt-1">
                Page: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ webVitals.navigation.url }}</code>
              </div>
            </div>
          </SectionCard>
        </template>

        <template #tab-traces>
          <div class="space-y-4 pt-4">
            <TestCaseTracesCard :traces="(traceData as any[]) || []" />
            <TestCaseAttachmentsCard :attachments="(testCase as any)?.attachments ?? []" />
            <TestCaseConsoleCard
              v-if="(testCase as any)?.consoleLogs?.length"
              :entries="(testCase as any)?.consoleLogs ?? []"
            />
            <TestCaseNetworkRequests v-if="networkRequests.length > 0" :requests="networkRequests" />

            <div
              v-if="
                !(traceData as any[])?.length &&
                !(testCase as any)?.attachments?.length &&
                !(testCase as any)?.consoleLogs?.length &&
                !networkRequests.length
              "
              class="flex flex-col items-center justify-center py-12 text-gray-400"
            >
              <template v-if="runIsActive">
                <UIcon name="i-lucide-loader-circle" class="size-8 mb-2 animate-spin" />
                <p class="text-sm">
                  Run in progress — traces and attachments appear here as soon as they are uploaded.
                </p>
              </template>
              <template v-else>
                <UIcon name="i-lucide-inbox" class="size-8 mb-2" />
                <p class="text-sm">No traces, console logs, or network requests captured for this test case.</p>
              </template>
            </div>
          </div>
        </template>

        <template #tab-history>
          <div class="space-y-4 pt-4">
            <div v-if="historyData && historyData.length > 0">
              <div class="space-y-4">
                <TestCaseHistoryChart :data="historyData" :height="200" />
                <TableScroller min-width="44rem" :bleed="false">
                  <UTable
                    :data="historyData"
                    :columns="historyColumns"
                    :ui="{
                      base: 'table-fixed border-separate border-spacing-0 min-w-[44rem]',
                      thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                      tbody: '[&>tr]:last:[&>td]:border-b-0',
                      th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                      td: 'border-b border-default',
                    }"
                  >
                    <template #startTime-cell="{ row }">
                      <span class="text-xs whitespace-nowrap">
                        <span class="text-gray-500">{{
                          new Date(row.original.startTime).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        }}</span>
                        <span class="text-gray-400 ml-1">{{
                          new Date(row.original.startTime).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        }}</span>
                      </span>
                    </template>
                    <template #status-cell="{ row }">
                      <UBadge :color="getStatusColor(row.original.status)" class="capitalize">{{
                        row.original.status
                      }}</UBadge>
                    </template>
                    <template #duration-cell="{ row }">
                      <span v-if="row.original.duration !== null">{{ formatDuration(row.original.duration) }}</span>
                      <span v-else class="text-gray-400">&mdash;</span>
                    </template>
                    <template #runId-cell="{ row }">
                      <NuxtLink :to="`/test-runs/${row.original.runId}`" class="text-primary hover:underline">
                        #{{ row.original.runId }}
                      </NuxtLink>
                    </template>
                    <template #error-cell="{ row }">
                      <span
                        v-if="row.original.error"
                        class="text-red-600 text-xs truncate max-w-xs block"
                        :title="row.original.error"
                      >
                        {{
                          row.original.error.length > 80
                            ? `${row.original.error.substring(0, 80)}…`
                            : row.original.error
                        }}
                      </span>
                    </template>
                  </UTable>
                </TableScroller>
              </div>
            </div>
          </div>
        </template>
      </DetailPageLayout>
    </template>
  </UDashboardPanel>
</template>
