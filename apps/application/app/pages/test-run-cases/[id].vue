<script setup lang="ts">
import type { AiStepIntent, AttemptOutcome, TestCaseHistoryPoint, TraceInfo } from '~~/types/api';
import { isPiwiAnnotation } from '@piwitests/core/test-meta';
import { renderAnsi } from '~/utils';
import { buildRetryCommand } from '~/utils/retry-command';
import { condenseErrorText } from '#shared/error-fingerprint';
import type { FailureVerdict } from '#shared/failure-verdict';
import type { FailureCluesResult } from '#shared/handlers/test-cases';
import { clusterSectionLocatorKey } from '~/composables/useClusterSectionLocator';
import { EVIDENCE_SECTION_TAB } from '~/utils/evidence-sections';

const route = useRoute();
const testCaseId = route.params.id;

const { data: testCase, refresh } = await useFetch(`/api/test-run-cases/${testCaseId}`);

// The rows ride in the SSR payload, so the server and the client agree on the
// History block's strip at hydration.
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
// one line), the CluesCard, and the evidence tabs' default-tab choice.
const { data: cluesData } = await useFetch<FailureCluesResult>(`/api/test-run-cases/${testCaseId}/clues`, {
  default: (): FailureCluesResult => ({ clues: [], failureAt: null }),
});
const clues = computed(() => cluesData.value?.clues ?? []);
const cluesFailureAt = computed(() => cluesData.value?.failureAt ?? null);
const topClue = computed(() => clues.value[0] ?? null);
const topClueSection = computed(() => topClue.value?.citations?.[0]?.section ?? null);

const { data: traceData, refresh: refreshTraces } = await useFetch(`/api/test-run-cases/${testCaseId}/traces`, {
  transform: (r: { items: TraceInfo[] }) => r.items,
});

/** Whether a trace file exists for this execution — unlocks the "go deeper" evidence views. */
const hasTrace = computed(() => (traceData.value?.length ?? 0) > 0);

useHead(
  computed(() => ({
    title: testCase.value?.title
      ? `${testCase.value.title} — execution — Piwi Dashboard`
      : `Execution #${testCaseId} — Piwi Dashboard`,
  })),
);

const runIsActive = computed(() => {
  const status = testCase.value?.testRun?.status;
  return status === 'running' || status === 'finalizing';
});

const metadata = computed(() => testCase.value?.testRun?.metadata as Record<string, unknown> | null | undefined);
const scmInfo = computed(() => {
  const m = metadata.value;
  if (!m?.scm) return null;
  return m.scm as { commit?: string; branch?: string; author?: string; commitMessage?: string };
});
const ciInfo = computed(() => {
  const m = metadata.value;
  if (!m?.ci) return null;
  return m.ci as { provider?: string; buildNumber?: string; buildUrl?: string; workflow?: string; jobName?: string };
});
const environment = computed(() => testCase.value?.testRun?.environment);
const browser = computed(() => testCase.value?.browser ?? null);
const stepsCount = computed(() => (testCase.value?.steps as unknown[] | null)?.length ?? 0);

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

/** AI-step intent mappings from the execution's usage manifest (locator-fix probe). */
const aiIntents = computed<AiStepIntent[] | null>(() => {
  const usage = testCase.value?.aiUsage as unknown as { intents?: AiStepIntent[] } | null;
  return usage?.intents ?? null;
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

// ── Header: identity, exceptional badges, facts ─────────────────────────────
// The first captured source frame — the failing line — beats the test()
// declaration for the header's "open in IDE" link.
const ideTarget = computed(() => {
  const frames = (testCase.value as { testSourceFrames?: Array<{ filePath?: string; line?: number }> | null } | null)
    ?.testSourceFrames;
  const frame = frames?.[0];
  if (!frame?.filePath) return null;
  return { filePath: frame.filePath, line: frame.line };
});

// Playwright test marks only — `piwi:` annotations are ownership, not marks.
const annotations = computed(() =>
  (testCase.value?.testAnnotations ?? []).filter(
    (ann: { type: string; description?: string | null }) => !isPiwiAnnotation(ann.type),
  ),
);

const quarantined = computed(() => Boolean((testCase.value as { quarantined?: boolean } | null)?.quarantined));

/** Exceptional badges only: regression, passed on retry, newly flaky, marks. */
const headerBadges = computed(() => {
  const tc = testCase.value;
  if (!tc)
    return [] as {
      label: string;
      color?: 'error' | 'warning' | 'neutral';
      icon?: string;
      title?: string;
      mono?: boolean;
    }[];
  const out: {
    label: string;
    color?: 'error' | 'warning' | 'neutral';
    icon?: string;
    title?: string;
    mono?: boolean;
  }[] = [];
  if (tc.isNewRegression)
    out.push({
      label: 'New regression',
      color: 'error',
      icon: 'i-lucide-git-pull-request-arrow',
      title: 'Passed in the baseline run, failing here',
    });
  if (tc.status === 'passed' && (tc.retries ?? 0) > 0)
    out.push({
      label: 'Passed on retry',
      color: 'warning',
      icon: 'i-lucide-refresh-cw',
      title: 'This test failed then passed on a retry',
    });
  if (tc.isNewFlaky)
    out.push({
      label: 'Newly flaky',
      color: 'warning',
      icon: 'i-lucide-shuffle',
      title: 'Newly started passing only on retry',
    });
  for (const ann of annotations.value)
    out.push({ label: `@${ann.type}`, color: 'neutral', mono: true, title: ann.description || ann.type });
  return out;
});

// ── Attempts (facts line) ───────────────────────────────────────────────────
const attempts = computed(() => testCase.value?.attempts ?? null);
function attemptColor(status: string): 'success' | 'error' | 'neutral' {
  if (status === 'passed') return 'success';
  if (status === 'failed' || status === 'timedout' || status === 'timedOut') return 'error';
  return 'neutral';
}
function attemptTitle(a: AttemptOutcome): string {
  const when = a.startedAt ? ` at ${new Date(a.startedAt).toLocaleString()}` : '';
  return `Attempt ${a.retry + 1}: ${a.status} (${Math.round(a.duration)} ms)${when}`;
}
function isCurrentAttempt(a: AttemptOutcome): boolean {
  return a.retry === (testCase.value?.retries ?? 0);
}
function attemptLink(a: AttemptOutcome): string | null {
  return !isCurrentAttempt(a) && a.executionId ? `/test-run-cases/${a.executionId}` : null;
}

// ── Retry command (header primary action) ───────────────────────────────────
const retryCases = computed(() => [
  {
    filePath: testCase.value?.filePath ?? '',
    title: testCase.value?.title ?? '',
    line: testCase.value?.line ?? null,
    projectName: (testCase.value?.browser as { projectName?: string } | null)?.projectName ?? null,
  },
]);
const retryCommand = computed(() => buildRetryCommand(retryCases.value));
const { copy: copyRetry, copied: retryCopied } = useCopy();
const retryTitle = computed(() => (retryCopied.value ? 'Copied!' : copyPreview(retryCommand.value)));

const desktopBridge = ref(false);
onMounted(() => {
  desktopBridge.value = !!tauriCore();
});

// ── Quarantine ──────────────────────────────────────────────────────────────
const { canWrite } = useAuth();
const { quarantineOne, releaseOne } = useQuarantine(() => testCase.value?.testRun?.project?.id ?? null);
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

// ── Copy failure ────────────────────────────────────────────────────────────
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

// ── Link an issue ─────────────────────────────────────────────────────────
const linksModalOpen = ref(false);

// ── Navbar More menu ────────────────────────────────────────────────────────
const moreMenuItems = computed(() => {
  const items: { label: string; icon: string; color?: 'warning'; onSelect: () => void }[] = [];
  if (canWrite.value && testCase.value?.testCaseId) {
    items.push(
      quarantined.value
        ? {
            label: 'Release from quarantine',
            icon: 'i-lucide-shield-check',
            color: 'warning',
            onSelect: toggleQuarantine,
          }
        : {
            label: 'Quarantine this test',
            icon: 'i-lucide-shield-alert',
            color: 'warning',
            onSelect: toggleQuarantine,
          },
    );
  }
  items.push({ label: 'Link an issue', icon: 'i-lucide-link', onSelect: () => (linksModalOpen.value = true) });
  if (testCase.value?.error) items.push({ label: 'Copy failure', icon: 'i-lucide-clipboard', onSelect: copyFailure });
  items.push({ label: 'Refresh', icon: 'i-lucide-refresh-cw', onSelect: () => refresh() });
  return items;
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

// ── Section locator ─────────────────────────────────────────────────────────
// A clue or diagnosis citation reveals the evidence it came from: the evidence
// tabs handle the tabbed sections (switch tab + scroll), while the on-page error
// and locator-fix blocks scroll in place.
const errorEl = ref<HTMLElement | null>(null);
const locatorHealingCard = ref<{ reveal: () => void } | null>(null);
const evidenceTabs = ref<{
  canLocate: (id: string) => boolean;
  revealSection: (id: string) => boolean;
  selectTab: (t: string) => void;
} | null>(null);

function scrollToEl(el: HTMLElement | null) {
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const pageSections: Record<string, () => void> = {
  sampleError: () => scrollToEl(errorEl.value),
  executionError: () => scrollToEl(errorEl.value),
  locatorHealing: () => locatorHealingCard.value?.reveal(),
};
provide(clusterSectionLocatorKey, {
  // Answered from static maps so a citation renders as a button at SSR time too,
  // not only once the evidence card has mounted and registered its ref.
  canLocate: (id: string) => id in pageSections || id in EVIDENCE_SECTION_TAB,
  open: (id: string) => {
    if (id in pageSections) pageSections[id]!();
    else evidenceTabs.value?.revealSection(id);
  },
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
              title="View this test's history across runs"
              aria-label="Test history"
            >
              <UIcon name="i-lucide-trending-up" class="size-3.5" />
              <span class="hidden xl:inline">Test history</span>
            </NuxtLink>
            <ShareLinksModal
              v-if="testCase && !isDemoMode"
              :endpoint="`/api/test-run-cases/${testCase.id}/share-links`"
            />
            <ExportMenu
              v-if="testCase"
              :endpoint="`/api/test-run-cases/${testCase.id}/export`"
              :base-name="`piwi-execution-${testCase.id}`"
              class="mr-1"
            />
            <UDropdownMenu :items="moreMenuItems">
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis-vertical"
                aria-label="More actions"
                title="More actions"
              />
            </UDropdownMenu>
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 p-4 max-w-6xl mx-auto w-full">
        <!-- ── Header ─────────────────────────────────────────────────── -->
        <DetailHeader :status="testCase?.status ?? ''" :title="testCase?.title ?? ''" :badges="headerBadges">
          <template #badges-extra>
            <QuarantinedChip v-if="quarantined" />
          </template>

          <template #primary>
            <UButton
              v-if="retryCommand && !desktopBridge"
              size="xs"
              color="warning"
              variant="subtle"
              :icon="retryCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
              :title="retryTitle"
              aria-label="Copy retry command"
              @click="copyRetry(retryCommand, { toast: 'Retry command copied' })"
            >
              <span class="hidden sm:inline">Copy retry command</span>
            </UButton>
            <DesktopRunLocallyButton
              :project-id="testCase?.testRun?.project?.id"
              :project-label="testCase?.testRun?.project?.label ?? testCase?.testRun?.project?.name"
              :cases="retryCases"
            />
          </template>

          <template #facts>
            <OpenInIdeLink
              v-if="ideTarget?.filePath || testCase?.location"
              :file-path="ideTarget?.filePath"
              :line="ideTarget?.line"
              :location="ideTarget ? undefined : (testCase?.location ?? undefined)"
              :project-key="testCase?.testRun?.project?.id"
              :project-name="testCase?.testRun?.project?.name"
            />
            <span v-if="browser" class="inline-flex items-center gap-1">
              <BrowserBadge :browser="{ ...browser, viewport: undefined }" size="sm" />
              <span v-if="browser.viewport" class="tabular-nums">
                {{ browser.viewport.width }}×{{ browser.viewport.height }}
              </span>
            </span>
            <span v-if="testCase?.status !== 'didnotrun'" class="inline-flex items-center gap-1 tabular-nums">
              <DurationValue :ms="testCase?.duration" class="font-medium text-toned" />
              <span v-if="historicalTiming" class="text-dimmed">
                (avg <DurationValue :ms="historicalTiming.avg" />,
                <span :class="historicalTiming.diff > 0 ? 'text-red-600' : 'text-green-600'">
                  {{ historicalTiming.diff > 0 ? '+' : '' }}{{ historicalTiming.pct }}%</span
                >)
              </span>
            </span>
            <span
              v-if="attempts && attempts.length > 1"
              class="inline-flex items-center gap-1"
              role="group"
              aria-label="Attempts of this test in this run"
            >
              <template v-for="a in attempts" :key="a.retry">
                <NuxtLink
                  v-if="attemptLink(a)"
                  :to="attemptLink(a)!"
                  :title="`${attemptTitle(a)} — open this attempt`"
                  class="inline-flex rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary hover:opacity-80"
                >
                  <UBadge :color="attemptColor(a.status)" variant="soft" size="sm" class="font-mono">
                    {{ a.retry + 1 }}/{{ attempts.length }}
                    <UIcon :name="a.status === 'passed' ? 'i-lucide-check' : 'i-lucide-x'" class="w-3 h-3" />
                  </UBadge>
                </NuxtLink>
                <UBadge
                  v-else
                  :color="attemptColor(a.status)"
                  variant="soft"
                  size="sm"
                  class="font-mono"
                  :class="isCurrentAttempt(a) ? 'ring-2 ring-offset-1 ring-primary' : ''"
                  :title="isCurrentAttempt(a) ? `${attemptTitle(a)} — this execution` : attemptTitle(a)"
                  :aria-current="isCurrentAttempt(a) ? 'true' : undefined"
                >
                  {{ a.retry + 1 }}/{{ attempts.length }}
                  <UIcon :name="a.status === 'passed' ? 'i-lucide-check' : 'i-lucide-x'" class="w-3 h-3" />
                </UBadge>
              </template>
            </span>
            <span v-if="scmInfo?.branch || scmInfo?.commit" class="inline-flex items-center gap-1">
              <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0" />
              <span v-if="scmInfo?.branch" class="font-medium">{{ scmInfo.branch }}</span>
              <code v-if="scmInfo?.commit" class="font-mono bg-elevated px-1 py-0.5 rounded" :title="scmInfo.commit">{{
                scmInfo.commit.length >= 8 ? scmInfo.commit.substring(0, 8) : scmInfo.commit
              }}</code>
            </span>
            <a
              v-if="ciInfo?.buildUrl || ciInfo?.buildNumber"
              :href="ciInfo?.buildUrl || undefined"
              :target="ciInfo?.buildUrl ? '_blank' : undefined"
              :class="
                ciInfo?.buildUrl
                  ? 'text-primary hover:underline inline-flex items-center gap-1'
                  : 'inline-flex items-center gap-1'
              "
            >
              <UIcon name="i-lucide-cloud" class="size-3.5 shrink-0" />
              {{ ciInfo?.buildNumber ? `Build #${ciInfo.buildNumber}` : 'View build' }}
            </a>
            <ClientOnly>
              <span
                v-if="testCase?.startedAt"
                class="text-dimmed"
                :title="new Date(testCase.startedAt).toLocaleString()"
              >
                {{ formatRelativeTime(testCase.startedAt) }}
              </span>
            </ClientOnly>
          </template>

          <template #details>
            <div v-if="environment || ciInfo" class="space-y-1">
              <p class="text-xs font-medium text-muted uppercase tracking-wide">CI &amp; environment</p>
              <p v-if="environment">
                Environment: <span class="text-highlighted">{{ environment }}</span>
              </p>
              <p v-if="ciInfo?.provider">Provider: {{ ciInfo.provider }}</p>
              <p v-if="ciInfo?.workflow || ciInfo?.jobName">
                <template v-if="ciInfo?.workflow">{{ ciInfo.workflow }}</template>
                <template v-if="ciInfo?.workflow && ciInfo?.jobName"> · </template>
                <template v-if="ciInfo?.jobName">{{ ciInfo.jobName }}</template>
              </p>
            </div>
            <div v-if="testCase?.testRun?.playwrightVersion || testCase?.testRun?.reporterVersion" class="space-y-1">
              <p class="text-xs font-medium text-muted uppercase tracking-wide">Tooling</p>
              <p>
                <template v-if="testCase?.testRun?.playwrightVersion"
                  >Playwright v{{ testCase.testRun.playwrightVersion }}</template
                >
                <template v-if="testCase?.testRun?.playwrightVersion && testCase?.testRun?.reporterVersion">
                  ·
                </template>
                <template v-if="testCase?.testRun?.reporterVersion"
                  >Piwi v{{ testCase.testRun.reporterVersion }}</template
                >
              </p>
            </div>
            <div class="space-y-1">
              <p class="text-xs font-medium text-muted uppercase tracking-wide">Execution</p>
              <p class="tabular-nums">
                Worker {{ testCase?.workerIndex ?? '—'
                }}<template v-if="testCase?.shardIndex != null"> · Shard {{ testCase.shardIndex }}</template> ·
                {{ stepsCount }} steps
              </p>
              <p
                v-if="testCase?.slowestStep && testCase?.status !== 'didnotrun'"
                class="truncate"
                :title="testCase.slowestStep"
              >
                Slowest step: {{ testCase.slowestStep }}
                <span v-if="testCase.slowestStepDuration">(<DurationValue :ms="testCase.slowestStepDuration" />)</span>
              </p>
              <p v-if="(testCase?.wastedTimeMs ?? 0) > 0">
                Wasted in fixed waits: <DurationValue :ms="testCase?.wastedTimeMs" />
              </p>
            </div>
            <div v-if="testCase?.tags?.length || testCase?.testMeta" class="space-y-1">
              <p class="text-xs font-medium text-muted uppercase tracking-wide">Tags</p>
              <TestMetaBadges :tags="testCase?.tags" :meta="testCase?.testMeta" />
            </div>
            <div v-if="testCase?.executionId" class="space-y-1">
              <p class="text-xs font-medium text-muted uppercase tracking-wide">Links</p>
              <EntityLinks
                entity-type="test_case"
                :entity-id="testCase.executionId"
                :links="(testCase as any)?.stableLinks ?? null"
                readonly
              />
            </div>
          </template>
        </DetailHeader>

        <!-- Why this execution never ran — the whole story for a did-not-run case. -->
        <DidNotRunCard
          :status="testCase?.status"
          :reason="(testCase as any)?.didNotRunReason ?? null"
          :blocked-by-case="(testCase as any)?.blockedByCase ?? null"
        />

        <!-- ── What broke, in one line ────────────────────────────────── -->
        <TestCaseHeadlineCard v-if="verdict" :verdict="verdict" :top-clue="topClue" />

        <!-- Deterministic, ranked clues correlated from the captured evidence -->
        <CluesCard :clues="clues" :failure-at="cluesFailureAt" />

        <!-- The raw error, verbatim -->
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

        <!-- ── Evidence ───────────────────────────────────────────────── -->
        <EvidenceTabs
          ref="evidenceTabs"
          :test-case="testCase"
          :traces="(traceData as TraceInfo[]) ?? []"
          :has-trace="hasTrace"
          :default-section="topClueSection"
          help="case.evidence"
        />

        <!-- ── What to do (PR 2 merges these into one Fix block) ──────── -->
        <TestCaseVerdictCard
          :test-case="(testCase as any) ?? null"
          :history="historyData"
          :current-id="Number(testCaseId)"
        />

        <FailureClusterCard v-if="failureCluster" :cluster="failureCluster" />

        <!-- The downstream tests this failure blocked from running -->
        <DidNotRunCard :blocked-tests="(testCase as any)?.blockedTests ?? null" />

        <!-- Ranked replacement locators for a broken locator -->
        <LocatorHealingPanel
          v-if="testCase?.testRun?.id"
          ref="locatorHealingCard"
          :run-id="testCase.testRun.id"
          :test-runs-case-id="Number(testCaseId)"
          :ai-intents="aiIntents"
        />

        <TestCaseAiCard :test-runs-case-id="Number(testCaseId)" />

        <!-- ── History ────────────────────────────────────────────────── -->
        <SectionCard icon="i-lucide-history" title="History" data-shot="execution-history">
          <template #actions>
            <UButton
              v-if="testCase?.testCaseId"
              :to="`/test-cases/${testCase.testCaseId}`"
              size="xs"
              variant="outline"
              color="neutral"
              trailing-icon="i-lucide-arrow-right"
            >
              Test history
            </UButton>
          </template>
          <ClientOnly>
            <ExecutionHistoryStrip v-if="historyData?.length" :history="historyData" :current-id="Number(testCaseId)" />
            <p v-else class="text-sm text-muted">No prior executions of this test yet.</p>
          </ClientOnly>
        </SectionCard>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Link an issue: view and add external links for this execution. -->
  <UModal v-model:open="linksModalOpen" title="Links">
    <template #body>
      <EntityLinks
        v-if="testCase?.executionId"
        entity-type="test_case"
        :entity-id="testCase.executionId"
        :links="(testCase as any)?.stableLinks ?? null"
        @updated="refresh()"
      />
    </template>
  </UModal>
</template>
