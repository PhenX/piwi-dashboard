<script setup lang="ts">
import type { PerformanceStep, WebVitals, NetworkRequest, TestCaseHistoryPoint, TraceInfo } from '~~/types/api';
import type { TableColumn } from '@nuxt/ui';
import { getPerformanceHints } from '~/utils/performance-hints';
import { renderAnsi } from '~/utils';
import { buildRetryCommand } from '~/utils/retry-command';
import { condenseErrorText } from '#shared/error-fingerprint';
import { clusterSectionLocatorKey } from '~/composables/useClusterSectionLocator';

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

const hasError = computed(() => Boolean(testCase.value?.error));

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
    signature: string;
    errorType: string | null;
    status: string | null;
    triageNote: string | null;
    occurrences: number;
    sameRunCaseCount: number;
    isNew: boolean;
    firstSeenRunId: number;
    firstSeenAt: string | null;
    diagnosis: {
      status?: string | null;
      category?: string | null;
      confidence?: string | null;
      summary?: string | null;
    } | null;
  } | null;
});

const wastedTimeMs = computed(() => testCase.value?.wastedTimeMs ?? 0);

// ── Tabs ────────────────────────────────────────────────────────────────────
// The tab set depends on whether this execution has an error: a failing case
// leads with Diagnosis; a passing one with its Steps and Artifacts.
const tabItems = computed(() => {
  const items: { label: string; icon: string; value: string; slot: string }[] = [];
  if (hasError.value) {
    items.push({ label: 'Diagnosis', icon: 'i-lucide-stethoscope', value: 'diagnosis', slot: 'diagnosis' });
  }
  items.push({ label: `Steps (${steps.value.length})`, icon: 'i-lucide-list-checks', value: 'steps', slot: 'steps' });
  if (!hasError.value) {
    items.push({ label: 'Artifacts', icon: 'i-lucide-paperclip', value: 'artifacts', slot: 'artifacts' });
  }
  items.push({ label: 'Performance', icon: 'i-lucide-gauge', value: 'performance', slot: 'performance' });
  items.push({
    label: `History${historyData.value?.length ? ` (${historyData.value.length})` : ''}`,
    icon: 'i-lucide-trending-up',
    value: 'history',
    slot: 'history',
  });
  return items;
});

const tabValues = computed(() => tabItems.value.map((t) => t.value));

function defaultTab() {
  return hasError.value ? 'diagnosis' : 'steps';
}

/** Map a raw ?tab= value (incl. legacy aliases) to a currently-valid tab. */
function normalizeTab(raw: unknown): string {
  let t = typeof raw === 'string' ? raw : '';
  if (t === 'error') t = 'diagnosis'; // legacy: the old Failure tab
  if (t === 'traces') t = hasError.value ? 'diagnosis' : 'artifacts'; // legacy: old Traces & Console tab
  return tabValues.value.includes(t) ? t : defaultTab();
}

const activeTab = ref(normalizeTab(route.query.tab));

// A live run can make `error` appear (or disappear) mid-session, swapping the tab
// set out from under the user; re-normalize so the panel never goes blank.
watch(tabValues, (vals) => {
  if (!vals.includes(activeTab.value)) activeTab.value = normalizeTab(route.query.tab);
});

// Keep the active tab in the URL so a failure can be deep-linked and shared.
// `immediate` covers the initial resolved tab too — e.g. landing on a failing
// case with no `?tab=` already defaults in-memory to 'diagnosis', but without
// firing this on mount the URL bar would never reflect that default.
watch(
  activeTab,
  (tab) => {
    if (route.query.tab === tab) return;
    router.replace({ query: { ...route.query, tab } });
  },
  { immediate: true },
);

const historyColumns: TableColumn<TestCaseHistoryPoint>[] = [
  { accessorKey: 'startTime', header: 'Date' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'duration', header: 'Duration' },
  { accessorKey: 'retries', header: 'Retries' },
  { accessorKey: 'runId', header: 'Run' },
  { accessorKey: 'error', header: 'Error' },
];

const stepCategoryColor: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  navigation: 'info',
  assertion: 'success',
  action: 'warning',
};

const stepColumns: TableColumn<PerformanceStep>[] = [
  { id: 'status', header: '', size: 32 },
  { accessorKey: 'category', header: 'Category' },
  { accessorKey: 'title', header: 'Step' },
  { accessorKey: 'duration', header: 'Duration' },
];

const environment = computed(() => testCase.value?.testRun?.environment);

// ── Retry command ─────────────────────────────────────────────────────────
const retryCommand = computed(() =>
  buildRetryCommand([
    {
      filePath: testCase.value?.filePath ?? '',
      title: testCase.value?.title ?? '',
      line: testCase.value?.line ?? null,
      projectName: (testCase.value?.browser as { projectName?: string } | null)?.projectName ?? null,
    },
  ]),
);
const { copy: copyRetry, copied: retryCopied } = useCopy();

const navbarActions = computed(() => [
  {
    label: retryCopied.value ? 'Copied' : 'Retry command',
    icon: retryCopied.value ? 'i-lucide-check' : 'i-lucide-play',
    onClick: () => copyRetry(retryCommand.value, { toast: 'Retry command copied' }),
  },
  { label: 'Refresh', icon: 'i-lucide-refresh-cw', onClick: () => refresh() },
]);

// ── Live streaming ──────────────────────────────────────────────────────────
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

// ── Copy failure ──────────────────────────────────────────────────────────
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
  const testCaseUrl = `${origin}/test-run-cases/${testCaseId}?tab=diagnosis`;
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

// ── Diagnosis section locator ───────────────────────────────────────────────
// Lets an AI-diagnosis evidence citation (in TestCaseAiCard → DiagnosisResult)
// unfold and scroll to the matching evidence section on this page.
const errorEl = ref<HTMLElement | null>(null);
const consoleEl = ref<HTMLElement | null>(null);
const networkEl = ref<HTMLElement | null>(null);
const testSourceCard = ref<{ reveal: () => void } | null>(null);
const evidenceCard = ref<{ reveal: () => void } | null>(null);
const envDiffCard = ref<{ reveal: () => void } | null>(null);
const visualDiffCard = ref<{ reveal: () => void } | null>(null);
const domSnapshotCard = ref<{ reveal: () => void } | null>(null);
const ariaCard = ref<{ reveal: () => void } | null>(null);

function scrollToEl(el: HTMLElement | null) {
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const sectionToAction: Record<string, () => void> = {
  sampleError: () => scrollToEl(errorEl.value),
  executionError: () => scrollToEl(errorEl.value),
  testSource: () => testSourceCard.value?.reveal(),
  sourceFiles: () => testSourceCard.value?.reveal(),
  environmentDiff: () => envDiffCard.value?.reveal(),
  visualDiff: () => visualDiffCard.value?.reveal(),
  domSnapshot: () => domSnapshotCard.value?.reveal(),
  ariaSnapshot: () => ariaCard.value?.reveal(),
  screenshots: () => evidenceCard.value?.reveal(),
  tracePointers: () => evidenceCard.value?.reveal(),
  artifacts: () => evidenceCard.value?.reveal(),
  console: () => scrollToEl(consoleEl.value),
  networkRequests: () => scrollToEl(networkEl.value),
  steps: () => {
    activeTab.value = 'steps';
  },
  failingSteps: () => {
    activeTab.value = 'steps';
  },
};

provide(clusterSectionLocatorKey, {
  canLocate: (id: string) => id in sectionToAction,
  open: (id: string) => sectionToAction[id]?.(),
});
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
          <NavbarActions :actions="navbarActions" />
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

        <!-- ── Diagnosis (failing cases) ────────────────────────────────── -->
        <template #tab-diagnosis>
          <div class="space-y-4">
            <!-- The error itself, first — it's what you open this tab for -->
            <div ref="errorEl" class="scroll-mt-4">
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
            </div>

            <!-- Two columns: evidence funnel (left) + verdict/cluster/AI rail (right) -->
            <div class="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4">
              <!-- Right rail (DOM-first so it follows the error on mobile) -->
              <div class="space-y-4 xl:order-2">
                <TestCaseVerdictCard
                  :test-case="(testCase as any) ?? null"
                  :history="historyData"
                  :current-id="Number(testCaseId)"
                />

                <FailureClusterCard v-if="failureCluster" :cluster="failureCluster" />

                <TestCaseAiCard :test-runs-case-id="Number(testCaseId)" />
              </div>

              <!-- Left column: evidence funnel -->
              <div class="space-y-4 xl:order-1 min-w-0">
                <!-- Test source: the failing line and the callers above it -->
                <CollapsibleSectionCard
                  v-if="testCase?.testSourceFrames?.length || testCase?.testSource"
                  ref="testSourceCard"
                  storage-key="case-test-source"
                  icon="i-lucide-code"
                  :count="testCase?.testSourceFrames?.length || null"
                  title="Test source"
                  help="case.test-source"
                >
                  <template #folded>
                    <template v-if="(testCase?.testSourceFrames?.length ?? 0) > 1">
                      The failing line and {{ (testCase?.testSourceFrames?.length ?? 0) - 1 }} caller{{
                        (testCase?.testSourceFrames?.length ?? 0) - 1 === 1 ? '' : 's'
                      }}
                    </template>
                    <template v-else>Source around the failing assertion</template>
                  </template>
                  <div class="max-h-[32rem] overflow-y-auto">
                    <TestSourceStack v-if="testCase?.testSourceFrames?.length" :frames="testCase.testSourceFrames" />
                    <MarkdownPreview v-else-if="testCase?.testSource" :text="'```typescript\n' + testCase.testSource + '\n```'" />
                  </div>
                </CollapsibleSectionCard>

                <!-- Screenshots, video, traces, non-media attachments -->
                <TestCaseEvidenceCard
                  ref="evidenceCard"
                  storage-key="case-evidence"
                  :attachments="(testCase as any)?.attachments ?? []"
                  :traces="(traceData as any[]) ?? []"
                />

                <!-- Alternative locators for a broken locator -->
                <LocatorHealingPanel
                  v-if="testCase?.testRun?.id"
                  storage-key="case-locators"
                  :run-id="testCase.testRun.id"
                  :test-runs-case-id="Number(testCaseId)"
                />

                <!-- What changed in the environment since the last pass -->
                <EnvironmentDiffCard
                  v-if="testCase?.testRun?.id"
                  ref="envDiffCard"
                  storage-key="case-env-diff"
                  :run-id="testCase.testRun.id"
                  :test-runs-case-id="Number(testCaseId)"
                />

                <!-- What changed visually since the last pass -->
                <VisualDiffCard
                  v-if="testCase?.testRun?.id"
                  ref="visualDiffCard"
                  storage-key="case-visual-diff"
                  :run-id="testCase.testRun.id"
                  :test-runs-case-id="Number(testCaseId)"
                />

                <!-- Console output -->
                <div v-if="(testCase as any)?.consoleLogs?.length" ref="consoleEl" class="scroll-mt-4">
                  <TestCaseConsoleCard :entries="(testCase as any)?.consoleLogs ?? []" />
                </div>

                <!-- Network requests + backend logs -->
                <div v-if="networkRequests.length > 0" ref="networkEl" class="scroll-mt-4">
                  <TestCaseNetworkRequests :requests="networkRequests" />
                </div>

                <!-- App state at test end -->
                <PageStateCard
                  v-if="(testCase as any)?.pageState"
                  storage-key="case-page-state"
                  :page-state="(testCase as any).pageState"
                />

                <!-- ARIA snapshot captured at failure time -->
                <CollapsibleSectionCard
                  v-if="testCase?.ariaSnapshot"
                  ref="ariaCard"
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

                <!-- Failure-time HTML extracted from the uploaded trace -->
                <DomSnapshotCard
                  v-if="testCase?.testRun?.id"
                  ref="domSnapshotCard"
                  storage-key="case-dom-snapshot"
                  :run-id="testCase.testRun.id"
                  :test-runs-case-id="Number(testCaseId)"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- ── Steps ────────────────────────────────────────────────────── -->
        <template #tab-steps>
          <div class="space-y-3">
            <div v-if="wastedTimeMs > 0" class="flex items-center gap-1.5">
              <UBadge color="warning" variant="subtle" size="sm" class="inline-flex items-center gap-1">
                <UIcon name="i-lucide-hourglass" class="size-3 shrink-0" />
                {{ formatDuration(wastedTimeMs) }} wasted in fixed waits
              </UBadge>
              <HelpHint topic="case.wasted-time" />
            </div>

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
                    td: 'border-b border-default align-top',
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
                  <template #title-cell="{ row }">
                    <div :class="row.original.failed ? 'text-red-600 dark:text-red-400 font-medium' : ''">
                      {{ row.original.title }}
                    </div>
                    <p
                      v-if="row.original.failed && row.original.error?.message"
                      class="text-xs text-red-500 mt-1 whitespace-pre-wrap break-words font-mono"
                    >
                      {{ row.original.error.message }}
                    </p>
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
            <EmptyState v-else icon="i-lucide-list-checks" text="No steps recorded for this execution" />
          </div>
        </template>

        <!-- ── Artifacts (passing cases) ────────────────────────────────── -->
        <template #tab-artifacts>
          <div class="space-y-4 pt-4">
            <TestCaseTracesCard :traces="(traceData as any[]) || []" />
            <TestCaseAttachmentsCard :attachments="(testCase as any)?.attachments ?? []" />
            <PageStateCard
              v-if="(testCase as any)?.pageState"
              storage-key="case-page-state"
              :page-state="(testCase as any).pageState"
            />
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

        <!-- ── Performance ──────────────────────────────────────────────── -->
        <template #tab-performance>
          <div class="space-y-4 pt-1">
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

                <!-- Core Web Vitals — Google rating bands; missing values render "n/a"
                     without alarm colors (INP is often absent in short tests). -->
                <StatTileGrid v-if="webVitals.vitals" min-tile-width="10rem" class="pt-2 border-t">
                  <StatTile
                    label="Largest Contentful Paint (LCP)"
                    :value="webVitals.vitals.lcp != null ? formatDuration(webVitals.vitals.lcp) : 'n/a'"
                    :value-class="
                      webVitals.vitals.lcp == null
                        ? 'text-gray-400'
                        : webVitals.vitals.lcp > 4000
                          ? 'text-red-600'
                          : webVitals.vitals.lcp > 2500
                            ? 'text-orange-500'
                            : 'text-green-600'
                    "
                  />
                  <StatTile
                    label="Cumulative Layout Shift (CLS)"
                    :value="webVitals.vitals.cls != null ? String(webVitals.vitals.cls) : 'n/a'"
                    :value-class="
                      webVitals.vitals.cls == null
                        ? 'text-gray-400'
                        : webVitals.vitals.cls > 0.25
                          ? 'text-red-600'
                          : webVitals.vitals.cls > 0.1
                            ? 'text-orange-500'
                            : 'text-green-600'
                    "
                  />
                  <StatTile
                    label="Interaction to Next Paint (INP)"
                    :value="webVitals.vitals.inp != null ? formatDuration(webVitals.vitals.inp) : 'n/a'"
                    :value-class="
                      webVitals.vitals.inp == null
                        ? 'text-gray-400'
                        : webVitals.vitals.inp > 500
                          ? 'text-red-600'
                          : webVitals.vitals.inp > 200
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

            <EmptyState
              v-if="performanceHints.length === 0 && !webVitals"
              icon="i-lucide-gauge"
              text="No performance hints or Web Vitals were captured for this execution."
            >
              <p class="text-xs text-gray-400">
                Web Vitals and timing come from the <DocLink to="capture-fixtures">capture fixtures</DocLink>.
              </p>
            </EmptyState>
          </div>
        </template>

        <!-- ── History ──────────────────────────────────────────────────── -->
        <template #tab-history>
          <div class="space-y-4 pt-4">
            <div v-if="historyData && historyData.length > 0" class="space-y-4">
              <div class="flex items-center justify-end">
                <UButton
                  v-if="testCase?.testCaseId"
                  :to="`/test-cases/${testCase.testCaseId}`"
                  size="xs"
                  variant="outline"
                  color="neutral"
                  trailing-icon="i-lucide-arrow-right"
                >
                  View full test history
                </UButton>
              </div>
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
                        row.original.error.length > 80 ? `${row.original.error.substring(0, 80)}…` : row.original.error
                      }}
                    </span>
                  </template>
                </UTable>
              </TableScroller>
            </div>
            <EmptyState v-else icon="i-lucide-trending-up" text="No prior executions of this test yet.">
              <p class="text-xs text-gray-400">
                This is the first recorded run. Once it runs again, its status and duration trend appear here.
              </p>
            </EmptyState>
          </div>
        </template>
      </DetailPageLayout>
    </template>
  </UDashboardPanel>
</template>
