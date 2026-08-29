<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TableColumn } from '@nuxt/ui';
import type { TestRunDetails, ProjectWithTestRuns, MarkerInfo, MarkersResponse } from '~~/types/api';
import type { ComparisonRow } from '~/composables/useRunComparison';

interface RunOption {
  label: string;
  value: number;
  status: string;
  startTime: number;
}

const props = defineProps<{
  testRun: TestRunDetails | null | undefined;
}>();

const route = useRoute();
const runId = route.params.id;

const projectData = ref<ProjectWithTestRuns | null>(null);
const markers = ref<MarkerInfo[]>([]);

// Live while running or finalizing — matches the run page's definition so the
// compare view doesn't render against an unfinished run during the upload phase.
const isLive = computed(() => props.testRun?.status === 'running' || props.testRun?.status === 'finalizing');

// Fetch the project's run list for the baseline dropdown. Skipped while live.
watch(
  () => props.testRun?.projectId,
  async (projectId) => {
    if (!projectId || isLive.value) return;
    try {
      projectData.value = await $fetch<ProjectWithTestRuns>(`/api/projects/${projectId}`);
    } catch (e) {
      console.error('Failed to fetch project for RunCompare', e);
    }
    try {
      const res = await $fetch<MarkersResponse>(`/api/projects/${projectId}/markers`);
      markers.value = res.items ?? [];
    } catch {
      // markers are optional context; ignore fetch errors
    }
  },
  { immediate: true },
);

// Timeline markers that fall between the two compared runs — surfaced as a hint
// that something (a deploy, config change, ...) changed between them.
const markersBetween = computed<MarkerInfo[]>(() => {
  if (!baselineRun.value || !props.testRun) return [];
  const t1 = new Date(baselineRun.value.startTime).getTime();
  const t2 = new Date(props.testRun.startTime).getTime();
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  const envs = new Set(
    [baselineRun.value.environment, props.testRun.environment].filter((e): e is string => e != null),
  );
  return markers.value.filter((m) => {
    const t = new Date(m.occurredAt).getTime();
    if (t <= lo || t >= hi) return false;
    return m.environment == null || envs.has(m.environment);
  });
});

function runToOption(r: { id: number; startTime: string | Date; status: string }): RunOption {
  return {
    label: `Run #${r.id} — ${prettyDateFormat(r.startTime, { dateOnly: true })} (${r.status})`,
    value: r.id,
    status: r.status,
    startTime: new Date(r.startTime).getTime(),
  };
}

// The documented baseline: the most recent passing run *before* this one,
// chosen from the full project history rather than the capped dropdown, so a
// historical run with many newer runs still finds its baseline. Falls back to
// the run immediately before this one. Restricting to earlier start times keeps
// a historical run from comparing against a pass that happened after it.
const defaultBaselineOption = computed<RunOption | null>(() => {
  const runs = projectData.value?.testRuns;
  if (!runs || !props.testRun) return null;
  const currentStart = new Date(props.testRun.startTime).getTime();
  const earlier = runs
    .filter((r) => r.id !== Number(runId) && new Date(r.startTime).getTime() < currentStart)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  const pick = earlier.find((r) => r.status === 'passed') ?? earlier[0];
  return pick ? runToOption(pick) : null;
});

const projectRunOptions = computed<RunOption[]>(() => {
  const runs = projectData.value?.testRuns;
  if (!runs) return [];
  const options = runs
    .filter((r) => r.id !== Number(runId))
    .slice(0, 50)
    .map(runToOption);
  // The auto-selected baseline can fall outside the 50 newest on a historical
  // run — keep it in the list so the select shows and can re-pick it.
  const baseline = defaultBaselineOption.value;
  if (baseline && !options.some((o) => o.value === baseline.value)) options.push(baseline);
  return options;
});

// Preselect the baseline once the run list arrives (projectData loads async, so
// this fires on that change), matching it to the in-list option so the select
// renders it as selected.
watch([projectRunOptions, defaultBaselineOption], ([options, baseline]) => {
  if (compareRunA.value || !baseline) return;
  compareRunA.value = options.find((o) => o.value === baseline.value) ?? baseline;
});

const previousRunId = computed<number | null>(() => {
  if (!projectData.value?.testRuns) return null;
  const sorted = [...projectData.value.testRuns].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );
  const currentIdx = sorted.findIndex((r) => r.id === Number(runId));
  if (currentIdx >= 0 && currentIdx < sorted.length - 1) {
    return sorted[currentIdx + 1]!.id;
  }
  return null;
});

const compareRunA = ref<RunOption | undefined>(undefined);
const baselineRun = ref<TestRunDetails | null>(null);
const loadingBaseline = ref(false);

watch(compareRunA, async (opt) => {
  if (!opt?.value) {
    baselineRun.value = null;
    return;
  }
  loadingBaseline.value = true;
  try {
    baselineRun.value = await $fetch<TestRunDetails>(`/api/test-runs/${opt.value}`);
  } catch {
    // ignore
  } finally {
    loadingBaseline.value = false;
  }
});

function compareWithPrevious() {
  if (previousRunId.value) {
    const match = projectRunOptions.value.find((o) => o.value === previousRunId.value);
    if (match) compareRunA.value = match;
  }
}

const currentRunRef = computed<TestRunDetails | null>(() => props.testRun ?? null);
const { comparisonData, comparisonSummary } = useRunComparison(baselineRun, currentRunRef);

const comparisonColumns: TableColumn<ComparisonRow>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<ComparisonRow>('Test case'),
  },
  {
    accessorKey: 'statusA',
    header: createSortHeader<ComparisonRow>('Status A'),
  },
  {
    accessorKey: 'statusB',
    header: createSortHeader<ComparisonRow>('Status B'),
  },
  {
    accessorKey: 'durationA',
    header: createSortHeader<ComparisonRow>('Duration A'),
  },
  {
    accessorKey: 'durationB',
    header: createSortHeader<ComparisonRow>('Duration B'),
  },
  {
    accessorKey: 'delta',
    header: createSortHeader<ComparisonRow>('Delta'),
  },
  {
    accessorKey: 'percentChange',
    header: createSortHeader<ComparisonRow>('Change'),
  },
];
</script>

<template>
  <div>
    <template v-if="testRun && !isLive">
      <div class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" for="compare-baseline-select"
              >Run A (baseline)</label
            >
            <USelectMenu
              id="compare-baseline-select"
              v-model="compareRunA"
              :items="projectRunOptions"
              placeholder="Select a baseline run..."
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run B (this run)</label>
            <div class="flex items-center gap-2 py-1.5">
              <RunStatusBadge :status="testRun.status" />
              <span class="font-medium">#{{ testRun.id }}</span>
            </div>
          </div>
        </div>

        <div v-if="previousRunId" class="flex">
          <UButton
            icon="i-lucide-arrow-left-right"
            size="sm"
            variant="outline"
            label="Compare with previous run"
            @click="compareWithPrevious"
          />
        </div>

        <div v-if="loadingBaseline" class="flex items-center justify-center py-6 text-gray-500 gap-2">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          <span>Loading baseline data...</span>
        </div>

        <UAlert
          v-else-if="markersBetween.length > 0"
          color="warning"
          variant="subtle"
          icon="i-lucide-milestone"
          :title="`${markersBetween.length} timeline marker${markersBetween.length > 1 ? 's' : ''} between these runs`"
        >
          <template #description>
            <div class="flex flex-wrap gap-2 mt-1">
              <MarkerBadge v-for="m in markersBetween" :key="m.id" :marker="m" size="sm" />
            </div>
          </template>
        </UAlert>

        <template v-else-if="baselineRun && comparisonData.length > 0">
          <div class="flex flex-wrap gap-4 text-sm">
            <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">Status</span>
            <UBadge v-if="comparisonSummary.newFailures > 0" color="error" variant="soft" size="lg">
              {{ comparisonSummary.newFailures }} new failure{{ comparisonSummary.newFailures > 1 ? 's' : '' }}
            </UBadge>
            <UBadge v-if="comparisonSummary.recovered > 0" color="success" variant="soft" size="lg">
              {{ comparisonSummary.recovered }} recovered
            </UBadge>
            <UBadge v-if="comparisonSummary.stillFailing > 0" color="warning" variant="soft" size="lg">
              {{ comparisonSummary.stillFailing }} still failing
            </UBadge>
            <span
              v-if="
                comparisonSummary.newFailures === 0 &&
                comparisonSummary.recovered === 0 &&
                comparisonSummary.stillFailing === 0
              "
              class="text-sm text-gray-500"
              >No status changes</span
            >
          </div>
          <div class="flex flex-wrap gap-4 text-sm">
            <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">Duration changes</span>
            <UBadge v-if="comparisonSummary.regressed > 0" color="error" variant="soft" size="lg">
              {{ comparisonSummary.regressed }} regressed
            </UBadge>
            <UBadge v-if="comparisonSummary.improved > 0" color="success" variant="soft" size="lg">
              {{ comparisonSummary.improved }} improved
            </UBadge>
            <UBadge color="neutral" variant="soft" size="lg"> {{ comparisonSummary.unchanged }} unchanged </UBadge>
          </div>

          <TableScroller min-width="48rem" :bleed="false">
            <UTable
              :data="comparisonData"
              :columns="comparisonColumns"
              :ui="{
                base: 'table-fixed border-separate border-spacing-0 min-w-[48rem]',
                thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                tbody: '[&>tr]:last:[&>td]:border-b-0',
                th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                td: 'border-b border-default',
              }"
            >
              <template #statusA-cell="{ row }">
                <span v-if="!row.original.statusA" class="text-gray-400">&mdash;</span>
                <UBadge v-else :color="getStatusColor(row.original.statusA)" variant="subtle" class="capitalize">{{
                  row.original.statusA
                }}</UBadge>
              </template>
              <template #statusB-cell="{ row }">
                <span v-if="!row.original.statusB" class="text-gray-400">&mdash;</span>
                <UBadge v-else :color="getStatusColor(row.original.statusB)" variant="subtle" class="capitalize">{{
                  row.original.statusB
                }}</UBadge>
              </template>
              <template #durationA-cell="{ row }">
                <DurationValue v-if="row.original.durationA !== null" :ms="row.original.durationA" />
                <span v-else class="text-gray-400">&mdash;</span>
              </template>
              <template #durationB-cell="{ row }">
                <DurationValue v-if="row.original.durationB !== null" :ms="row.original.durationB" />
                <span v-else class="text-gray-400">&mdash;</span>
              </template>
              <template #delta-cell="{ row }">
                <span v-if="row.original.delta === null" class="text-gray-400">&mdash;</span>
                <span
                  v-else
                  :class="
                    row.original.delta > 0
                      ? 'text-red-600'
                      : row.original.delta < 0
                        ? 'text-green-600'
                        : 'text-gray-500'
                  "
                >
                  {{ row.original.delta > 0 ? '+' : ''
                  }}<DurationValue :ms="row.original.delta" unit-class="opacity-60" />
                </span>
              </template>
              <template #percentChange-cell="{ row }">
                <span v-if="row.original.percentChange === null" class="text-gray-400">&mdash;</span>
                <span
                  v-else
                  :class="
                    row.original.percentChange > 10
                      ? 'text-red-600 font-medium'
                      : row.original.percentChange < -10
                        ? 'text-green-600 font-medium'
                        : 'text-gray-500'
                  "
                >
                  {{ row.original.percentChange > 0 ? '+' : '' }}{{ row.original.percentChange }}%
                </span>
              </template>
            </UTable>
          </TableScroller>
        </template>

        <EmptyState
          v-else-if="compareRunA && !loadingBaseline"
          icon="i-lucide-git-compare-arrows"
          text="No comparison data available."
        />

        <EmptyState v-else icon="i-lucide-arrow-left-right" text="Select a baseline run to compare." />
      </div>
    </template>
    <div v-else-if="isLive" class="text-center py-10 text-gray-500">
      <UIcon name="i-lucide-git-compare-arrows" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
      <p>Comparison is available after the run finishes.</p>
    </div>
  </div>
</template>
