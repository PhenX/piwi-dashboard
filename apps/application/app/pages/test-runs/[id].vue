<script setup lang="ts">
import { computed, nextTick, watch, onUnmounted } from 'vue';
import type { TestRunDetails, TestCaseResult, ReportInfo, TestStepEvent, FailureGroup } from '~~/types/api';
import type { LiveStepsByWorker } from '~/utils/live-steps';
import { subscribeDemoEvents } from '~/demo/run-events';
import { useRunStream } from '~/composables/useRunStream';

const route = useRoute();
const router = useRouter();
const runId = route.params.id;
const isDemoMode = Boolean(useRuntimeConfig().public.demoMode);

const { data: testRun, refresh } = await useFetch<TestRunDetails>(`/api/test-runs/${runId}`);

// Lightweight poll for latest run info — avoids reloading full page data on run events
const projectId = testRun.value?.projectId;
type LatestRunInfo = { id: number; status: string } | null;
const { data: latestRunInfo, refresh: refreshLatestRun } = projectId
  ? await useFetch<LatestRunInfo>(`/api/projects/${projectId}/latest-run`, { key: `latest-run-${projectId}` })
  : { data: ref<LatestRunInfo>(null), refresh: async () => {} };
useRunStream(refreshLatestRun);

const latestRunId = computed(() => latestRunInfo.value?.id ?? testRun.value?.project?.latestRunId ?? null);
const latestRunStatus = computed(() => latestRunInfo.value?.status ?? testRun.value?.project?.latestRunStatus ?? null);
const isLatestRunActive = computed(() => latestRunStatus.value === 'running' || latestRunStatus.value === 'finalizing');

const navbarTitle = computed(() => {
  const project = testRun.value?.project?.label || testRun.value?.project?.name;
  return `Run #${runId}${project ? ` · ${project}` : ''}`;
});

useHead(
  computed(() => ({
    title: `Test run #${runId}${testRun.value?.project ? ` — ${testRun.value.project.name}` : ''} — Piwi Dashboard`,
  })),
);

const toast = useToast();
const isDeleteConfirmOpen = ref(false);
const deleting = ref(false);

// Live streaming state
const isLive = computed(() => testRun.value?.status === 'running' || testRun.value?.status === 'finalizing');
const isFinalizing = ref(false);
const liveTestCases = ref<TestCaseResult[]>([]);
const liveTestCaseKeys = new Map<string, true>();
const liveProgress = ref<{ totalTests: number; passedTests: number; failedTests: number; skippedTests: number } | null>(
  null,
);
// Worker index → the step the worker is currently on (from transient SSE step
// events; nothing is persisted from them). Rendered inline on the matching
// running rows in the test-case views.
const liveSteps = ref<LiveStepsByWorker>({});
let eventSource: EventSource | null = null;

// Combined test cases: from server data + live stream.
const displayTestCases = ref<TestCaseResult[]>([]);

watch(
  [isLive, testRun],
  () => {
    if (isLive.value && liveTestCases.value.length > 0) {
      displayTestCases.value = [...liveTestCases.value];
    } else if (testRun.value?.testCases) {
      displayTestCases.value = testRun.value.testCases;
    } else {
      displayTestCases.value = [];
    }
  },
  { immediate: true },
);

// Initialise liveTestCases from persisted data when SSE connects
function seedLiveFromPersisted(cases: TestCaseResult[]) {
  for (const tc of cases) {
    const key = `${tc.title}@@${tc.location}@@${JSON.stringify(tc.browser)}`;
    if (!liveTestCaseKeys.has(key)) {
      liveTestCaseKeys.set(key, true);
      liveTestCases.value = [...liveTestCases.value, tc];
    }
  }
  displayTestCases.value = [...liveTestCases.value];
}

// Debounced batch processing of SSE events to avoid cascading re-renders
let pendingEvents: Record<string, unknown>[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingEvents() {
  if (pendingEvents.length === 0) return;
  const events = pendingEvents;
  pendingEvents = [];
  for (const parsed of events) {
    const data = parsed.data as Record<string, unknown>;
    if (parsed.type === 'init') {
      liveProgress.value = {
        totalTests: data.totalTests as number,
        passedTests: data.passedTests as number,
        failedTests: data.failedTests as number,
        skippedTests: data.skippedTests as number,
      };
    } else if (parsed.type === 'test-begin') {
      const d = data as {
        title: string;
        filePath?: string;
        suitePath?: string[] | null;
        location: string;
        workerIndex?: number;
        startedAt?: number;
        browser?: { projectName?: string } | null;
        stepCategory?: string | null;
      };
      // Hook/fixture step-begin events are published as `test-begin` with a
      // `stepCategory`. They are not test cases — ignore them so they don't
      // create phantom rows (which left orphaned "running" dots on the
      // timeline). Hooks render from `stepEvents` once their test completes.
      if (d.stepCategory) continue;
      const key = `${d.title}@@${d.location}@@${JSON.stringify(d.browser)}`;
      if (!liveTestCaseKeys.has(key)) {
        liveTestCaseKeys.set(key, true);
        liveTestCases.value = [
          ...liveTestCases.value,
          {
            executionId: liveTestCases.value.length + 1,
            testCaseId: 0,
            title: d.title,
            filePath: d.filePath,
            suitePath: d.suitePath ?? undefined,
            status: 'running',
            location: d.location,
            workerIndex: d.workerIndex ?? null,
            startedAt: d.startedAt ?? Date.now(),
            browser: d.browser ?? null,
          },
        ];
        displayTestCases.value = [...liveTestCases.value];
      }
    } else if (parsed.type === 'test-completed') {
      const d = data as {
        title: string;
        filePath?: string;
        suitePath?: string[] | null;
        location: string;
        status: string;
        duration?: number;
        error?: string | null;
        stepEvents?: TestStepEvent[] | null;
        wastedTimeMs?: number | null;
        workerIndex?: number;
        startedAt?: number;
        browser?: { projectName?: string } | null;
        stepCategory?: string | null;
      };
      // Ignore hook/fixture step-end events (published as `test-completed`
      // with a `stepCategory`) — they are not test cases. The hook segments
      // arrive via the owning test's `stepEvents` below.
      if (d.stepCategory) continue;
      const key = `${d.title}@@${d.location}@@${JSON.stringify(d.browser)}`;
      if (liveTestCaseKeys.has(key)) {
        const idx = liveTestCases.value.findIndex(
          (tc) => `${tc.title}@@${tc.location}@@${JSON.stringify(tc.browser)}` === key,
        );
        if (idx >= 0) {
          const existing = liveTestCases.value[idx]!;
          const copy = [...liveTestCases.value];
          copy[idx] = {
            ...existing,
            filePath: d.filePath ?? existing.filePath,
            suitePath: d.suitePath ?? existing.suitePath,
            status: d.status,
            duration: d.duration,
            error: d.error,
            stepEvents: d.stepEvents ?? existing.stepEvents,
            wastedTimeMs: d.wastedTimeMs ?? existing.wastedTimeMs,
            workerIndex: d.workerIndex ?? existing.workerIndex,
            startedAt: d.startedAt ? d.startedAt : existing.startedAt,
            browser: d.browser ?? existing.browser,
          };
          liveTestCases.value = copy;
          displayTestCases.value = [...copy];
        }
      } else {
        liveTestCaseKeys.set(key, true);
        liveTestCases.value = [
          ...liveTestCases.value,
          {
            executionId: liveTestCases.value.length + 1,
            testCaseId: 0,
            title: d.title,
            filePath: d.filePath,
            suitePath: d.suitePath ?? undefined,
            status: d.status,
            duration: d.duration,
            location: d.location,
            error: d.error,
            stepEvents: d.stepEvents ?? null,
            wastedTimeMs: d.wastedTimeMs ?? null,
            workerIndex: d.workerIndex ?? null,
            startedAt: d.startedAt ?? undefined,
            browser: d.browser ?? null,
          },
        ];
        displayTestCases.value = [...liveTestCases.value];
      }
    } else if (parsed.type === 'step-begin') {
      const d = parsed.data as {
        title: string;
        stepCategory?: string | null;
        parentTitle?: string | null;
        workerIndex?: number;
      };
      // Suite-level hooks (no worker) keep flowing to the timeline instead.
      if (d.workerIndex == null) continue;
      liveSteps.value = {
        ...liveSteps.value,
        [d.workerIndex]: {
          title: d.title,
          category: d.stepCategory ?? null,
          status: undefined,
          parentTitle: d.parentTitle ?? null,
        },
      };
    } else if (parsed.type === 'step-end') {
      const d = parsed.data as {
        title: string;
        stepCategory?: string | null;
        parentTitle?: string | null;
        status?: string;
        workerIndex?: number;
      };
      if (d.workerIndex == null) continue;
      // Keep the ended step visible (with its outcome) until the next step
      // begins, so the readout shows "last thing this worker did".
      liveSteps.value = {
        ...liveSteps.value,
        [d.workerIndex]: {
          title: d.title,
          category: d.stepCategory ?? null,
          status: d.status ?? 'passed',
          parentTitle: d.parentTitle ?? null,
        },
      };
    } else if (parsed.type === 'run-progress') {
      liveProgress.value = data as {
        totalTests: number;
        passedTests: number;
        failedTests: number;
        skippedTests: number;
      };
    } else if (parsed.type === 'run-finalizing') {
      // Tests are done, reports/traces are uploading — show progress bar
      isFinalizing.value = true;
      liveProgress.value = data as {
        totalTests: number;
        passedTests: number;
        failedTests: number;
        skippedTests: number;
      };
    } else if (parsed.type === 'run-finished') {
      isFinalizing.value = false;
      liveSteps.value = {};
      disconnectStream();
      refresh();
      // Nudge child tabs (Failure groups, Slow endpoints, Regression context,
      // Insights) to refetch — they keep their own useFetch state and would
      // otherwise show stale/partial data from before the run finalized.
      runRefreshKey.value++;
      pollForReports();
    }
  }
}

function pollForReports(attempts = 0): void {
  // The reporter may upload HTML/Monocart reports and traces AFTER the run
  // finishes. Poll for a few iterations so they appear without a manual
  // refresh. We keep polling a fixed number of times regardless of whether
  // some files already arrived, because uploads land in several batches
  // (report directory, then per-case traces/attachments) — stopping at the
  // first file would miss the rest.
  if (isDemoMode) return; // demo mode has no file uploads
  if (attempts >= 5) return;
  setTimeout(
    async () => {
      await refresh();
      pollForReports(attempts + 1);
    },
    1500 * (attempts + 1),
  );
}

function enqueueEvent(event: Record<string, unknown>) {
  pendingEvents.push(event);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushPendingEvents, 200);
}

// Demo mode: live events arrive over a BroadcastChannel from the service
// worker instead of an SSE stream (see app/demo/run-events.ts).
let demoUnsubscribe: (() => void) | null = null;

function connectToDemoStream() {
  if (demoUnsubscribe) return;

  // Seed liveTestCases from persisted data so existing cases are visible
  // immediately with correct ids, browser, startedAt, etc.
  if (testRun.value?.testCases?.length) {
    seedLiveFromPersisted(testRun.value.testCases);
  }

  demoUnsubscribe = subscribeDemoEvents((message) => {
    if (message.scope === 'run' && message.runId === Number(runId)) {
      enqueueEvent(message.event as unknown as Record<string, unknown>);
    } else if (
      message.scope === 'global' &&
      message.event.runId === Number(runId) &&
      message.event.type === 'run-started'
    ) {
      // Run transitioned from 'initializing' to 'running' — refetch so
      // isLive flips and progress counters appear.
      refresh();
    }
  });
}

function connectToStream() {
  if (!import.meta.client) return;

  if (isDemoMode) {
    connectToDemoStream();
    return;
  }

  if (eventSource) return;
  if (!isLive.value) return;

  // Seed liveTestCases from persisted data so existing cases are visible
  // immediately with correct ids, browser, startedAt, etc.
  if (testRun.value?.testCases?.length) {
    seedLiveFromPersisted(testRun.value.testCases);
  }

  eventSource = new EventSource(`/api/test-runs/${runId}/stream`);

  eventSource.onmessage = (event) => {
    try {
      enqueueEvent(JSON.parse(event.data) as Record<string, unknown>);
    } catch {
      // Ignore parse errors
    }
  };

  eventSource.onerror = () => {
    // EventSource will auto-reconnect
  };
}

function disconnectStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (demoUnsubscribe) {
    demoUnsubscribe();
    demoUnsubscribe = null;
  }
}

// In demo mode also stream while 'initializing' so the page picks up the
// transition to 'running' pushed by the simulator.
const shouldStream = computed(() => isLive.value || (isDemoMode && testRun.value?.status === 'initializing'));

watch(
  shouldStream,
  (live) => {
    if (live) {
      connectToStream();
    } else {
      disconnectStream();
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  disconnectStream();
});

// Throttled version for child components that don't need frame-perfect reactivity
let rafId: number | null = null;
const throttledTestCases = ref<TestCaseResult[]>([]);

watch(
  displayTestCases,
  (val) => {
    if (!import.meta.client) {
      throttledTestCases.value = val;
      return;
    }
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      throttledTestCases.value = val;
      rafId = null;
    });
  },
  { immediate: true },
);

// Display progress: live or from loaded data
const displayProgress = computed(() => {
  if (isLive.value && liveProgress.value) {
    return liveProgress.value;
  }
  if (!testRun.value) return null;
  return {
    totalTests: testRun.value.totalTests,
    passedTests: testRun.value.passedTests,
    failedTests: testRun.value.failedTests,
    skippedTests: testRun.value.skippedTests,
  };
});

async function handleDeleteRun() {
  isDeleteConfirmOpen.value = false;
  deleting.value = true;
  try {
    await $fetch(`/api/test-runs/${runId}`, { method: 'DELETE' });
    toast.add({ title: 'Test run deleted', color: 'success' });
    await navigateTo(`/projects/${testRun.value?.project?.id}`);
  } catch (error: unknown) {
    const errorMessage =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({ title: 'Delete failed', description: errorMessage || 'An error occurred', color: 'error' });
  } finally {
    deleting.value = false;
  }
}

const showCustomData = ref(false);

// Test-cases filter state — lifted here so it survives tab switches
const testCaseSearch = ref('');
const testCaseActiveStatuses = ref<string[]>([]);
const testCaseBrowserFilter = ref('all');

// The summary tiles toggle into the same set the list chips use
function handleFilterStatus(status: string) {
  if (!status || status === 'all') {
    testCaseActiveStatuses.value = [];
    return;
  }
  testCaseActiveStatuses.value = testCaseActiveStatuses.value.includes(status)
    ? testCaseActiveStatuses.value.filter((s) => s !== status)
    : [...testCaseActiveStatuses.value, status];
}

// Reports from the files table
const allReports = computed<ReportInfo[]>(() => testRun.value?.reports || []);

// Total wasted time across all displayed test cases (live or persisted)
const totalWastedTime = computed(() => {
  const cases = displayTestCases.value;
  if (!cases) return 0;
  return cases.reduce((sum, tc) => sum + ((tc as any).wastedTimeMs ?? 0), 0);
});

// Right panel tabs
const activeTab = ref('test-cases');

const hasFailures = computed(() => (displayProgress.value?.failedTests ?? 0) > 0);

// Cluster filter state — set by FailureGroups, consumed by TestCasesList. The
// id doubles as the `?cluster=` deep-link so the mode survives refresh/sharing.
const selectedClusterFilter = ref<{ id: number; title: string | null } | null>(null);

// Cluster display names for the list's cluster badges and the filter chip,
// taken from the same failure-groups payload the Failure groups tab shows.
const clusterNames = ref<Record<number, string>>({});
if (hasFailures.value && import.meta.client) {
  $fetch<{ items: FailureGroup[] }>(`/api/test-runs/${runId}/failure-groups`)
    .then((r) => {
      clusterNames.value = Object.fromEntries(r.items.map((g) => [g.clusterId, g.title || `Cluster #${g.clusterId}`]));
    })
    .catch(() => {});
}

const clusterFilterName = computed(() => {
  const f = selectedClusterFilter.value;
  if (!f) return '';
  return f.title ?? clusterNames.value[f.id] ?? `Cluster #${f.id}`;
});

const clusterFilterCount = computed(() => {
  const f = selectedClusterFilter.value;
  if (!f) return 0;
  return displayTestCases.value.filter((tc) => tc.failureClusterId === f.id).length;
});

// Deep-link the cluster filter via ?cluster= (restored like ?tab= above).
const clusterQuery = typeof route.query.cluster === 'string' ? Number(route.query.cluster) : null;
if (clusterQuery && !Number.isNaN(clusterQuery)) {
  selectedClusterFilter.value = { id: clusterQuery, title: null };
  activeTab.value = 'test-cases';
}

// Increments when a live run finishes, so child tabs that keep their own
// fetch state can refetch instead of showing stale pre-finish data.
const runRefreshKey = ref(0);

// Endpoints count from SlowEndpoints
const endpointsCount = ref(0);

function clearClusterFilter() {
  selectedClusterFilter.value = null;
}

const failureGroupCount = computed(() => {
  if (!testRun.value?.testCases) return 0;
  const clusterIds = new Set<number>();
  for (const tc of testRun.value.testCases) {
    if (tc.failureClusterId != null) clusterIds.add(tc.failureClusterId);
  }
  return clusterIds.size;
});

const uniqueWorkerCount = computed(() => {
  const cases = isLive.value ? displayTestCases.value : testRun.value?.testCases;
  if (!cases || cases.length === 0) return 0;
  const workers = new Set<number>();
  for (const tc of cases) {
    if (tc.workerIndex != null && tc.workerIndex >= 0) workers.add(tc.workerIndex);
  }
  return workers.size;
});

const tabItems = computed(() => [
  {
    label: `Test cases (${displayTestCases.value.length})`,
    icon: 'i-lucide-beaker',
    value: 'test-cases',
    slot: 'test-cases',
  },
  {
    label: 'Insights',
    icon: 'i-lucide-sparkles',
    value: 'insights',
    slot: 'insights',
  },
  // Failure-only tabs stay visible but disabled on a green run: tabs that
  // appear and disappear shift every other tab's position between runs.
  {
    label: hasFailures.value ? `Failure groups (${failureGroupCount.value})` : 'Failure groups',
    icon: 'i-lucide-layers',
    value: 'failure-groups',
    slot: 'failure-groups',
    disabled: !hasFailures.value,
    disabledReason: 'No failing tests in this run to group',
  },
  {
    label: 'Regression',
    icon: 'i-lucide-git-pull-request-arrow',
    value: 'regression',
    slot: 'regression',
    disabled: !hasFailures.value,
    disabledReason: 'No failing tests in this run to compare against',
  },
  {
    label: `Timeline${uniqueWorkerCount.value > 0 ? ` (${uniqueWorkerCount.value})` : ''}`,
    icon: 'i-lucide-timeline',
    value: 'workers',
    slot: 'workers',
  },
  { label: 'Compare', icon: 'i-lucide-git-compare-arrows', value: 'compare', slot: 'compare' },
  {
    label: `Slow endpoints${endpointsCount.value > 0 ? ` (${endpointsCount.value})` : ''}`,
    icon: 'i-lucide-network',
    value: 'endpoints',
    slot: 'endpoints',
  },
]);

const tabPanelClass: Record<string, string> = {
  'test-cases': 'overflow-hidden flex flex-col',
  endpoints: 'overflow-hidden flex flex-col',
};

// Deep-link the active tab via ?tab= so run views can be shared and cross-page
// links (e.g. Run insights → this run's Performance) land on the right tab.
// Failure-only tabs (failure-groups/regression) are disabled on a green run,
// so validate against the currently *enabled* tabs.
const runTabValues = computed(() => tabItems.value.filter((t) => !t.disabled).map((t) => t.value));
if (typeof route.query.tab === 'string' && runTabValues.value.includes(route.query.tab)) {
  activeTab.value = route.query.tab;
}
watch(runTabValues, (vals) => {
  if (!vals.includes(activeTab.value)) activeTab.value = 'test-cases';
});
// One watcher owns the ?tab= and ?cluster= query params — two independent
// replaces would race and drop each other's param.
watch([activeTab, selectedClusterFilter], ([tab, f]) => {
  const query = { ...route.query };
  if (f) query.cluster = String(f.id);
  else delete query.cluster;
  query.tab = tab;
  if (JSON.stringify(query) === JSON.stringify({ ...route.query })) return;
  router.replace({ query });
});

// Ref for TestCasesList to call scrollToCase
const testCasesListRef: {
  value: { scrollToCase: (id: number) => void } | null;
} = ref(null);

function handleSelectTestCase(id: number) {
  activeTab.value = 'test-cases';
  nextTick(() => {
    testCasesListRef.value?.scrollToCase(id);
  });
}

function handleSelectCluster(clusterId: number) {
  selectedClusterFilter.value = { id: clusterId, title: null };
  activeTab.value = 'test-cases';
}
</script>

<template>
  <UDashboardPanel id="test-run-detail">
    <template #header>
      <UDashboardNavbar :title="navbarTitle">
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              ...(testRun?.project?.id
                ? [
                    {
                      label: testRun.project.label || testRun.project.name || 'Project',
                      to: `/projects/${testRun.project.id}`,
                      slot: 'project',
                    },
                  ]
                : [{ label: 'Project' }]),
              { label: `Run #${runId}` + (testRun?.label ? ` — ${testRun.label}` : '') },
            ]"
          >
            <template #project="{ item }">
              <NuxtLink
                :to="item?.to"
                class="text-sm font-medium text-[var(--ui-text-muted)] hover:text-[var(--ui-text)] transition-colors"
              >
                {{ item?.label }}
              </NuxtLink>
              <NuxtLink
                v-if="latestRunId && latestRunId !== Number(runId)"
                :to="`/test-runs/${latestRunId}`"
                :aria-label="
                  isLatestRunActive ? `Go to running run #${latestRunId}` : `Go to latest run #${latestRunId}`
                "
                class="shrink-0 inline-flex items-center gap-1 rounded-full bg-blue-500/10 hover:bg-blue-500/20 transition-colors ml-1 px-2 py-0.5 text-xs text-blue-500"
              >
                <UIcon name="i-lucide-circle-play" class="size-3.5" :class="{ 'animate-pulse': isLatestRunActive }" />
                {{ isLatestRunActive ? 'Running' : 'Newer run' }} → #{{ latestRunId }}
              </NuxtLink>
              <span
                v-else-if="latestRunId"
                class="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 ml-1 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400"
              >
                <UIcon name="i-lucide-check-circle-2" class="size-3.5" />
                Latest run
              </span>
            </template>
          </BreadcrumbNav>
        </template>
        <template #right>
          <div class="flex items-center shrink-0 min-w-0">
            <NavbarActions
              :actions="[
                { label: 'Refresh', icon: 'i-lucide-refresh-cw', onClick: () => refresh() },
                {
                  label: 'Delete',
                  icon: 'i-lucide-trash-2',
                  color: 'error',
                  variant: 'soft',
                  loading: deleting,
                  onClick: () => (isDeleteConfirmOpen = true),
                },
              ]"
            />
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <DetailPageLayout v-model="activeTab" :tab-items="tabItems" :tab-panel-class="tabPanelClass">
        <template #summary>
          <RunSummary
            v-if="testRun"
            :test-run="testRun"
            :display-progress="displayProgress"
            :all-reports="allReports"
            :show-custom-data="showCustomData"
            :finalizing="isFinalizing"
            :active-statuses="testCaseActiveStatuses"
            :total-wasted-time="totalWastedTime"
            @update:show-custom-data="showCustomData = $event"
            @toggle-status="handleFilterStatus"
            @label-updated="refresh"
          />
        </template>

        <template #tab-test-cases>
          <div v-if="selectedClusterFilter != null" class="flex items-center gap-2 mb-3 shrink-0">
            <UBadge color="info" variant="subtle" size="sm">
              Cluster: {{ clusterFilterName }} · {{ clusterFilterCount }}
              {{ clusterFilterCount === 1 ? 'test' : 'tests' }}
            </UBadge>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              label="Clear filter"
              @click="clearClusterFilter"
            />
          </div>
          <TestCasesList
            ref="testCasesListRef"
            v-model:search="testCaseSearch"
            v-model:active-statuses="testCaseActiveStatuses"
            v-model:browser-filter="testCaseBrowserFilter"
            :test-cases="displayTestCases"
            :suites="testRun?.suites ?? []"
            :is-live="isLive"
            :live-steps="liveSteps"
            :failure-cluster-filter="selectedClusterFilter?.id ?? null"
            :cluster-names="clusterNames"
            :project-key="testRun?.projectId"
            :project-name="testRun?.project?.name"
            class="flex-1 min-h-0"
          />
        </template>

        <template #tab-insights>
          <RunInsights
            :test-run-id="Number(runId)"
            :run-status="testRun?.status ?? ''"
            :refresh-key="runRefreshKey"
            class="flex-1 min-h-0 p-4"
          />
        </template>

        <template #tab-failure-groups>
          <FailureGroups :refresh-key="runRefreshKey" @select-cluster="handleSelectCluster" />
        </template>

        <template #tab-regression>
          <RegressionContext :refresh-key="runRefreshKey" />
        </template>

        <template #tab-workers>
          <WorkersTimeline
            :test-cases="throttledTestCases"
            :setup-steps="testRun?.setupSteps ?? null"
            :shard-total="testRun?.shardTotal ?? null"
            :live="isLive"
            :wasted-patterns="testRun?.wastedWaitPatterns ?? null"
            @select-test-case="handleSelectTestCase"
          />
        </template>

        <template #tab-compare>
          <RunCompare :test-run="testRun" />
        </template>

        <template #tab-endpoints>
          <SlowEndpoints
            :refresh-key="runRefreshKey"
            class="flex-1 min-h-0"
            @endpoints-count="endpointsCount = $event"
          />
        </template>
      </DetailPageLayout>
    </template>
  </UDashboardPanel>

  <!-- Delete Confirm Dialog -->
  <ClientOnly>
    <UModal :open="isDeleteConfirmOpen" title="Delete test run" @update:open="isDeleteConfirmOpen = $event">
      <template #body>
        <p>
          Are you sure you want to delete <strong>Test Run #{{ testRun?.id }}</strong
          >? This will also remove all associated test results, reports, and traces. This action cannot be undone.
        </p>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="isDeleteConfirmOpen = false" />
        <UButton color="error" label="Delete" icon="i-lucide-trash-2" :loading="deleting" @click="handleDeleteRun" />
      </template>
    </UModal>
  </ClientOnly>
</template>
