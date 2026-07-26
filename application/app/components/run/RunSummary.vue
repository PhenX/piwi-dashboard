<script setup lang="ts">
import type { TestRunDetails, ReportInfo } from '~~/types/api';
import type { RetryMode } from '~/utils/retry-command';
import { buildRetryCommand } from '~/utils/retry-command';

const props = defineProps<{
  testRun: TestRunDetails;
  displayProgress: { totalTests: number; passedTests: number; failedTests: number; skippedTests: number } | null;
  allReports: ReportInfo[];
  showCustomData: boolean;
  finalizing?: boolean;
  activeFilter?: string;
  totalWastedTime?: number;
}>();

const emit = defineEmits<{
  'update:showCustomData': [value: boolean];
  'filter-status': [value: string];
  'label-updated': [];
}>();

const toast = useToast();
const storageStats = computed(() => props.testRun?.storageStats);

// Visibility of each metadata block, defined once and referenced by both the
// block count (below) and the template `v-if`, so the two can never drift and
// leave the grid spanning more than 12 columns (which would wrap a block).
const showCiEnv = computed(
  () =>
    !!(
      props.testRun?.metadata?.ci ||
      props.testRun?.environment ||
      props.testRun?.playwrightVersion ||
      props.testRun?.reporterVersion
    ),
);
const showSource = computed(() => !!props.testRun?.metadata?.scm);
const showStorage = computed(() => !!(storageStats.value?.totalFiles || props.finalizing));
const showOther = computed(
  () =>
    !!(
      props.testRun?.metadata?.tags?.length ||
      props.testRun?.metadata?.projectDescription ||
      props.testRun?.metadata?.relatedIssue ||
      props.testRun?.metadata?.customData ||
      props.testRun?.links?.length
    ),
);

const { summaryColSpanClass, blockColSpanClass } = useDetailGrid(
  () => [showCiEnv, showSource, showStorage, showOther].filter((b) => b.value).length,
);

const { copy, copied } = useCopy();
const retryMode = ref<RetryMode>('file-line');
const retryCopied = ref(false);

const failedCases = computed(() => {
  if (!props.testRun?.testCases) return [];
  return props.testRun.testCases
    .filter((tc) => tc.status === 'failed' || tc.status === 'timedout')
    .map((tc) => ({
      filePath: (tc.filePath || tc.location?.split(':')[0]) ?? '',
      title: tc.title,
      line: tc.location ? parseInt(tc.location.split(':')[1] ?? '', 10) || null : null,
      projectName: (tc.browser as { projectName?: string } | null)?.projectName || null,
    }));
});

function buildRetry() {
  return buildRetryCommand(failedCases.value, { mode: retryMode.value });
}

async function copyRetryCommand() {
  const cmd = buildRetry();
  if (!cmd) return;
  retryCopied.value = true;
  await copy(cmd, { toast: 'Retry command copied' });
  setTimeout(() => {
    retryCopied.value = false;
  }, 2000);
}

const retryTitle = computed(() => {
  if (retryCopied.value) return 'Copied!';
  return copyPreview(buildRetry());
});

function buildRunSummary() {
  const run = props.testRun;
  if (!run) return '';
  const statusEmoji =
    run.status === 'passed' ? '✅' : run.status === 'failed' ? '❌' : run.status === 'running' ? '🔄' : '⚠️';
  const label = run.label ? ` — ${run.label}` : '';
  const project = run.project?.label ?? run.project?.name ?? '';
  const total = run.totalTests ?? 0;
  const passed = run.passedTests ?? 0;
  const failed = run.failedTests ?? 0;
  const skipped = run.skippedTests ?? 0;
  const didNotRun = run.didNotRunTests ?? 0;
  const flaky = run.flakyTests ?? 0;
  const duration = formatDuration(run.duration);
  const flakyPart = flaky > 0 ? ` · ${flaky} flaky` : '';
  const didNotRunPart = didNotRun > 0 ? ` · ${didNotRun} didn't run` : '';
  return [
    `*Run #${run.id}*${label}`,
    `Status: ${statusEmoji} ${run.status} | Project: ${project}`,
    `Tests: ${total} total · ${passed} passed · ${failed} failed · ${skipped} skipped${didNotRunPart}${flakyPart}`,
    `Duration: ${duration}`,
  ].join('\n');
}
const labelInput = ref('');
const editingLabel = ref(false);
const savingLabel = ref(false);
let labelCancelled = false;
const labelInputRef = ref<HTMLInputElement | null>(null);

function startEditLabel() {
  labelCancelled = false;
  labelInput.value = props.testRun?.label ?? '';
  editingLabel.value = true;
  nextTick(() => labelInputRef.value?.focus());
}

async function saveLabel() {
  if (savingLabel.value) return;
  if (labelCancelled) {
    labelCancelled = false;
    return;
  }
  const run = props.testRun;
  if (!run) return;
  savingLabel.value = true;
  try {
    await $fetch(`/api/test-runs/${run.id}`, {
      method: 'PATCH',
      body: { label: labelInput.value || null },
    });
    editingLabel.value = false;
    emit('label-updated');
  } catch (error: unknown) {
    const msg =
      error && typeof error === 'object' && 'data' in error
        ? (error.data as { message?: string })?.message
        : 'Failed to save label';
    toast.add({ title: 'Error', description: msg || 'Failed to save label', color: 'error' });
  } finally {
    savingLabel.value = false;
  }
}

function cancelEditLabel() {
  labelCancelled = true;
  editingLabel.value = false;
}

function onLabelKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') saveLabel();
  else if (e.key === 'Escape') cancelEditLabel();
}
</script>

<template>
  <FoldableSummary storage-key="test-run">
    <template #folded>
      <div class="flex items-center gap-3 flex-1 min-w-0 justify-between">
        <div class="flex items-center gap-3 min-w-0">
          <StatusBlock :status="testRun?.status ?? ''" size="sm" />
          <span class="text-sm font-semibold truncate flex items-center gap-1">
            Run #{{ testRun?.id }}
            <template v-if="editingLabel">
              <input
                ref="labelInputRef"
                v-model="labelInput"
                type="text"
                placeholder="Add a label..."
                class="inline-block w-40 text-sm font-normal border-b border-dashed border-gray-400 bg-transparent outline-none focus:border-primary px-0.5 py-0"
                @keydown="onLabelKeydown"
                @blur="saveLabel"
              />
              <UIcon
                v-if="savingLabel"
                name="i-lucide-loader-circle"
                class="size-3.5 text-gray-400 animate-spin shrink-0"
              />
            </template>
            <template v-else>
              <span
                v-if="testRun?.label"
                class="font-normal text-gray-500 ml-1.5 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 border-b border-dashed border-transparent hover:border-gray-400"
                @click="startEditLabel"
                >— {{ testRun.label }}</span
              >
              <button
                v-else
                class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border-b border-dashed border-transparent hover:border-gray-400 ml-1"
                title="Add a label"
                @click="startEditLabel"
              >
                + label
              </button>
            </template>
          </span>
          <UBadge
            v-if="testRun?.shardTotal && testRun.shardTotal > 1"
            color="neutral"
            variant="soft"
            size="sm"
            class="shrink-0"
            :title="`Shard ${testRun.shardsFinished ?? 0}/${testRun.shardTotal}`"
          >
            <UIcon name="i-lucide-layout-grid" class="size-3 mr-1" />
            {{ testRun.shardsFinished ?? 0 }}/{{ testRun.shardTotal }}
          </UBadge>
        </div>
        <div class="flex items-center gap-3 shrink-0 max-sm:hidden">
          <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
            T:
            <strong class="text-gray-700 dark:text-gray-300">{{
              displayProgress?.totalTests ?? testRun?.totalTests ?? 0
            }}</strong>
          </span>
          <span class="text-xs text-green-600 dark:text-green-400 tabular-nums whitespace-nowrap">
            P: <strong>{{ displayProgress?.passedTests ?? testRun?.passedTests ?? 0 }}</strong>
          </span>
          <span class="text-xs text-red-600 dark:text-red-400 tabular-nums whitespace-nowrap">
            F: <strong>{{ displayProgress?.failedTests ?? testRun?.failedTests ?? 0 }}</strong>
          </span>
          <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
            S: <strong>{{ displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0 }}</strong>
          </span>
          <span
            class="text-xs text-amber-600 dark:text-amber-400 tabular-nums whitespace-nowrap"
            title="Tests that never ran (maxFailures cutoff or a serial-group failure)"
          >
            DNR: <strong>{{ testRun?.didNotRunTests ?? 0 }}</strong>
          </span>
          <span class="text-xs text-orange-600 dark:text-orange-400 tabular-nums whitespace-nowrap">
            Fl: <strong>{{ testRun?.flakyTests ?? 0 }}</strong>
          </span>
          <TestStatusBar
            :passed="displayProgress?.passedTests ?? testRun?.passedTests ?? 0"
            :failed="displayProgress?.failedTests ?? testRun?.failedTests ?? 0"
            :skipped="displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0"
            :flaky="testRun?.flakyTests ?? 0"
            :did-not-run="testRun?.didNotRunTests ?? 0"
            :total="displayProgress?.totalTests ?? testRun?.totalTests ?? 0"
          />
          <DurationValue :ms="testRun?.duration" class="text-xs text-gray-400" />
        </div>
      </div>
    </template>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div :class="summaryColSpanClass">
        <UCard class="shadow-xs h-full">
          <div class="space-y-3">
            <div class="flex items-start gap-3">
              <div class="flex items-center gap-2.5 min-w-0 flex-1">
                <StatusBlock :status="testRun?.status ?? ''" size="md" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <h2 class="text-base font-bold shrink-0 flex items-center gap-1">
                      Run #{{ testRun?.id }}
                      <template v-if="editingLabel">
                        <input
                          ref="labelInputRef"
                          v-model="labelInput"
                          type="text"
                          placeholder="Add a label..."
                          class="inline-block w-48 text-sm font-normal border-b border-dashed border-gray-400 bg-transparent outline-none focus:border-primary px-0.5 py-0"
                          @keydown="onLabelKeydown"
                          @blur="saveLabel"
                        />
                        <UIcon
                          v-if="savingLabel"
                          name="i-lucide-loader-circle"
                          class="size-3.5 text-gray-400 animate-spin shrink-0"
                        />
                      </template>
                      <template v-else>
                        <span
                          v-if="testRun?.label"
                          class="font-normal text-gray-500 ml-1.5 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 border-b border-dashed border-transparent hover:border-gray-400"
                          @click="startEditLabel"
                          >— {{ testRun.label }}</span
                        >
                        <button
                          v-else
                          class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border-b border-dashed border-transparent hover:border-gray-400 ml-1.5"
                          title="Add a label"
                          @click="startEditLabel"
                        >
                          + label
                        </button>
                      </template>
                      <HelpHint topic="run.summary" />
                    </h2>
                    <UBadge
                      v-if="testRun?.shardTotal && testRun.shardTotal > 1"
                      color="neutral"
                      variant="soft"
                      size="sm"
                      class="shrink-0"
                      :title="`Shard ${testRun.shardsFinished ?? 0}/${testRun.shardTotal}`"
                    >
                      <UIcon name="i-lucide-layout-grid" class="size-3 mr-1" />
                      {{ testRun.shardsFinished ?? 0 }}/{{ testRun.shardTotal }}
                    </UBadge>
                    <UTooltip
                      v-if="testRun?.precedingMarker"
                      :text="`This run started after: ${testRun.precedingMarker.label}`"
                    >
                      <NuxtLink
                        :to="`/projects/${testRun.projectId}?tab=timeline`"
                        class="shrink-0 inline-flex items-center gap-1"
                      >
                        <span class="text-xs text-muted">After</span>
                        <MarkerBadge :marker="testRun.precedingMarker" size="xs" />
                      </NuxtLink>
                    </UTooltip>
                    <span class="text-xs text-gray-500 ml-auto whitespace-nowrap">
                      {{ testRun?.project?.label ?? testRun?.project?.name }} · Started
                      {{ prettyDateFormat(testRun?.startTime) }}
                    </span>
                    <UTooltip :text="copied ? 'Copied!' : 'Copy run summary'">
                      <UButton
                        size="xs"
                        variant="ghost"
                        color="neutral"
                        :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                        class="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        @click="copy(buildRunSummary(), { toast: 'Run summary copied' })"
                      />
                    </UTooltip>
                    <UPopover v-if="failedCases.length > 0">
                      <UButton
                        size="xs"
                        color="warning"
                        variant="subtle"
                        :icon="retryCopied ? 'i-lucide-check' : 'i-lucide-play'"
                        :title="retryTitle"
                        @click="copyRetryCommand()"
                      >
                        Retry
                      </UButton>
                      <template #content>
                        <div class="p-2 space-y-1 min-w-32">
                          <p class="text-xs font-medium text-gray-500 px-2 py-1">Mode</p>
                          <button
                            v-for="m in ['file-line', 'grep', 'file'] as RetryMode[]"
                            :key="m"
                            class="w-full text-left px-2 py-1 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                            :class="retryMode === m ? 'bg-primary/10 text-primary' : ''"
                            @click="retryMode = m"
                          >
                            {{ m === 'file-line' ? 'File:line' : m === 'grep' ? 'Title (grep)' : 'File only' }}
                          </button>
                        </div>
                      </template>
                    </UPopover>
                  </div>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <button
                class="rounded-lg p-3 text-left w-full transition-colors cursor-pointer"
                :class="
                  activeFilter === 'all'
                    ? 'bg-accented ring-2 ring-zinc-400 dark:ring-zinc-500'
                    : 'bg-elevated/60 hover:bg-elevated'
                "
                @click="emit('filter-status', 'all')"
              >
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Total</p>
                <p class="text-xl font-bold mt-0.5">
                  {{ displayProgress?.totalTests ?? testRun?.totalTests ?? 0 }}
                </p>
              </button>
              <!-- Passed cell hosts the flaky count as a corner badge: flaky tests are
                   a subset of passed (they passed on retry), so they live "inside" Passed
                   instead of taking their own column. Sibling buttons (not nested) keep the
                   markup valid while giving each its own filter click + active highlight. -->
              <div class="relative">
                <button
                  class="rounded-lg p-3 text-left w-full h-full transition-colors cursor-pointer"
                  :class="
                    activeFilter === 'passed'
                      ? 'bg-green-100 dark:bg-green-900/30 ring-2 ring-green-400 dark:ring-green-600'
                      : 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30'
                  "
                  @click="emit('filter-status', 'passed')"
                >
                  <p class="text-xs font-medium text-green-700 dark:text-green-400 uppercase tracking-wider">Passed</p>
                  <p class="text-xl font-bold mt-0.5 text-green-600 dark:text-green-400">
                    {{ displayProgress?.passedTests ?? testRun?.passedTests ?? 0 }}
                  </p>
                </button>
                <button
                  v-if="(testRun?.flakyTests ?? 0) > 0"
                  class="absolute top-1.5 right-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums transition-colors cursor-pointer"
                  :class="
                    activeFilter === 'flaky'
                      ? 'bg-orange-200 dark:bg-orange-800/60 text-orange-800 dark:text-orange-200 ring-2 ring-orange-400 dark:ring-orange-600'
                      : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-800/60'
                  "
                  title="Flaky — passed only after a retry (a subset of passed). Click to filter."
                  @click="emit('filter-status', 'flaky')"
                >
                  <UIcon name="i-lucide-shuffle" class="size-3" />
                  {{ testRun?.flakyTests ?? 0 }}
                </button>
              </div>
              <button
                class="rounded-lg p-3 text-left w-full transition-colors cursor-pointer"
                :class="
                  activeFilter === 'failed'
                    ? 'bg-red-100 dark:bg-red-900/30 ring-2 ring-red-400 dark:ring-red-600'
                    : 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                "
                @click="emit('filter-status', 'failed')"
              >
                <p class="text-xs font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">Failed</p>
                <p class="text-xl font-bold mt-0.5 text-red-600 dark:text-red-400">
                  {{ displayProgress?.failedTests ?? testRun?.failedTests ?? 0 }}
                </p>
              </button>
              <button
                class="rounded-lg p-3 text-left w-full transition-colors cursor-pointer"
                :class="
                  activeFilter === 'skipped'
                    ? 'bg-accented ring-2 ring-zinc-400 dark:ring-zinc-500'
                    : 'bg-elevated/60 hover:bg-elevated'
                "
                @click="emit('filter-status', 'skipped')"
              >
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Skipped</p>
                <p class="text-xl font-bold mt-0.5 text-gray-600 dark:text-gray-400">
                  {{ displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0 }}
                </p>
              </button>
              <button
                class="rounded-lg p-3 text-left w-full transition-colors cursor-pointer"
                :class="
                  activeFilter === 'didnotrun'
                    ? 'bg-amber-100 dark:bg-amber-900/30 ring-2 ring-amber-400 dark:ring-amber-600'
                    : 'bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                "
                title="Tests that never ran (maxFailures cutoff or a serial-group failure)"
                @click="emit('filter-status', 'didnotrun')"
              >
                <p class="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                  Didn't run
                </p>
                <p class="text-xl font-bold mt-0.5 text-amber-600 dark:text-amber-400">
                  {{ testRun?.didNotRunTests ?? 0 }}
                </p>
              </button>
            </div>

            <div>
              <div v-if="testRun" class="flex items-center gap-3">
                <div class="flex-1 max-w-md">
                  <TestStatusBar
                    :passed="displayProgress?.passedTests ?? testRun?.passedTests ?? 0"
                    :failed="displayProgress?.failedTests ?? testRun?.failedTests ?? 0"
                    :skipped="displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0"
                    :flaky="testRun?.flakyTests ?? 0"
                    :did-not-run="testRun?.didNotRunTests ?? 0"
                    :total="displayProgress?.totalTests ?? testRun?.totalTests ?? 0"
                  />
                </div>
                <div class="flex items-center gap-3 text-xs shrink-0">
                  <div class="flex items-center gap-1">
                    <UIcon name="i-lucide-clock" class="size-3.5 text-gray-400" />
                    <DurationValue :ms="testRun?.duration" class="font-medium" />
                  </div>
                  <div v-if="testRun?.avgTestDuration" class="flex items-center gap-1">
                    <UIcon name="i-lucide-gauge" class="size-3.5 text-gray-400" />
                    <span class="text-gray-500 hidden sm:inline">Avg</span>
                    <DurationValue :ms="testRun.avgTestDuration" class="font-medium" />
                  </div>
                  <div v-if="testRun?.p90TestDuration" class="flex items-center gap-1">
                    <UIcon name="i-lucide-arrow-up-right" class="size-3.5 text-orange-500" />
                    <span class="text-gray-500 hidden sm:inline">P90</span>
                    <DurationValue
                      :ms="testRun.p90TestDuration"
                      class="font-medium text-orange-600 dark:text-orange-400"
                      unit-class="opacity-60"
                    />
                  </div>
                  <div v-if="totalWastedTime && totalWastedTime > 0" class="flex items-center gap-1">
                    <UIcon name="i-lucide-clock" class="size-3.5 text-amber-500" />
                    <span class="text-gray-500 hidden sm:inline">Wasted</span>
                    <DurationValue
                      :ms="totalWastedTime"
                      class="font-medium text-amber-600 dark:text-amber-400"
                      unit-class="opacity-60"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <!-- Block 1: CI + Environment + Tooling versions -->
      <CiEnvCard
        v-if="showCiEnv"
        :ci="testRun?.metadata?.ci"
        :environment="testRun?.environment"
        :playwright-version="testRun?.playwrightVersion"
        :reporter-version="testRun?.reporterVersion"
        :class="blockColSpanClass"
      />

      <!-- Block 2: Source control -->
      <SourceInfoCard v-if="showSource" :scm="testRun.metadata.scm" :class="blockColSpanClass" />

      <!-- Block 3: Storage stats -->
      <BlockCard
        v-if="showStorage"
        :class="blockColSpanClass"
        title="Storage"
        icon="i-lucide-database"
        help="run.reports"
        :subtitle="
          storageStats?.totalFiles
            ? `${storageStats.totalFiles} files · ${formatBytes(storageStats.totalSize)}`
            : undefined
        "
      >
        <div v-if="finalizing" class="flex items-center gap-3">
          <UIcon name="i-lucide-upload" class="size-5 text-info shrink-0 animate-pulse" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm font-medium">Finalizing test run</span>
              <span class="text-xs text-gray-500">Uploading reports &amp; traces…</span>
            </div>
            <UProgress :value="null" size="sm" color="info" class="rounded-full animate-pulse" />
          </div>
        </div>
        <div v-if="storageStats?.totalFiles" class="space-y-1.5 text-sm">
          <div v-for="report in allReports" :key="report.label" class="flex items-center justify-between gap-2 min-w-0">
            <UButton
              :href="`/api/files/${getFileApiPath(report.path)}`"
              :icon="reportIcon(report.type)"
              target="_blank"
              size="xs"
              variant="outline"
              class="min-w-0"
              :ui="{ label: 'truncate' }"
            >
              {{ report.label }}
            </UButton>
            <span class="text-xs tabular-nums text-gray-400 dark:text-gray-500 shrink-0">{{
              formatBytes(report.size)
            }}</span>
          </div>
          <div v-if="storageStats.testCaseFilesCount > 0" class="flex items-center justify-between gap-2 min-w-0">
            <span class="truncate">Test files ({{ storageStats.testCaseFilesCount }})</span>
            <span class="text-xs tabular-nums text-gray-400 dark:text-gray-500 shrink-0">{{
              formatBytes(storageStats.testCaseFilesSize)
            }}</span>
          </div>
        </div>
      </BlockCard>

      <!-- Block 4: Tags / Details / Custom data -->
      <BlockCard v-if="showOther" :class="blockColSpanClass" title="Other" icon="i-lucide-tags" help="run.metadata">
        <div class="space-y-3 text-sm">
          <div v-if="testRun.metadata.tags && testRun.metadata.tags.length > 0">
            <div class="flex flex-wrap gap-1.5">
              <UBadge v-for="tag in testRun.metadata.tags" :key="tag" color="neutral" variant="soft" size="sm">
                {{ tag }}
              </UBadge>
            </div>
          </div>
          <p v-if="testRun.metadata.relatedIssue" class="flex items-center gap-1">
            <UIcon name="i-lucide-link" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span>{{ testRun.metadata.relatedIssue }}</span>
          </p>
          <EntityLinks
            entity-type="test_run"
            :entity-id="testRun.id"
            :links="testRun.links ?? null"
            @updated="$emit('label-updated')"
          />
          <UButton
            v-if="testRun.metadata.customData"
            size="xs"
            variant="ghost"
            color="neutral"
            :icon="showCustomData ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            @click="emit('update:showCustomData', !showCustomData)"
          >
            Custom data
          </UButton>
          <div v-if="showCustomData && testRun.metadata.customData">
            <div
              class="bg-gray-50 dark:bg-gray-900 p-2.5 rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto"
            >
              <pre class="m-0">{{ JSON.stringify(testRun.metadata.customData, null, 2) }}</pre>
            </div>
          </div>
        </div>
      </BlockCard>
    </div>
  </FoldableSummary>
</template>
