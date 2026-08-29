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
  /** The active status filters, shared with the test-cases list's chips. */
  activeStatuses: string[];
  totalWastedTime?: number;
}>();

const emit = defineEmits<{
  'update:showCustomData': [value: boolean];
  'toggle-status': [value: string];
  'label-updated': [];
}>();

const toast = useToast();
const config = useRuntimeConfig();
const storageStats = computed(() => props.testRun?.storageStats);

const ci = computed(() => props.testRun?.metadata?.ci);
const scm = computed(() => props.testRun?.metadata?.scm);
const tags = computed(() => props.testRun?.metadata?.tags as string[] | undefined);
const customData = computed(() => props.testRun?.metadata?.customData);

const showCiGroup = computed(() => !!(ci.value || props.testRun?.environment));
const showVersions = computed(() => !!(props.testRun?.playwrightVersion || props.testRun?.reporterVersion));
const showStorage = computed(() => !!(storageStats.value?.totalFiles || props.finalizing));

// The first uploaded report is the run's headline artifact, promoted to a
// primary action; the full list stays in the storage popover.
const primaryReport = computed(() => props.allReports[0] ?? null);

const { copy, copied } = useCopy();
const retryMode = ref<RetryMode>('file-line');
const retryCopied = ref(false);

// Inside the desktop shell the run-locally split button covers copying the
// command ("Copy as command"), so the copy-only Retry button stays web-only.
const desktopBridge = ref(false);
onMounted(() => {
  desktopBridge.value = !!tauriCore();
});

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
          <StatusChip :status="testRun?.status ?? ''" size="sm" />
          <span class="text-sm font-semibold truncate flex items-center gap-1">
            Run #{{ testRun?.id }}
            <template v-if="editingLabel">
              <input
                ref="labelInputRef"
                v-model="labelInput"
                type="text"
                placeholder="Add a label..."
                class="inline-block w-40 text-sm font-normal border-b border-dashed border-zinc-400 bg-transparent outline-none focus:border-primary px-0.5 py-0"
                @keydown="onLabelKeydown"
                @blur="saveLabel"
              />
              <UIcon
                v-if="savingLabel"
                name="i-lucide-loader-circle"
                class="size-3.5 text-zinc-400 animate-spin shrink-0"
              />
            </template>
            <template v-else>
              <span
                v-if="testRun?.label"
                role="button"
                tabindex="0"
                class="font-normal text-zinc-500 ml-1.5 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 border-b border-dashed border-transparent hover:border-zinc-400"
                @click.stop="startEditLabel"
                @keydown.enter.stop="startEditLabel"
                >— {{ testRun.label }}</span
              >
              <button
                v-else
                class="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 border-b border-dashed border-transparent hover:border-zinc-400 ml-1"
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
          <span class="text-xs text-zinc-500 tabular-nums whitespace-nowrap">
            T:
            <strong class="text-zinc-700 dark:text-zinc-300">{{
              displayProgress?.totalTests ?? testRun?.totalTests ?? 0
            }}</strong>
          </span>
          <span class="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums whitespace-nowrap">
            P: <strong>{{ displayProgress?.passedTests ?? testRun?.passedTests ?? 0 }}</strong>
          </span>
          <span class="text-xs text-rose-600 dark:text-rose-400 tabular-nums whitespace-nowrap">
            F: <strong>{{ displayProgress?.failedTests ?? testRun?.failedTests ?? 0 }}</strong>
          </span>
          <span class="text-xs text-zinc-500 tabular-nums whitespace-nowrap">
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
          <DurationValue :ms="testRun?.duration" class="text-xs text-zinc-400" />
        </div>
      </div>
    </template>
    <div class="@container">
      <UCard class="shadow-xs" :ui="{ footer: 'px-4 py-2.5 sm:px-4 bg-muted/30' }">
        <div class="space-y-3">
          <!-- Identity row: verdict + title + start time on the left, actions on
               the right. The right padding keeps the fold chevron clear. -->
          <div class="flex items-start justify-between gap-x-3 gap-y-2 flex-wrap pr-8">
            <div class="min-w-0 flex-1 basis-64">
              <div class="flex items-center gap-2 flex-wrap">
                <StatusChip :status="testRun?.status ?? ''" />
                <HelpHint
                  v-if="testRun?.status === 'interrupted' || (testRun?.shardTotal && testRun.shardTotal > 1)"
                  topic="run.partial"
                />
                <h2 class="text-base font-bold shrink-0 flex items-center gap-1">
                  Run #{{ testRun?.id }}
                  <template v-if="editingLabel">
                    <input
                      ref="labelInputRef"
                      v-model="labelInput"
                      type="text"
                      placeholder="Add a label..."
                      class="inline-block w-48 text-sm font-normal border-b border-dashed border-zinc-400 bg-transparent outline-none focus:border-primary px-0.5 py-0"
                      @keydown="onLabelKeydown"
                      @blur="saveLabel"
                    />
                    <UIcon
                      v-if="savingLabel"
                      name="i-lucide-loader-circle"
                      class="size-3.5 text-zinc-400 animate-spin shrink-0"
                    />
                  </template>
                  <template v-else>
                    <span
                      v-if="testRun?.label"
                      class="font-normal text-zinc-500 ml-1.5 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 border-b border-dashed border-transparent hover:border-zinc-400"
                      @click="startEditLabel"
                      >— {{ testRun.label }}</span
                    >
                    <button
                      v-else
                      class="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 border-b border-dashed border-transparent hover:border-zinc-400 ml-1.5"
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
              </div>
              <p class="mt-1 text-xs text-muted flex items-center gap-1.5 flex-wrap">
                <ClientOnly>
                  <span :title="prettyDateFormat(testRun?.startTime)">
                    Started {{ formatRelativeTime(testRun?.startTime) }}
                  </span>
                </ClientOnly>
                <template v-if="testRun?.shardTotal && testRun.shardTotal > 1">
                  <span class="text-dimmed">·</span>
                  <HelpHint topic="run.partial" />
                </template>
              </p>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <UTooltip :text="copied ? 'Copied!' : 'Copy run summary'">
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                  aria-label="Copy run summary"
                  class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  @click="copy(buildRunSummary(), { toast: 'Run summary copied' })"
                />
              </UTooltip>
              <UPopover v-if="failedCases.length > 0 && !desktopBridge">
                <UButton
                  size="xs"
                  color="warning"
                  variant="subtle"
                  :icon="retryCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                  :title="retryTitle"
                  aria-label="Copy retry command"
                  @click="copyRetryCommand()"
                >
                  <span class="hidden @2xl:inline">Copy retry command</span>
                </UButton>
                <template #content>
                  <div class="p-2 space-y-1 min-w-32">
                    <p class="text-xs font-medium text-zinc-500 px-2 py-1">Mode</p>
                    <button
                      v-for="m in ['file-line', 'grep', 'file'] as RetryMode[]"
                      :key="m"
                      class="w-full text-left px-2 py-1 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      :class="retryMode === m ? 'bg-primary/10 text-primary' : ''"
                      @click="retryMode = m"
                    >
                      {{ m === 'file-line' ? 'File:line' : m === 'grep' ? 'Title (grep)' : 'File only' }}
                    </button>
                  </div>
                </template>
              </UPopover>
              <DesktopRunLocallyButton
                v-if="failedCases.length > 0"
                :project-id="testRun?.project?.id"
                :project-label="testRun?.project?.label ?? testRun?.project?.name"
                :cases="failedCases"
              />
              <UButton
                v-if="primaryReport"
                :href="fileApiUrl(primaryReport.path, null, config.app?.baseURL)"
                :icon="reportIcon(primaryReport.type)"
                target="_blank"
                size="xs"
                color="primary"
                variant="outline"
                :aria-label="primaryReport.label"
                :title="
                  primaryReport.size
                    ? `${primaryReport.label} · ${formatBytes(primaryReport.size)}`
                    : primaryReport.label
                "
              >
                <span class="hidden @2xl:inline">{{ primaryReport.label }}</span>
              </UButton>
            </div>
          </div>

          <StatTileGrid min-tile-width="7.5rem">
            <button
              class="rounded-lg p-3 text-left w-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              :class="
                activeStatuses.length === 0
                  ? 'bg-accented ring-2 ring-zinc-400 dark:ring-zinc-500'
                  : 'bg-elevated/60 hover:bg-elevated'
              "
              :aria-pressed="activeStatuses.length === 0"
              :disabled="(displayProgress?.totalTests ?? testRun?.totalTests ?? 0) === 0"
              @click="emit('toggle-status', 'all')"
            >
              <p class="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total</p>
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
                class="rounded-lg p-3 text-left w-full h-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                :class="
                  activeStatuses.includes('passed')
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 ring-2 ring-emerald-400 dark:ring-emerald-600'
                    : 'bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                "
                :aria-pressed="activeStatuses.includes('passed')"
                :disabled="(displayProgress?.passedTests ?? testRun?.passedTests ?? 0) === 0"
                @click="emit('toggle-status', 'passed')"
              >
                <p class="text-xs font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                  Passed
                </p>
                <p class="text-xl font-bold mt-0.5 text-emerald-600 dark:text-emerald-400">
                  {{ displayProgress?.passedTests ?? testRun?.passedTests ?? 0 }}
                </p>
              </button>
              <button
                v-if="(testRun?.flakyTests ?? 0) > 0"
                class="absolute top-1.5 right-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums transition-colors cursor-pointer"
                :class="
                  activeStatuses.includes('flaky')
                    ? 'bg-orange-200 dark:bg-orange-800/60 text-orange-800 dark:text-orange-200 ring-2 ring-orange-400 dark:ring-orange-600'
                    : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-800/60'
                "
                title="Flaky — passed only after a retry (a subset of passed). Click to filter."
                :aria-pressed="activeStatuses.includes('flaky')"
                @click="emit('toggle-status', 'flaky')"
              >
                <UIcon name="i-lucide-shuffle" class="size-3" />
                {{ testRun?.flakyTests ?? 0 }}
              </button>
            </div>
            <button
              class="rounded-lg p-3 text-left w-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              :class="
                activeStatuses.includes('failed')
                  ? 'bg-rose-100 dark:bg-rose-900/30 ring-2 ring-rose-400 dark:ring-rose-600'
                  : 'bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/30'
              "
              :aria-pressed="activeStatuses.includes('failed')"
              :disabled="(displayProgress?.failedTests ?? testRun?.failedTests ?? 0) === 0"
              @click="emit('toggle-status', 'failed')"
            >
              <p class="text-xs font-medium text-rose-700 dark:text-rose-400 uppercase tracking-wider">Failed</p>
              <p class="text-xl font-bold mt-0.5 text-rose-600 dark:text-rose-400">
                {{ displayProgress?.failedTests ?? testRun?.failedTests ?? 0 }}
              </p>
            </button>
            <button
              class="rounded-lg p-3 text-left w-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              :class="
                activeStatuses.includes('skipped')
                  ? 'bg-accented ring-2 ring-zinc-400 dark:ring-zinc-500'
                  : 'bg-elevated/60 hover:bg-elevated'
              "
              :aria-pressed="activeStatuses.includes('skipped')"
              :disabled="(displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0) === 0"
              @click="emit('toggle-status', 'skipped')"
            >
              <p class="text-xs font-medium text-zinc-500 uppercase tracking-wider">Skipped</p>
              <p class="text-xl font-bold mt-0.5 text-zinc-600 dark:text-zinc-400">
                {{ displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0 }}
              </p>
            </button>
            <button
              class="rounded-lg p-3 text-left w-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              :class="
                activeStatuses.includes('didnotrun')
                  ? 'bg-amber-100 dark:bg-amber-900/30 ring-2 ring-amber-400 dark:ring-amber-600'
                  : 'bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30'
              "
              title="Tests that never ran (maxFailures cutoff or a serial-group failure)"
              :aria-pressed="activeStatuses.includes('didnotrun')"
              :disabled="(testRun?.didNotRunTests ?? 0) === 0"
              @click="emit('toggle-status', 'didnotrun')"
            >
              <p class="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wider">Didn't run</p>
              <p class="text-xl font-bold mt-0.5 text-amber-600 dark:text-amber-400">
                {{ testRun?.didNotRunTests ?? 0 }}
              </p>
            </button>
          </StatTileGrid>

          <div v-if="testRun" class="flex items-center gap-x-4 gap-y-1.5 flex-wrap">
            <div class="flex-1 basis-60 min-w-44 max-w-xl">
              <TestStatusBar
                :passed="displayProgress?.passedTests ?? testRun?.passedTests ?? 0"
                :failed="displayProgress?.failedTests ?? testRun?.failedTests ?? 0"
                :skipped="displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0"
                :flaky="testRun?.flakyTests ?? 0"
                :did-not-run="testRun?.didNotRunTests ?? 0"
                :total="displayProgress?.totalTests ?? testRun?.totalTests ?? 0"
              />
            </div>
            <div class="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs shrink-0">
              <div class="flex items-center gap-1">
                <UIcon name="i-lucide-clock" class="size-3.5 text-zinc-400" />
                <span class="text-zinc-500">Duration</span>
                <DurationValue :ms="testRun?.duration" class="font-medium" />
              </div>
              <div v-if="testRun?.avgTestDuration" class="flex items-center gap-1">
                <UIcon name="i-lucide-gauge" class="size-3.5 text-zinc-400" />
                <span class="text-zinc-500">Avg</span>
                <DurationValue :ms="testRun.avgTestDuration" class="font-medium" />
              </div>
              <div v-if="testRun?.p90TestDuration" class="flex items-center gap-1">
                <UIcon name="i-lucide-arrow-up-right" class="size-3.5 text-orange-500" />
                <span class="text-zinc-500">P90</span>
                <DurationValue
                  :ms="testRun.p90TestDuration"
                  class="font-medium text-orange-600 dark:text-orange-400"
                  unit-class="opacity-60"
                />
              </div>
              <div
                v-if="totalWastedTime && totalWastedTime > 0"
                class="flex items-center gap-1"
                title="Wasted in fixed waits"
              >
                <UIcon name="i-lucide-clock" class="size-3.5 text-amber-500" />
                <span class="text-zinc-500">Wasted</span>
                <DurationValue
                  :ms="totalWastedTime"
                  class="font-medium text-amber-600 dark:text-amber-400"
                  unit-class="opacity-60"
                />
              </div>
            </div>
          </div>
        </div>

        <template #footer>
          <SummaryMetaStrip>
            <MetaStripGroup v-if="showCiGroup" label="CI & environment" icon="i-lucide-cloud" help="run.ci-env">
              <span
                v-if="testRun?.environment"
                class="rounded-full border border-default px-2 py-0.5 text-xs bg-elevated/60"
                >{{ testRun.environment }}</span
              >
              <span v-if="ci?.provider">{{ ci.provider }}</span>
              <template v-if="ci?.buildNumber || ci?.buildUrl">
                <span class="text-dimmed">·</span>
                <a v-if="ci?.buildUrl" :href="ci.buildUrl" target="_blank" class="text-primary hover:underline">{{
                  ci?.buildNumber ? `Build #${ci.buildNumber}` : 'View build'
                }}</a>
                <span v-else>Build #{{ ci.buildNumber }}</span>
              </template>
              <template v-if="ci?.workflow || ci?.jobName">
                <span class="text-dimmed">·</span>
                <span class="text-muted">
                  <template v-if="ci?.workflow">{{ ci.workflow }}</template>
                  <template v-if="ci?.workflow && ci?.jobName"> · </template>
                  <template v-if="ci?.jobName">{{ ci.jobName }}</template>
                </span>
              </template>
            </MetaStripGroup>

            <MetaStripGroup v-if="scm" label="Source" icon="i-lucide-git-branch">
              <span v-if="scm.branch" class="font-medium">{{ scm.branch }}</span>
              <code
                v-if="scm.commit"
                class="text-xs font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded"
                :title="scm.commit"
                >{{ scm.commit.length >= 8 ? scm.commit.substring(0, 8) : scm.commit }}</code
              >
              <span v-if="scm.author" class="text-muted">{{ scm.author }}</span>
              <span
                v-if="scm.commitMessage"
                class="text-xs text-dimmed truncate max-w-[40ch]"
                :title="scm.commitMessage"
                >{{ scm.commitMessage }}</span
              >
            </MetaStripGroup>

            <MetaStripGroup v-if="showVersions" label="Tooling versions" icon="i-lucide-tag">
              <span class="text-muted whitespace-nowrap">
                <template v-if="testRun?.playwrightVersion">Playwright v{{ testRun.playwrightVersion }}</template>
                <template v-if="testRun?.playwrightVersion && testRun?.reporterVersion"> · </template>
                <template v-if="testRun?.reporterVersion">Piwi v{{ testRun.reporterVersion }}</template>
              </span>
            </MetaStripGroup>

            <MetaStripGroup v-if="tags?.length" label="Tags" icon="i-lucide-tags">
              <UBadge v-for="tag in tags" :key="tag" color="neutral" variant="soft" size="sm">
                {{ tag }}
              </UBadge>
            </MetaStripGroup>

            <MetaStripGroup v-if="testRun?.metadata?.relatedIssue" label="Related issue" icon="i-lucide-bookmark">
              <span class="text-muted">{{ testRun.metadata.relatedIssue }}</span>
            </MetaStripGroup>

            <MetaStripGroup v-if="showStorage" label="Storage">
              <RunStorageChip :storage-stats="storageStats" :reports="allReports" :finalizing="finalizing" />
            </MetaStripGroup>

            <MetaStripGroup label="Links" icon="i-lucide-link" help="run.metadata">
              <EntityLinks
                entity-type="test_run"
                :entity-id="testRun.id"
                :links="testRun.links ?? null"
                @updated="$emit('label-updated')"
              />
            </MetaStripGroup>

            <MetaStripGroup v-if="customData" label="Custom data">
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                :icon="showCustomData ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                @click="emit('update:showCustomData', !showCustomData)"
              >
                Custom data
              </UButton>
            </MetaStripGroup>
          </SummaryMetaStrip>
          <div v-if="showCustomData && customData" class="mt-2">
            <div
              class="bg-zinc-50 dark:bg-zinc-900 p-2.5 rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto"
            >
              <pre class="m-0">{{ JSON.stringify(customData, null, 2) }}</pre>
            </div>
          </div>
        </template>
      </UCard>
    </div>
  </FoldableSummary>
</template>
