<script setup lang="ts">
/**
 * The whole-test step list: every step Playwright ran, with its category,
 * duration, share of the test and a bar (a waterfall when the reporter recorded
 * step start times, else left-aligned magnitude). A failed step is highlighted
 * with its error; the single slowest step is tagged.
 */
import type { PerformanceStep } from '~~/types/api';
import type { TableColumn } from '@nuxt/ui';

const props = defineProps<{
  steps: PerformanceStep[];
  /** The execution's total duration, for the per-step share of the test. */
  durationMs: number | null;
  /** Execution status — a did-not-run row shows a neutral step marker. */
  status?: string | null;
  /** Piwi project id/name, threaded into `OpenInIdeLink` for workspace overrides. */
  projectKey?: number | string | null;
  projectName?: string | null;
}>();

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

// Per-category rollup for the summary strip above the table. Durations are summed
// over the flat step list (parents include their children), matching how the
// reporter's StepMetrics already reports navigation/wait totals.
const stepSummary = computed(() => {
  const byCat = new Map<string, { count: number; duration: number }>();
  for (const s of props.steps) {
    const entry = byCat.get(s.category) ?? { count: 0, duration: 0 };
    entry.count += 1;
    entry.duration += s.duration || 0;
    byCat.set(s.category, entry);
  }
  return Array.from(byCat, ([category, v]) => ({ category, ...v })).sort((a, b) => b.duration - a.duration);
});

// Row index of the single slowest step, used to tag that row. All-zero durations
// (a test that never ran) must not tag row 0 as "slowest".
const slowestStepIndex = computed(() => {
  let idx = -1;
  let max = -1;
  props.steps.forEach((s, i) => {
    if ((s.duration || 0) > max) {
      max = s.duration || 0;
      idx = i;
    }
  });
  return max > 0 ? idx : -1;
});

const maxStepDuration = computed(() => props.steps.reduce((m, s) => Math.max(m, s.duration || 0), 0));

// A true waterfall needs a startTime on every step (only runs from a recent
// reporter carry one); otherwise the bars fall back to left-aligned magnitude.
const hasStepTimings = computed(
  () => props.steps.length > 0 && props.steps.every((s) => typeof s.startTime === 'number'),
);
const timelineStart = computed(() =>
  hasStepTimings.value ? Math.min(...props.steps.map((s) => s.startTime as number)) : 0,
);
const timelineDuration = computed(() => {
  const total = props.durationMs ?? 0;
  if (total > 0) return total;
  if (hasStepTimings.value) {
    const end = Math.max(...props.steps.map((s) => (s.startTime as number) + (s.duration || 0)));
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
  const total = props.durationMs ?? 0;
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
</script>

<template>
  <div class="space-y-3">
    <UAlert
      v-if="isFailedStatus(status ?? '') && steps.length > 0 && !steps.some((s) => s.failed)"
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
              v-if="status === 'didnotrun'"
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
              :project-key="projectKey ?? undefined"
              :project-name="projectName ?? undefined"
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
