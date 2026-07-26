<script setup lang="ts">
import type { TestCaseWithStats } from '~~/types/api';

const props = defineProps<{ items: TestCaseWithStats[]; hasFilter: boolean }>();

interface GroupAgg {
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  didNotRun: number;
  total: number;
  cases: number;
}

interface GroupRow {
  kind: 'group';
  depth: number;
  key: string;
  label: string;
  agg: GroupAgg;
}

interface CaseRow {
  kind: 'case';
  depth: number;
  key: string;
  testCase: TestCaseWithStats;
}

type FlatRow = GroupRow | CaseRow;

function suiteSegments(tc: TestCaseWithStats): string[] {
  return (tc.suitePath || '').split('\x1f').filter(Boolean);
}

function aggregate(cases: TestCaseWithStats[]): GroupAgg {
  const agg: GroupAgg = { passed: 0, failed: 0, skipped: 0, flaky: 0, didNotRun: 0, total: 0, cases: cases.length };
  for (const tc of cases) {
    agg.passed += tc.passedRuns;
    agg.failed += tc.failedRuns;
    agg.skipped += tc.skippedRuns;
    agg.flaky += tc.flakyRuns;
    agg.didNotRun += tc.didNotRunRuns;
    agg.total += tc.totalRuns;
  }
  return agg;
}

// Set of collapsed group keys. Everything starts expanded (empty = nothing collapsed).
const collapsedKeys = ref(new Set<string>());

const isAllExpanded = computed(() => collapsedKeys.value.size === 0);

function isExpanded(key: string): boolean {
  if (props.hasFilter) return true;
  return !collapsedKeys.value.has(key);
}

function toggleGroup(key: string): void {
  if (props.hasFilter) return;
  const next = new Set(collapsedKeys.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  collapsedKeys.value = next;
}

function computeAllGroupKeys(): string[] {
  const keys = new Set<string>();
  for (const tc of props.items) {
    keys.add(`file:${tc.filePath}`);
    const segments = suiteSegments(tc);
    for (let i = 1; i <= segments.length; i++) {
      keys.add(`group:${tc.filePath}\x1f${segments.slice(0, i).join('\x1f')}`);
    }
  }
  return [...keys];
}

function collapseAll(): void {
  collapsedKeys.value = new Set(computeAllGroupKeys());
}

function expandAll(): void {
  collapsedKeys.value = new Set();
}

function addLevel(
  rows: FlatRow[],
  cases: TestCaseWithStats[],
  filePath: string,
  parent: string[],
  depth: number,
): void {
  const direct = cases.filter((tc) => suiteSegments(tc).length === parent.length);
  const nested = cases.filter((tc) => suiteSegments(tc).length > parent.length);

  const groups = new Map<string, TestCaseWithStats[]>();
  for (const tc of nested) {
    const segment = suiteSegments(tc)[parent.length]!;
    if (!groups.has(segment)) groups.set(segment, []);
    groups.get(segment)!.push(tc);
  }

  for (const [segment, groupCases] of groups) {
    const groupPath = [...parent, segment];
    const key = `group:${filePath}\x1f${groupPath.join('\x1f')}`;
    rows.push({ kind: 'group', depth, key, label: segment, agg: aggregate(groupCases) });
    if (isExpanded(key)) {
      addLevel(rows, groupCases, filePath, groupPath, depth + 1);
    }
  }

  for (const tc of direct) {
    rows.push({ kind: 'case', depth, key: `case:${tc.id}`, testCase: tc });
  }
}

const flatRows = computed<FlatRow[]>(() => {
  const rows: FlatRow[] = [];

  const byFile = new Map<string, TestCaseWithStats[]>();
  for (const tc of props.items) {
    const filePath = tc.filePath || 'unknown';
    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath)!.push(tc);
  }

  for (const [filePath, fileCases] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const key = `file:${filePath}`;
    rows.push({ kind: 'group', depth: 0, key, label: filePath, agg: aggregate(fileCases) });
    if (isExpanded(key)) {
      addLevel(rows, fileCases, filePath, [], 1);
    }
  }

  return rows;
});
</script>

<template>
  <div class="rounded-lg border border-default text-sm">
    <!-- Toolbar: collapse/expand all -->
    <div class="flex items-center justify-end px-3 py-1.5 border-b border-default bg-elevated">
      <button
        class="flex items-center gap-1 text-xs transition-colors"
        :class="hasFilter ? 'text-muted cursor-not-allowed opacity-50' : 'text-muted hover:text-default'"
        :disabled="hasFilter"
        :title="hasFilter ? 'Clear filters to collapse/expand' : isAllExpanded ? 'Collapse all' : 'Expand all'"
        @click="isAllExpanded ? collapseAll() : expandAll()"
      >
        <UIcon :name="isAllExpanded ? 'i-lucide-fold-vertical' : 'i-lucide-unfold-vertical'" class="size-3.5" />
        {{ isAllExpanded ? 'Collapse all' : 'Expand all' }}
      </button>
    </div>

    <template v-for="row in flatRows" :key="row.key">
      <!-- Group row (spec file or describe block) -->
      <div
        v-if="row.kind === 'group'"
        class="flex items-center gap-2 py-2 pr-3 border-b border-default last:border-b-0 select-none"
        :class="[row.depth === 0 ? 'bg-elevated' : 'bg-default', !hasFilter && 'cursor-pointer']"
        :style="{ paddingLeft: `${row.depth * 20 + 12}px` }"
        @click="toggleGroup(row.key)"
      >
        <UIcon
          :name="isExpanded(row.key) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3.5 text-muted shrink-0"
        />
        <UIcon
          :name="row.depth === 0 ? 'i-lucide-file-code-2' : 'i-lucide-folder-open'"
          class="size-4 shrink-0"
          :class="row.depth === 0 ? 'text-blue-500' : 'text-amber-500'"
        />
        <span
          class="font-medium truncate min-w-0"
          :class="[row.depth === 0 ? 'text-default font-mono text-xs sm:text-sm' : 'text-muted']"
        >
          {{ row.label }}
        </span>
        <span class="text-xs text-muted tabular-nums shrink-0">
          {{ row.agg.cases }} {{ row.agg.cases === 1 ? 'case' : 'cases' }}
        </span>
        <div class="flex-1" />
        <div class="w-24 sm:w-32 shrink-0 max-sm:hidden">
          <TestStatusBar
            :passed="row.agg.passed"
            :failed="row.agg.failed"
            :skipped="row.agg.skipped"
            :flaky="row.agg.flaky"
            :did-not-run="row.agg.didNotRun"
            :total="row.agg.total"
          />
        </div>
      </div>

      <!-- Test case row -->
      <div
        v-else
        class="flex flex-wrap items-center gap-x-2 gap-y-1 pr-3 py-1.5 border-b border-default last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors"
        :style="{ paddingLeft: `${row.depth * 20 + 12}px` }"
      >
        <UIcon name="i-lucide-flask-conical" class="size-3.5 text-muted shrink-0" />
        <UBadge
          :color="testCaseCategoryColor(row.testCase.status)"
          size="xs"
          variant="subtle"
          class="capitalize shrink-0"
        >
          {{ formatStatusLabel(row.testCase.status) }}
        </UBadge>
        <NuxtLink
          :to="`/test-cases/${row.testCase.id}`"
          class="text-sm text-primary hover:underline truncate flex-1 min-w-32"
          :title="row.testCase.title"
        >
          {{ row.testCase.title }}
        </NuxtLink>
        <div class="flex items-center gap-3 shrink-0">
          <PassRateIndicator :rate="row.testCase.passRate" />
          <span class="text-xs text-muted tabular-nums max-sm:hidden" :title="`${row.testCase.totalRuns} runs`">
            {{ row.testCase.totalRuns }}&times;
          </span>
          <DurationValue
            v-if="row.testCase.avgDuration != null"
            :ms="row.testCase.avgDuration"
            class="text-xs text-muted max-sm:hidden"
          />
          <span class="text-xs text-muted max-sm:hidden" :title="prettyDateFormat(row.testCase.lastRun)">
            {{ formatRelativeTime(row.testCase.lastRun) }}
          </span>
          <UButton :to="`/test-cases/${row.testCase.id}`" size="xs" variant="outline">View</UButton>
        </div>
      </div>
    </template>

    <div v-if="flatRows.length === 0" class="text-center py-8 text-muted">
      <UIcon name="i-lucide-search-x" class="size-6 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
      <p class="text-sm">No test cases match your filters.</p>
    </div>
  </div>
</template>
