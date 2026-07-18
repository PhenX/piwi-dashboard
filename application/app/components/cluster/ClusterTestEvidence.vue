<script setup lang="ts">
import type { TraceInfo, AttachmentInfo, TestSourceFrame, TraceCallStackResponse } from '~~/types/api';
import { isImageFile, isVideoFile } from '~/utils/text-format';

interface AffectedCase {
  testCaseId: number;
  title: string;
  filePath: string;
  runCount: number;
  recentTestRunsCaseId: number;
}

interface TestCaseDetail {
  id: number;
  error?: string | null;
  steps?: unknown;
  consoleLogs?: unknown;
  networkRequests?: unknown;
  ariaSnapshot?: string | null;
  testSource?: string | null;
  testSourceFrames?: TestSourceFrame[] | null;
  pageState?: import('~~/types/api').PageState | null;
  attachments: AttachmentInfo[];
  testRun?: { id: number } | null;
}

const props = defineProps<{
  affectedTestCases: AffectedCase[];
  /** Piwi project id + name, threaded so the IDE opener can resolve a workspace root. */
  projectKey?: string | number | null;
  projectName?: string | null;
}>();

const selectedId = ref(props.affectedTestCases[0]?.recentTestRunsCaseId ?? null);
const selectedCase = computed(() => props.affectedTestCases.find((c) => c.recentTestRunsCaseId === selectedId.value));

const caseDetail = ref<TestCaseDetail | null>(null);
const traces = ref<TraceInfo[]>([]);
const loading = ref(false);
const tracesLoading = ref(false);

const showSteps = ref(false);
const showSignals = ref(false);
const showSource = ref(false);
const showAriaSnapshot = ref(false);
const showPageState = ref(false);

// Cache each case's detail + traces so switching tabs is instant and doesn't
// re-fetch. Keyed by the test-run-case id.
const caseCache = new Map<number, { detail: TestCaseDetail; traces: TraceInfo[] }>();

function resetDisclosures() {
  showSteps.value = false;
  showSignals.value = false;
  showSource.value = false;
  showAriaSnapshot.value = false;
  showPageState.value = false;
}

async function loadCase(id: number) {
  resetDisclosures();

  const cached = caseCache.get(id);
  if (cached) {
    caseDetail.value = cached.detail;
    traces.value = cached.traces;
    loading.value = false;
    tracesLoading.value = false;
    return;
  }

  loading.value = true;
  tracesLoading.value = true;
  caseDetail.value = null;
  traces.value = [];

  const [detail, traceList] = await Promise.allSettled([
    $fetch<TestCaseDetail>(`/api/test-run-cases/${id}`),
    $fetch<TraceInfo[]>(`/api/test-run-cases/${id}/traces`),
  ]);

  if (detail.status === 'fulfilled') caseDetail.value = detail.value;
  loading.value = false;

  if (traceList.status === 'fulfilled') traces.value = traceList.value;
  tracesLoading.value = false;

  if (detail.status === 'fulfilled' && traceList.status === 'fulfilled') {
    caseCache.set(id, { detail: detail.value, traces: traceList.value });
  }
}

// ── Full call stack from the case's trace (go-deeper view of Test source) ──
const traceStackCache = new Map<number, TraceCallStackResponse | null>();
const traceStack = ref<TraceCallStackResponse | null>(null);
const stackView = ref<'trace' | 'captured'>('trace');
const traceStackFrames = computed(() => traceStack.value?.frames ?? []);

async function loadTraceStack(id: number) {
  traceStack.value = traceStackCache.get(id) ?? null;
  if (traceStackCache.has(id) || traces.value.length === 0) return;
  const runId = caseDetail.value?.testRun?.id;
  if (!runId) return;
  try {
    const res = await $fetch<TraceCallStackResponse>(`/api/test-runs/${runId}/cases/${id}/trace-stacks`);
    const value = res.status === 'ok' && res.frames?.length ? res : null;
    traceStackCache.set(id, value);
    if (selectedId.value === id) traceStack.value = value;
  } catch {
    traceStackCache.set(id, null);
  }
}

watch([caseDetail, traces], () => {
  stackView.value = 'trace';
  if (selectedId.value) loadTraceStack(selectedId.value);
});

watch(selectedId, (id) => {
  if (id) loadCase(id);
});

onMounted(() => {
  if (selectedId.value) loadCase(selectedId.value);
});

// Failing steps — keep only steps that have errors
const failingSteps = computed(() => {
  const steps = caseDetail.value?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.filter((s: { error?: unknown }) => s.error) as Array<{ title?: string; error?: { message?: string } }>;
});

const testSourceLines = computed(() =>
  caseDetail.value?.testSource ? caseDetail.value.testSource.split('\n').length : 0,
);

// One badge per evidence kind present, so the reader sees what's available
// before scrolling. Purely informative.
const evidenceChips = computed(() => {
  const d = caseDetail.value;
  if (!d) return [];
  const screenshots = d.attachments.filter((a) => isImageFile(a.path, a.contentType)).length;
  const videos = d.attachments.filter((a) => isVideoFile(a.path, a.contentType)).length;
  const consoleCount = Array.isArray(d.consoleLogs)
    ? (d.consoleLogs as Array<{ type?: string }>).filter((l) => l.type === 'error' || l.type === 'warning').length
    : 0;
  const failedRequests = Array.isArray(d.networkRequests)
    ? (d.networkRequests as Array<{ status?: number }>).filter((r) => (r.status ?? 0) >= 400).length
    : 0;
  return [
    { icon: 'i-lucide-image', label: 'screenshots', count: screenshots },
    { icon: 'i-lucide-video', label: 'videos', count: videos },
    { icon: 'i-lucide-bug-play', label: 'traces', count: traces.value.length },
    { icon: 'i-lucide-list-checks', label: 'failing steps', count: failingSteps.value.length },
    { icon: 'i-lucide-triangle-alert', label: 'signals', count: consoleCount + failedRequests },
    { icon: 'i-lucide-code', label: 'source', count: d.testSourceFrames?.length || (d.testSource ? 1 : 0) },
    { icon: 'i-lucide-accessibility', label: 'ARIA', count: d.ariaSnapshot ? 1 : 0 },
  ].filter((c) => c.count > 0);
});
</script>

<template>
  <div class="space-y-3">
    <!-- Per-case tabs -->
    <div v-if="affectedTestCases.length > 1" class="flex gap-0 border-b border-default overflow-x-auto">
      <button
        v-for="tc in affectedTestCases"
        :key="tc.recentTestRunsCaseId"
        class="px-3 py-1.5 text-xs whitespace-nowrap border-b-2 -mb-px transition-colors"
        :class="
          selectedId === tc.recentTestRunsCaseId
            ? 'border-primary text-primary font-medium'
            : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
        "
        :title="tc.title"
        @click="selectedId = tc.recentTestRunsCaseId"
      >
        {{ tc.title.split(' › ').pop() }}
        <span v-if="tc.runCount > 1" class="opacity-60 ml-1">{{ tc.runCount }}×</span>
      </button>
    </div>

    <!-- Selected case header: title, file location, link to the test run case -->
    <div v-if="selectedCase" class="flex items-start justify-between gap-2 flex-wrap">
      <div class="min-w-0">
        <p class="text-sm font-medium break-words">{{ selectedCase.title }}</p>
        <OpenInIdeLink
          :file-path="selectedCase.filePath"
          :project-key="projectKey"
          :project-name="projectName"
          class="text-xs text-gray-400"
        />
      </div>
      <UButton
        :to="`/test-run-cases/${selectedCase.recentTestRunsCaseId}`"
        size="xs"
        variant="outline"
        color="neutral"
        trailing-icon="i-lucide-arrow-right"
      >
        Open test run case
      </UButton>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-gray-400" />
    </div>

    <template v-else-if="caseDetail">
      <!-- Evidence summary chips -->
      <div v-if="evidenceChips.length" class="flex flex-wrap gap-1.5">
        <UBadge
          v-for="chip in evidenceChips"
          :key="chip.label"
          color="neutral"
          variant="subtle"
          size="sm"
          class="gap-1"
        >
          <UIcon :name="chip.icon" class="size-3" />
          {{ chip.count }} {{ chip.label }}
        </UBadge>
      </div>

      <!-- Screenshots -->
      <TestEvidenceScreenshots :attachments="caseDetail.attachments" />

      <!-- Videos -->
      <TestEvidenceVideos :attachments="caseDetail.attachments" />

      <!-- Traces -->
      <TestEvidenceTraces :traces="traces" :loading="tracesLoading" />

      <!-- Failing steps (collapsible) -->
      <TestEvidenceSection
        v-if="failingSteps.length > 0"
        icon="i-lucide-list-checks"
        label="Failing steps"
        :count="failingSteps.length"
        v-model:open="showSteps"
      >
        <div class="divide-y divide-default">
          <div v-for="(step, idx) in failingSteps" :key="idx" class="px-3 py-2 space-y-0.5">
            <p class="text-xs font-medium text-gray-700 dark:text-gray-300">{{ idx + 1 }}. {{ step.title }}</p>
            <p v-if="step.error?.message" class="text-xs font-mono text-red-500 whitespace-pre-wrap break-all">
              {{ step.error.message }}
            </p>
          </div>
        </div>
      </TestEvidenceSection>

      <!-- Console + network signals (collapsible) -->
      <TestEvidenceSignals
        :console-logs="caseDetail.consoleLogs"
        :network-requests="caseDetail.networkRequests"
        v-model:open="showSignals"
      />

      <!-- Test source code (collapsible): the failing line + its callers, or the full trace call stack -->
      <TestEvidenceSection
        v-if="caseDetail.testSourceFrames?.length || caseDetail.testSource || traceStackFrames.length"
        icon="i-lucide-code"
        label="Test source"
        :count="traceStackFrames.length || caseDetail.testSourceFrames?.length || testSourceLines"
        v-model:open="showSource"
      >
        <UTabs
          v-if="traceStackFrames.length && (caseDetail.testSourceFrames?.length || caseDetail.testSource)"
          v-model="stackView"
          :items="[
            { label: `Full stack (${traceStackFrames.length})`, value: 'trace' },
            { label: `Captured (${caseDetail.testSourceFrames?.length || 1})`, value: 'captured' },
          ]"
          size="xs"
          variant="link"
          class="mb-1.5"
          :ui="{ list: 'gap-2', trigger: 'px-1.5' }"
        />
        <div class="overflow-x-auto max-h-72">
          <TraceCallStack
            v-if="stackView === 'trace' && traceStackFrames.length"
            :frames="traceStackFrames"
            :project-key="projectKey"
            :project-name="projectName"
          />
          <TestSourceStack
            v-else-if="caseDetail.testSourceFrames?.length"
            :frames="caseDetail.testSourceFrames"
            :project-key="projectKey"
            :project-name="projectName"
          />
          <MarkdownPreview
            v-else-if="caseDetail.testSource"
            :text="'```typescript\n' + caseDetail.testSource + '\n```'"
          />
        </div>
      </TestEvidenceSection>

      <!-- ARIA snapshot (collapsible) -->
      <TestEvidenceSection
        v-if="caseDetail.ariaSnapshot"
        icon="i-lucide-accessibility"
        label="ARIA snapshot"
        v-model:open="showAriaSnapshot"
      >
        <div class="max-h-64 overflow-auto">
          <MarkdownPreview :text="'```yaml\n' + caseDetail.ariaSnapshot + '\n```'" />
        </div>
      </TestEvidenceSection>

      <!-- App state at test end (collapsible) -->
      <TestEvidenceSection
        v-if="caseDetail.pageState"
        icon="i-lucide-database"
        label="App state"
        v-model:open="showPageState"
      >
        <PageStateCard :page-state="caseDetail.pageState" plain />
      </TestEvidenceSection>
    </template>
  </div>
</template>
