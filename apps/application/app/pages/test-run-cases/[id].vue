<script setup lang="ts">
import type {
  AiStepIntent,
  PerformanceStep,
  WebVitals,
  NetworkRequest,
  TestCaseHistoryPoint,
  TraceInfo,
} from '~~/types/api';
import type { TableColumn } from '@nuxt/ui';
import { CASE_STATUS_SERIES, legendOf } from '~/utils/chart';
import { getPerformanceHints } from '~/utils/performance-hints';
import { renderAnsi } from '~/utils';
import type { NavbarAction } from '~/components/shared/NavbarActions.vue';
import type { HelpTopicKey } from '~/utils/help-content';
import { condenseErrorText } from '#shared/error-fingerprint';
import { resolveEvidenceState, type EvidenceCardId, type EvidenceState } from '#shared/evidence-state';
import type { FailureVerdict } from '#shared/failure-verdict';
import type { FailureCluesResult } from '#shared/handlers/test-cases';
import { clusterSectionLocatorKey } from '~/composables/useClusterSectionLocator';

const route = useRoute();
const router = useRouter();
const testCaseId = route.params.id;

const { data: testCase, refresh } = await useFetch(`/api/test-run-cases/${testCaseId}`);
// The rows ride in the SSR payload, so the server and the client agree on the
// History tab's count and its table at hydration.
const { data: historyData } = await useAsyncData(
  `test-run-case-history-${testCaseId}`,
  () => {
    const tcId = testCase.value?.testCaseId;
    return tcId
      ? $fetch<{ items: TestCaseHistoryPoint[] }>(`/api/test-cases/${tcId}/history`).then((r) => r.items)
      : Promise.resolve([]);
  },
  { default: (): TestCaseHistoryPoint[] => [], watch: [() => testCase.value?.testCaseId] },
);

// The deterministic clues for this execution: fed to the headline (top clue as
// one line) and the CluesCard, and shared with the AI diagnosis as evidence.
const { data: cluesData } = await useFetch<FailureCluesResult>(`/api/test-run-cases/${testCaseId}/clues`, {
  default: (): FailureCluesResult => ({ clues: [], failureAt: null }),
});
const clues = computed(() => cluesData.value?.clues ?? []);
const cluesFailureAt = computed(() => cluesData.value?.failureAt ?? null);
const topClue = computed(() => clues.value[0] ?? null);

const { data: traceData, refresh: refreshTraces } = await useFetch(`/api/test-run-cases/${testCaseId}/traces`, {
  // The endpoint returns `{ items: [...] }` — without the unwrap, `hasTrace`
  // and every trace-gated view stay false and the Artifacts tab never shows
  // the Traces card.
  transform: (r: { items: TraceInfo[] }) => r.items,
});

/** Whether a trace file exists for this execution — unlocks the "go deeper" evidence views. */
const hasTrace = computed(() => (traceData.value?.length ?? 0) > 0);

// "Execution" is the word `docs/concepts.md` defines for one attempt of one test
// on one browser — the distinction the whole object model rests on. The UI used
// to say "Test run case", which is the join-table's name, not a concept anyone
// was taught. Say the documented word.
useHead(
  computed(() => ({
    title: testCase.value?.title
      ? `${testCase.value.title} — execution — Piwi Dashboard`
      : `Execution #${testCaseId} — Piwi Dashboard`,
  })),
);

// Tab membership branches on *status*, not the error string: a flaky
// passed-on-retry execution still failed at attempt 1 and must offer the
// Diagnosis tab; a passing one keeps a stable strip.
const hasFailedAttempt = computed(() => {
  const tc = testCase.value;
  if (!tc) return false;
  const statuses = [tc.status, ...(tc.attempts ?? []).map((a: { status: string }) => a.status)];
  return statuses.some((s) => isFailedStatus(s));
});

// Declared before the tab set: `normalizeTab` evaluates `tabItems` during
// setup, so every computed it touches must already be initialized.
const runIsActive = computed(() => {
  const status = testCase.value?.testRun?.status;
  return status === 'running' || status === 'finalizing';
});

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

/** AI-step intent mappings from the execution's usage manifest (when the test replays AI steps). */
const aiIntents = computed<AiStepIntent[] | null>(() => {
  const usage = testCase.value?.aiUsage as unknown as { intents?: AiStepIntent[] } | null;
  return usage?.intents ?? null;
});

const networkRequests = computed<NetworkRequest[]>(() => {
  return (testCase.value?.networkRequests as unknown as NetworkRequest[] | null) ?? [];
});

/** Which evidence kinds were recovered from the trace (the fixtures were absent). */
const evidenceSources = computed(
  () => (testCase.value?.evidenceSources as { console?: 'trace'; network?: 'trace'; aria?: 'trace' } | null) ?? null,
);

/** Any network request carrying Piwi backend logs or spans. */
const hasBackendLogs = computed(() =>
  networkRequests.value.some(
    (r) =>
      (Array.isArray(r.serverLogs) && r.serverLogs.length > 0) ||
      (Array.isArray(r.serverTraces) && r.serverTraces.length > 0),
  ),
);

/**
 * Whether Piwi's capture fixtures ran for this execution: any fixture-produced
 * field is present that was not itself recovered from the trace. A spec that
 * still imports `test` from `@playwright/test` has none, so its empty cards read
 * "not captured" while a fixture-using neighbor's read "nothing happened".
 */
const fixturesActive = computed(() => {
  const tc = testCase.value;
  if (!tc) return false;
  const src = evidenceSources.value ?? {};
  return (
    (Array.isArray((tc as any).consoleLogs) && (tc as any).consoleLogs.length > 0 && src.console !== 'trace') ||
    (networkRequests.value.length > 0 && src.network !== 'trace') ||
    (Boolean(tc.ariaSnapshot) && src.aria !== 'trace') ||
    Boolean((tc as any).pageState) ||
    Boolean(tc.webVitals) ||
    Boolean(tc.aiUsage)
  );
});

/** Resolved three-state (or present) status for every evidence card. */
const evidenceStates = computed<Record<EvidenceCardId, EvidenceState>>(() => {
  const tc = testCase.value;
  const src = evidenceSources.value ?? {};
  const active = fixturesActive.value;
  const mk = (hasData: boolean, traced?: boolean) => ({
    hasData,
    source: traced ? ('trace' as const) : ('fixture' as const),
    fixturesActive: active,
  });
  return {
    console: resolveEvidenceState('console', mk(Boolean((tc as any)?.consoleLogs?.length), src.console === 'trace')),
    network: resolveEvidenceState(
      'network',
      mk(networkRequests.value.length > 0 || hasTrace.value, src.network === 'trace'),
    ),
    appState: resolveEvidenceState('appState', mk(Boolean((tc as any)?.pageState))),
    ariaSnapshot: resolveEvidenceState('ariaSnapshot', mk(Boolean(tc?.ariaSnapshot), src.aria === 'trace')),
    backendLogs: resolveEvidenceState('backendLogs', mk(hasBackendLogs.value)),
    webVitals: resolveEvidenceState('webVitals', mk(Boolean(webVitals.value))),
  };
});

/** Whether a present card's data came from the trace — drives the "derived from the trace" chip. */
const evidenceDerived = computed(() => {
  const derived = (st: EvidenceState) => st.state === 'present' && st.derivedFromTrace;
  return {
    console: derived(evidenceStates.value.console),
    network: derived(evidenceStates.value.network),
    ariaSnapshot: derived(evidenceStates.value.ariaSnapshot),
  };
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

/** The one-line verdict on a failing execution, built server-side from the stored error and signals. */
const verdict = computed(() => (testCase.value as { verdict?: FailureVerdict | null } | null)?.verdict ?? null);

const failureCluster = computed(() => {
  return (testCase.value?.failureCluster ?? null) as {
    id: number;
    signature: string;
    title: string | null;
    selector: string | null;
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

// ── Tabs ────────────────────────────────────────────────────────────────────
// The tab set branches on status, not the error string: a failing execution
// (or one whose earlier attempt failed) leads with Diagnosis; Artifacts is
// always present in a fixed order so content never relocates between states.
// While a run streams, the Diagnosis slot is reserved (disabled) instead of
// appearing mid-view and reflowing the strip.
const tabItems = computed(() => {
  const items: {
    label: string;
    icon: string;
    value: string;
    slot: string;
    disabled?: boolean;
    disabledReason?: string;
    help?: HelpTopicKey;
  }[] = [];
  if (hasFailedAttempt.value) {
    items.push({
      label: 'Diagnosis',
      icon: 'i-lucide-stethoscope',
      value: 'diagnosis',
      slot: 'diagnosis',
      help: 'case.diagnosis-tab',
    });
  } else if (runIsActive.value) {
    items.push({
      label: 'Diagnosis',
      icon: 'i-lucide-stethoscope',
      value: 'diagnosis',
      slot: 'diagnosis',
      disabled: true,
      disabledReason: 'unavailable until a test fails',
    });
  }
  items.push({
    label: `Steps (${steps.value.length})`,
    icon: 'i-lucide-list-checks',
    value: 'steps',
    slot: 'steps',
    help: 'case.steps',
  });
  items.push({
    label: 'Artifacts',
    icon: 'i-lucide-paperclip',
    value: 'artifacts',
    slot: 'artifacts',
    help: 'case.artifacts',
  });
  items.push({ label: 'Performance', icon: 'i-lucide-gauge', value: 'performance', slot: 'performance' });
  items.push({
    label: `History${historyData.value?.length ? ` (${historyData.value.length})` : ''}`,
    icon: 'i-lucide-trending-up',
    value: 'history',
    slot: 'history',
  });
  return items;
});

// A disabled tab (e.g. the reserved Diagnosis slot on an active, not-yet-failed
// run) is not a navigable target, so a `?tab=` pointing at it must fall back to
// the default rather than render a panel whose control is disabled.
const tabValues = computed(() => tabItems.value.filter((t) => !t.disabled).map((t) => t.value));

function defaultTab() {
  return hasFailedAttempt.value ? 'diagnosis' : 'steps';
}

/** Map a raw ?tab= value (incl. legacy aliases) to a currently-valid tab. */
function normalizeTab(raw: unknown): string {
  let t = typeof raw === 'string' ? raw : '';
  if (t === 'error') t = 'diagnosis'; // legacy: the old Failure tab
  if (t === 'traces') t = 'artifacts'; // legacy: old Traces & Console tab
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
  input: 'warning',
  api: 'info',
  wait: 'neutral',
  hook: 'neutral',
  fixture: 'neutral',
};

// Widths are set via per-column `meta.class` (Nuxt UI applies these to th/td);
// with `table-fixed w-full` the width-less Step column absorbs the remaining space.
const stepColumns: TableColumn<PerformanceStep>[] = [
  { id: 'index', header: '#', meta: { class: { th: 'w-12', td: 'w-12' } } },
  { id: 'status', header: '', meta: { class: { th: 'w-10', td: 'w-10' } } },
  { accessorKey: 'category', header: 'Category', meta: { class: { th: 'w-28', td: 'w-28' } } },
  { accessorKey: 'title', header: 'Step' }, // no width → absorbs remaining width
  { accessorKey: 'duration', header: 'Duration', meta: { class: { th: 'w-44', td: 'w-44' } } },
];

// ── Steps tab derived data ───────────────────────────────────────────────────
// Per-category rollup for the summary strip above the table. Durations are summed
// over the flat step list (parents include their children), matching how the
// reporter's StepMetrics already reports navigation/wait totals.
const stepSummary = computed(() => {
  const byCat = new Map<string, { count: number; duration: number }>();
  for (const s of steps.value) {
    const entry = byCat.get(s.category) ?? { count: 0, duration: 0 };
    entry.count += 1;
    entry.duration += s.duration || 0;
    byCat.set(s.category, entry);
  }
  return Array.from(byCat, ([category, v]) => ({ category, ...v })).sort((a, b) => b.duration - a.duration);
});

// Row index of the single slowest step, used to tag that row. Mirrors the header's
// slowestStep (max flat-step duration) but resolved to a stable row. All-zero
// durations (a test that never ran) must not tag row 0 as "slowest".
const slowestStepIndex = computed(() => {
  let idx = -1;
  let max = -1;
  steps.value.forEach((s, i) => {
    if ((s.duration || 0) > max) {
      max = s.duration || 0;
      idx = i;
    }
  });
  return max > 0 ? idx : -1;
});

const maxStepDuration = computed(() => steps.value.reduce((m, s) => Math.max(m, s.duration || 0), 0));

// A true waterfall needs a startTime on every step (only runs from a recent
// reporter carry one); otherwise the bars fall back to left-aligned magnitude.
const hasStepTimings = computed(
  () => steps.value.length > 0 && steps.value.every((s) => typeof s.startTime === 'number'),
);
const timelineStart = computed(
  () =>
    testCase.value?.startedAt ??
    (hasStepTimings.value ? Math.min(...steps.value.map((s) => s.startTime as number)) : 0),
);
const timelineDuration = computed(() => {
  const total = testCase.value?.duration ?? 0;
  if (total > 0) return total;
  if (hasStepTimings.value) {
    const end = Math.max(...steps.value.map((s) => (s.startTime as number) + (s.duration || 0)));
    return Math.max(1, end - timelineStart.value);
  }
  return 0;
});

/** Bar geometry for a step: a real waterfall when timings exist, else magnitude. */
function stepBarStyle(step: PerformanceStep): Record<string, string> {
  if (hasStepTimings.value && timelineDuration.value > 0) {
    const left = Math.max(
      0,
      Math.min(100, (((step.startTime as number) - timelineStart.value) / timelineDuration.value) * 100),
    );
    const width = Math.min(100 - left, Math.max(1.5, ((step.duration || 0) / timelineDuration.value) * 100));
    return { left: `${left}%`, width: `${width}%` };
  }
  const width = maxStepDuration.value > 0 ? Math.max(2, ((step.duration || 0) / maxStepDuration.value) * 100) : 0;
  return { left: '0%', width: `${width}%` };
}

/** Step duration as a share of the whole test's wall-clock (e.g. "12%"). */
function stepPctOfTest(duration: number): string {
  const total = testCase.value?.duration ?? 0;
  if (total <= 0) return '';
  const pct = (duration / total) * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

/** Severity color for a duration value, shared by the number and its bar. */
function stepDurationTextClass(duration: number): string {
  return duration > 2000 ? 'text-red-600 font-medium' : duration > 500 ? 'text-orange-500' : 'text-gray-500';
}
function stepBarColorClass(duration: number): string {
  return duration > 2000 ? 'bg-red-500' : duration > 500 ? 'bg-orange-400' : 'bg-gray-400 dark:bg-gray-500';
}

const environment = computed(() => testCase.value?.testRun?.environment);

// ── Retry command ─────────────────────────────────────────────────────────
// The summary card owns the copy and run-locally controls (as the run page's
// summary does); the navbar keeps only the page-level actions.
const retryCases = computed(() => [
  {
    filePath: testCase.value?.filePath ?? '',
    title: testCase.value?.title ?? '',
    line: testCase.value?.line ?? null,
    projectName: (testCase.value?.browser as { projectName?: string } | null)?.projectName ?? null,
  },
]);

// ── Quarantine ──────────────────────────────────────────────────────────────
// A quarantined test keeps running and reporting; it is only dropped from the
// CI gate's verdict. The action lives here, on the failure, rather than only on
// the project's Quarantine tab. Reporter/admin only, matching the endpoint.
const { canWrite } = useAuth();
const { quarantineOne, releaseOne } = useQuarantine(() => testCase.value?.testRun?.project?.id ?? null);
const quarantined = computed(() => Boolean((testCase.value as { quarantined?: boolean } | null)?.quarantined));
const quarantineBusy = ref(false);

async function toggleQuarantine() {
  const stableId = testCase.value?.testCaseId;
  if (!stableId || quarantineBusy.value) return;
  quarantineBusy.value = true;
  try {
    const ok = quarantined.value
      ? await releaseOne(stableId)
      : await quarantineOne(stableId, 'Quarantined from execution');
    if (ok) await refresh();
  } finally {
    quarantineBusy.value = false;
  }
}

const navbarActions = computed<NavbarAction[]>(() => {
  const actions: NavbarAction[] = [];
  if (canWrite.value && testCase.value?.testCaseId) {
    actions.push(
      quarantined.value
        ? {
            label: 'Release from quarantine',
            icon: 'i-lucide-shield-check',
            color: 'warning',
            loading: quarantineBusy.value,
            onClick: toggleQuarantine,
          }
        : {
            label: 'Quarantine this test',
            icon: 'i-lucide-shield-alert',
            color: 'warning',
            title: 'Exclude this test from the CI gate while it keeps running and reporting',
            loading: quarantineBusy.value,
            onClick: toggleQuarantine,
          },
    );
  }
  actions.push({ label: 'Refresh', icon: 'i-lucide-refresh-cw', onClick: () => refresh() });
  return actions;
});

// ── Live streaming ──────────────────────────────────────────────────────────
const isDemoMode = Boolean(useRuntimeConfig().public.demoMode);
let eventSource: EventSource | null = null;

function connectToRunStream() {
  if (!import.meta.client || isDemoMode || eventSource) return;
  const runId = testCase.value?.testRun?.id;
  if (!runId) return;

  eventSource = new EventSource(`/api/test-runs/${runId}/stream`);
  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'case-files' && parsed.data?.executionId === Number(testCaseId)) {
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
const testSourceCard = ref<{ reveal: () => void } | null>(null);
const consoleCard = ref<{ reveal: () => void } | null>(null);
const networkCard = ref<{ showTraceMode: () => void; reveal: () => void } | null>(null);
const evidenceCard = ref<{ reveal: () => void } | null>(null);
const envDiffCard = ref<{ reveal: () => void } | null>(null);
const visualDiffCard = ref<{ reveal: () => void } | null>(null);
const domSnapshotCard = ref<{ reveal: () => void } | null>(null);
const ariaCard = ref<{ reveal: () => void } | null>(null);
const pageStateCard = ref<{ reveal: () => void } | null>(null);
const locatorHealingCard = ref<{ reveal: () => void } | null>(null);

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
  console: () => consoleCard.value?.reveal(),
  networkRequests: () => networkCard.value?.reveal(),
  serverTraces: () => networkCard.value?.reveal(),
  serverLogs: () => networkCard.value?.reveal(),
  appState: () => pageStateCard.value?.reveal(),
  locatorHealing: () => locatorHealingCard.value?.reveal(),
  traceCallStack: () => testSourceCard.value?.reveal(),
  traceNetwork: () => {
    networkCard.value?.showTraceMode();
    networkCard.value?.reveal();
  },
  steps: () => {
    activeTab.value = 'steps';
  },
  failingSteps: () => {
    activeTab.value = 'steps';
  },
};

// The lazily fetched cards report whether they rendered anything (no baseline,
// no screenshot or no trace leaves them empty), so their chips follow the card.
const envDiffAvailable = ref(false);
const visualDiffAvailable = ref(false);
const domSnapshotAvailable = ref(false);

// The jump-chip row under the error — the same section map the AI citations
// use, so the funnel has a map even when no AI is configured. Each chip is
// gated by the same availability condition as the section it targets: a chip
// that scrolls to nothing reads as broken.
const sectionChips = computed(() =>
  [
    {
      id: 'testSource',
      label: 'Test source',
      available: Boolean(testCase.value?.testSourceFrames?.length || testCase.value?.testSource || hasTrace.value),
    },
    { id: 'environmentDiff', label: 'Environment diff', available: envDiffAvailable.value },
    { id: 'visualDiff', label: 'Visual diff', available: visualDiffAvailable.value },
    { id: 'domSnapshot', label: 'DOM snapshot', available: domSnapshotAvailable.value },
    { id: 'ariaSnapshot', label: 'ARIA snapshot', available: Boolean(testCase.value?.ariaSnapshot) },
    { id: 'screenshots', label: 'Screenshots', available: true },
    { id: 'console', label: 'Console', available: Boolean((testCase.value as any)?.consoleLogs?.length) },
    { id: 'networkRequests', label: 'Network', available: networkRequests.value.length > 0 || hasTrace.value },
    { id: 'steps', label: 'Steps', available: true },
  ].filter((c) => c.available),
);

provide(clusterSectionLocatorKey, {
  canLocate: (id: string) => id in sectionToAction,
  open: (id: string) => sectionToAction[id]?.(),
});
</script>

<template>
  <UDashboardPanel id="test-run-case-detail">
    <template #header>
      <!-- The breadcrumb's current crumb is the page title; a navbar title would repeat it. -->
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
                ? [{ label: `Run #${testCase.testRun.id}`, to: `/test-runs/${testCase.testRun.id}` }]
                : [{ label: 'Test run' }]),
              { label: testCase?.title || `Execution #${testCaseId}` },
            ]"
          />
        </template>
        <template #right>
          <div class="flex items-center gap-1 shrink-0 min-w-0">
            <NuxtLink
              v-if="testCase?.testCaseId"
              :to="`/test-cases/${testCase.testCaseId}`"
              class="text-xs text-gray-500 hover:text-primary mr-2 flex items-center gap-1 shrink-0"
              title="View test case history"
              aria-label="Test case history"
            >
              <UIcon name="i-lucide-trending-up" class="size-3.5" />
              <span class="hidden xl:inline">Test case</span>
            </NuxtLink>
            <ShareLinksModal
              v-if="testCase && !isDemoMode"
              :endpoint="`/api/test-run-cases/${testCase.id}/share-links`"
            />
            <ExportMenu
              v-if="testCase"
              :endpoint="`/api/test-run-cases/${testCase.id}/export`"
              :base-name="`piwi-execution-${testCase.id}`"
              class="mr-2"
            />
            <NavbarActions :actions="navbarActions" />
          </div>
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
            :stable-links="(testCase as any)?.stableLinks ?? null"
            :project-key="testCase?.testRun?.project?.id"
            :project-name="testCase?.testRun?.project?.name"
            :project-label="testCase?.testRun?.project?.label ?? testCase?.testRun?.project?.name"
            :retry-cases="retryCases"
            :quarantined="quarantined"
            @refresh="refresh()"
          />
          <!-- Why this execution never ran, and what blocked it — the whole story
               for a did-not-run case, so it stays pinned. The downstream tests a
               failure blocked are a consequence, not the summary, so they move
               into the Diagnosis tab below. -->
          <DidNotRunCard
            :status="testCase?.status"
            :reason="(testCase as any)?.didNotRunReason ?? null"
            :blocked-by-case="(testCase as any)?.blockedByCase ?? null"
            class="mt-4"
          />
        </template>

        <!-- ── Diagnosis (failing cases) ────────────────────────────────── -->
        <template #tab-diagnosis>
          <div class="space-y-4">
            <!-- What broke, in one line — the raw error follows verbatim -->
            <TestCaseHeadlineCard v-if="verdict" :verdict="verdict" :top-clue="topClue" />

            <!-- Deterministic, ranked clues correlated from the captured evidence -->
            <CluesCard :clues="clues" :failure-at="cluesFailureAt" />

            <div ref="errorEl" class="scroll-mt-4">
              <SectionCard v-if="testCase?.error" icon="i-lucide-circle-x" icon-class="text-red-500" title="Error">
                <template #actions>
                  <UTooltip :text="failureCopied ? 'Copied!' : 'Copy failure'">
                    <UButton
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      :icon="failureCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                      aria-label="Copy failure"
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

            <!-- One time axis: steps, console, network and backend logs correlated -->
            <FailureTimelineCard
              :test-runs-case-id="Number(testCaseId)"
              :has-trace="hasTrace"
              :project-key="testCase?.testRun?.project?.id"
              :project-name="testCase?.testRun?.project?.name"
            />

            <!-- Two columns: evidence funnel (left) + verdict/cluster/AI rail (right) -->
            <div class="flex flex-wrap gap-1.5">
              <UButton
                v-for="s in sectionChips"
                :key="s.id"
                size="xs"
                variant="soft"
                color="neutral"
                :label="s.label"
                @click="sectionToAction[s.id]?.()"
              />
            </div>
            <div class="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4">
              <!-- Right rail (DOM-first so it follows the error below the xl split) -->
              <div class="space-y-4 xl:order-2">
                <TestCaseVerdictCard
                  :test-case="(testCase as any) ?? null"
                  :history="historyData"
                  :current-id="Number(testCaseId)"
                />

                <FailureClusterCard v-if="failureCluster" :cluster="failureCluster" />

                <!-- The downstream tests this failure blocked from running -->
                <DidNotRunCard :blocked-tests="(testCase as any)?.blockedTests ?? null" />

                <TestCaseAiCard :test-runs-case-id="Number(testCaseId)" />
              </div>

              <!-- Left column: evidence funnel -->
              <div class="space-y-4 xl:order-1 min-w-0">
                <!-- Test source: the failing line and its callers; full trace call stack when available -->
                <TestSourceCard
                  v-if="testCase?.testSourceFrames?.length || testCase?.testSource || hasTrace"
                  ref="testSourceCard"
                  storage-key="case-test-source"
                  :default-folded="false"
                  :frames="testCase?.testSourceFrames ?? null"
                  :test-source="testCase?.testSource ?? null"
                  :run-id="testCase?.testRun?.id ?? null"
                  :test-runs-case-id="Number(testCaseId)"
                  :has-trace="hasTrace"
                  :project-key="testCase?.testRun?.project?.id"
                  :project-name="testCase?.testRun?.project?.name"
                />

                <!-- Screenshots, video, traces, non-media attachments -->
                <TestCaseEvidenceCard
                  ref="evidenceCard"
                  storage-key="case-evidence"
                  :default-folded="false"
                  :attachments="(testCase as any)?.attachments ?? []"
                  :traces="(traceData as any[]) ?? []"
                />

                <!-- Alternative locators for a broken locator -->
                <LocatorHealingPanel
                  v-if="testCase?.testRun?.id"
                  ref="locatorHealingCard"
                  storage-key="case-locators"
                  :run-id="testCase.testRun.id"
                  :test-runs-case-id="Number(testCaseId)"
                  :ai-intents="aiIntents"
                />

                <!-- What changed in the environment since the last pass -->
                <EnvironmentDiffCard
                  v-if="testCase?.testRun?.id"
                  ref="envDiffCard"
                  storage-key="case-env-diff"
                  :run-id="testCase.testRun.id"
                  :test-runs-case-id="Number(testCaseId)"
                  @available="envDiffAvailable = $event"
                />

                <!-- What changed visually since the last pass -->
                <VisualDiffCard
                  v-if="testCase?.testRun?.id"
                  ref="visualDiffCard"
                  storage-key="case-visual-diff"
                  :run-id="testCase.testRun.id"
                  :test-runs-case-id="Number(testCaseId)"
                  @available="visualDiffAvailable = $event"
                />

                <!-- Console output -->
                <TestCaseConsoleCard
                  v-if="(testCase as any)?.consoleLogs?.length"
                  ref="consoleCard"
                  storage-key="case-console"
                  :entries="(testCase as any)?.consoleLogs ?? []"
                  :derived-from-trace="evidenceDerived.console"
                />
                <EvidenceCardEmpty
                  v-else
                  storage-key="case-console"
                  icon="i-lucide-terminal"
                  title="Console"
                  help="case.console"
                  :state="evidenceStates.console"
                />

                <!-- Network requests + backend logs; full trace network when available -->
                <TestCaseNetworkRequests
                  v-if="networkRequests.length > 0 || hasTrace"
                  ref="networkCard"
                  storage-key="case-network"
                  :requests="networkRequests"
                  :run-id="testCase?.testRun?.id ?? null"
                  :test-runs-case-id="Number(testCaseId)"
                  :has-trace="hasTrace"
                  :derived-from-trace="evidenceDerived.network"
                />
                <EvidenceCardEmpty
                  v-else
                  storage-key="case-network"
                  icon="i-lucide-arrow-left-right"
                  title="Network"
                  help="case.network"
                  :state="evidenceStates.network"
                />

                <!-- App state at test end -->
                <PageStateCard
                  v-if="(testCase as any)?.pageState"
                  ref="pageStateCard"
                  storage-key="case-page-state"
                  :page-state="(testCase as any).pageState"
                />
                <EvidenceCardEmpty
                  v-else
                  storage-key="case-page-state"
                  icon="i-lucide-database"
                  title="App state at test end"
                  help="page-state"
                  :state="evidenceStates.appState"
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
                  <template v-if="evidenceDerived.ariaSnapshot" #actions><TraceDerivedChip /></template>
                  <template #folded>Accessibility tree captured at the moment of failure</template>
                  <div class="max-h-96 overflow-y-auto">
                    <MarkdownPreview :text="'```yaml\n' + testCase.ariaSnapshot + '\n```'" />
                  </div>
                </CollapsibleSectionCard>
                <EvidenceCardEmpty
                  v-else
                  storage-key="case-aria"
                  icon="i-lucide-scan-text"
                  title="ARIA snapshot"
                  help="case.aria"
                  :state="evidenceStates.ariaSnapshot"
                />

                <!-- Failure-time HTML extracted from the uploaded trace -->
                <DomSnapshotCard
                  v-if="testCase?.testRun?.id"
                  ref="domSnapshotCard"
                  storage-key="case-dom-snapshot"
                  :run-id="testCase.testRun.id"
                  :test-runs-case-id="Number(testCaseId)"
                  @available="domSnapshotAvailable = $event"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- ── Steps ────────────────────────────────────────────────────── -->
        <template #tab-steps>
          <div class="space-y-3">
            <UAlert
              v-if="isFailedStatus(testCase?.status ?? '') && steps.length > 0 && !steps.some((s) => s.failed)"
              color="warning"
              variant="subtle"
              icon="i-lucide-info"
              title="The failure was not captured at step level"
              description="The test failed, but none of the recorded steps is marked failed — the error happened outside the step list."
            />
            <div v-if="steps.length > 0">
              <!-- Per-category summary strip -->
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs mb-3">
                <span class="font-medium text-gray-600 dark:text-gray-300">{{ steps.length }} steps</span>
                <span class="text-gray-300 dark:text-gray-600">·</span>
                <span v-for="c in stepSummary" :key="c.category" class="inline-flex items-center gap-1">
                  <UBadge :color="stepCategoryColor[c.category] || 'neutral'" variant="soft" size="xs">
                    {{ c.category }}
                  </UBadge>
                  <span class="tabular-nums text-gray-500 dark:text-gray-400"
                    >×{{ c.count }} · <DurationValue :ms="c.duration"
                  /></span>
                </span>
              </div>

              <TableScroller min-width="40rem" :bleed="false">
                <UTable
                  :data="steps"
                  :columns="stepColumns"
                  :ui="{
                    base: 'table-fixed w-full border-separate border-spacing-0 min-w-[40rem]',
                    thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                    tbody: '[&>tr]:last:[&>td]:border-b-0',
                    th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                    td: 'border-b border-default align-top',
                  }"
                >
                  <template #index-cell="{ row }">
                    <span class="text-xs tabular-nums text-gray-400 dark:text-gray-500">{{ row.index + 1 }}</span>
                  </template>
                  <template #status-cell="{ row }">
                    <span
                      v-if="testCase?.status === 'didnotrun'"
                      class="inline-flex items-center justify-center size-5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-xs leading-none"
                      title="Not run"
                      >–</span
                    >
                    <span
                      v-else-if="row.original.failed"
                      class="inline-flex items-center justify-center size-5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs leading-none"
                      title="Step failed"
                      >✗</span
                    >
                    <span
                      v-else
                      class="inline-flex items-center justify-center size-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs leading-none"
                      title="Step passed"
                      >✓</span
                    >
                  </template>
                  <template #category-cell="{ row }">
                    <UBadge :color="stepCategoryColor[row.original.category] || 'neutral'" variant="soft" size="xs">
                      {{ row.original.category }}
                    </UBadge>
                  </template>
                  <template #title-cell="{ row }">
                    <div class="flex items-center gap-2">
                      <span :class="row.original.failed ? 'text-red-600 dark:text-red-400 font-medium' : ''">
                        {{ row.original.title }}
                      </span>
                      <UBadge
                        v-if="row.index === slowestStepIndex"
                        color="warning"
                        variant="subtle"
                        size="xs"
                        class="shrink-0"
                        title="Slowest step in this test"
                      >
                        slowest
                      </UBadge>
                    </div>
                    <ErrorText
                      v-if="row.original.failed && row.original.error?.message"
                      mode="block"
                      :text="row.original.error.message"
                      class="mt-1"
                    />
                    <OpenInIdeLink
                      v-if="row.original.location"
                      :location="row.original.location"
                      :project-key="testCase?.testRun?.project?.id"
                      :project-name="testCase?.testRun?.project?.name"
                      class="text-xs text-gray-400 dark:text-gray-500 mt-0.5"
                    />
                  </template>
                  <template #duration-cell="{ row }">
                    <div class="min-w-[6rem]">
                      <div class="flex items-center justify-between gap-2">
                        <DurationValue
                          :ms="row.original.duration"
                          :class="`text-sm ${stepDurationTextClass(row.original.duration)}`"
                          unit-class="opacity-60"
                        />
                        <span
                          v-if="stepPctOfTest(row.original.duration)"
                          class="text-xs tabular-nums text-gray-400 dark:text-gray-500"
                        >
                          {{ stepPctOfTest(row.original.duration) }}
                        </span>
                      </div>
                      <div class="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div
                          class="absolute inset-y-0 rounded-full"
                          :class="stepBarColorClass(row.original.duration)"
                          :style="stepBarStyle(row.original)"
                        />
                      </div>
                    </div>
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
              storage-key="case-page-state-artifacts"
              :page-state="(testCase as any).pageState"
            />
            <EvidenceCardEmpty
              v-else
              storage-key="case-page-state-artifacts"
              icon="i-lucide-database"
              title="App state at test end"
              help="page-state"
              :state="evidenceStates.appState"
            />
            <TestCaseConsoleCard
              v-if="(testCase as any)?.consoleLogs?.length"
              :entries="(testCase as any)?.consoleLogs ?? []"
              :derived-from-trace="evidenceDerived.console"
            />
            <EvidenceCardEmpty
              v-else
              storage-key="case-console-artifacts"
              icon="i-lucide-terminal"
              title="Console"
              help="case.console"
              :state="evidenceStates.console"
            />
            <TestCaseNetworkRequests
              v-if="networkRequests.length > 0 || hasTrace"
              :requests="networkRequests"
              :run-id="testCase?.testRun?.id ?? null"
              :test-runs-case-id="Number(testCaseId)"
              :has-trace="hasTrace"
              :derived-from-trace="evidenceDerived.network"
            />
            <EvidenceCardEmpty
              v-else
              storage-key="case-network-artifacts"
              icon="i-lucide-arrow-left-right"
              title="Network"
              help="case.network"
              :state="evidenceStates.network"
            />
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
              id="webvitals-card"
              icon="i-lucide-gauge"
              title="Browser performance (Web Vitals)"
              help="case.web-vitals"
            >
              <div class="space-y-4">
                <StatTileGrid v-if="webVitals.navigation" min-tile-width="10rem">
                  <StatTile
                    label="TTFB"
                    hint="Time to first byte"
                    :value-class="
                      webVitals.navigation.ttfb > 600
                        ? 'text-red-600'
                        : webVitals.navigation.ttfb > 200
                          ? 'text-orange-500'
                          : 'text-green-600'
                    "
                  >
                    <DurationValue :ms="webVitals.navigation.ttfb" />
                  </StatTile>
                  <StatTile
                    label="DOM Interactive"
                    hint="DOM interactive"
                    :value-class="
                      webVitals.navigation.domInteractive > 3000
                        ? 'text-red-600'
                        : webVitals.navigation.domInteractive > 1500
                          ? 'text-orange-500'
                          : 'text-green-600'
                    "
                  >
                    <DurationValue :ms="webVitals.navigation.domInteractive" />
                  </StatTile>
                  <StatTile
                    label="DOMContentLoaded"
                    hint="DOMContentLoaded"
                    :value-class="
                      webVitals.navigation.domContentLoaded > 3000
                        ? 'text-red-600'
                        : webVitals.navigation.domContentLoaded > 1500
                          ? 'text-orange-500'
                          : 'text-green-600'
                    "
                  >
                    <DurationValue :ms="webVitals.navigation.domContentLoaded" />
                  </StatTile>
                  <StatTile
                    label="Load Complete"
                    hint="Page fully loaded"
                    :value-class="
                      webVitals.navigation.loadComplete > 5000
                        ? 'text-red-600'
                        : webVitals.navigation.loadComplete > 3000
                          ? 'text-orange-500'
                          : 'text-green-600'
                    "
                  >
                    <DurationValue :ms="webVitals.navigation.loadComplete" />
                  </StatTile>
                </StatTileGrid>

                <StatTileGrid
                  v-if="webVitals.paint && (webVitals.paint.firstPaint || webVitals.paint.firstContentfulPaint)"
                  min-tile-width="10rem"
                  class="pt-2 border-t"
                >
                  <StatTile v-if="webVitals.paint.firstPaint !== undefined" label="First Paint (FP)">
                    <DurationValue :ms="webVitals.paint.firstPaint" />
                  </StatTile>
                  <StatTile
                    v-if="webVitals.paint.firstContentfulPaint !== undefined"
                    label="First Contentful Paint (FCP)"
                    :value-class="
                      webVitals.paint.firstContentfulPaint > 3000
                        ? 'text-red-600'
                        : webVitals.paint.firstContentfulPaint > 1800
                          ? 'text-orange-500'
                          : 'text-green-600'
                    "
                  >
                    <DurationValue :ms="webVitals.paint.firstContentfulPaint" />
                  </StatTile>
                </StatTileGrid>

                <!-- Core Web Vitals — Google rating bands; missing values render "n/a"
                     without alarm colors (INP is often absent in short tests). -->
                <StatTileGrid v-if="webVitals.vitals" min-tile-width="10rem" class="pt-2 border-t">
                  <StatTile
                    label="Largest Contentful Paint (LCP)"
                    :value-class="
                      webVitals.vitals.lcp == null
                        ? 'text-gray-400'
                        : webVitals.vitals.lcp > 4000
                          ? 'text-red-600'
                          : webVitals.vitals.lcp > 2500
                            ? 'text-orange-500'
                            : 'text-green-600'
                    "
                  >
                    <DurationValue :ms="webVitals.vitals.lcp" fallback="n/a" />
                  </StatTile>
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
                    :value-class="
                      webVitals.vitals.inp == null
                        ? 'text-gray-400'
                        : webVitals.vitals.inp > 500
                          ? 'text-red-600'
                          : webVitals.vitals.inp > 200
                            ? 'text-orange-500'
                            : 'text-green-600'
                    "
                  >
                    <DurationValue :ms="webVitals.vitals.inp" fallback="n/a" />
                  </StatTile>
                </StatTileGrid>

                <div v-if="webVitals.navigation?.url" class="text-xs text-gray-400 pt-1">
                  Page: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ webVitals.navigation.url }}</code>
                </div>
              </div>
            </SectionCard>
            <EvidenceCardEmpty
              v-else
              storage-key="case-web-vitals"
              icon="i-lucide-gauge"
              title="Browser performance (Web Vitals)"
              help="case.web-vitals"
              :state="evidenceStates.webVitals"
            />
          </div>
        </template>

        <!-- ── History ──────────────────────────────────────────────────── -->
        <template #tab-history>
          <div class="space-y-4 pt-4" data-shot="execution-history">
            <div v-if="historyData && historyData.length > 0" class="space-y-4">
              <ChartCard title="Duration trend" icon="i-lucide-trending-up" :legend="legendOf(CASE_STATUS_SERIES)">
                <template #actions>
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
                </template>
                <TestCaseHistoryChart :data="historyData" :height="200" />
              </ChartCard>
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
                      <ClientOnly>
                        <span :title="prettyDateFormat(row.original.startTime)">
                          {{ formatRelativeTime(row.original.startTime) }}
                        </span>
                      </ClientOnly>
                    </span>
                  </template>
                  <template #status-cell="{ row }">
                    <UBadge :color="getStatusColor(row.original.status)" variant="subtle" class="capitalize">{{
                      formatStatusLabel(row.original.status)
                    }}</UBadge>
                  </template>
                  <template #duration-cell="{ row }">
                    <DurationValue v-if="row.original.duration !== null" :ms="row.original.duration" />
                    <span v-else class="text-gray-400">&mdash;</span>
                  </template>
                  <template #runId-cell="{ row }">
                    <NuxtLink :to="`/test-runs/${row.original.runId}`" class="text-primary hover:underline">
                      #{{ row.original.runId }}
                    </NuxtLink>
                  </template>
                  <template #error-cell="{ row }">
                    <ErrorText v-if="row.original.error" :text="row.original.error" class="max-w-xs" />
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
