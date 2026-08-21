<script setup lang="ts">
import { ref, computed } from 'vue';
import type { TestCaseResult, SuiteInfo } from '~~/types/api';
import type { LiveStepsByWorker } from '~/utils/live-steps';

const props = defineProps<{
  testCases: TestCaseResult[];
  suites: SuiteInfo[];
  hasFilter: boolean;
  highlightedCaseId?: number | null;
  /** Worker index → current step, rendered inline on the matching running rows. */
  liveSteps?: LiveStepsByWorker | null;
  /** Piwi project id + name, threaded so the IDE opener can resolve a workspace root. */
  projectKey?: string | number | null;
  projectName?: string | null;
}>();

const suiteLookup = computed(() => {
  const map = new Map<string, { mode: string; annotations: Array<{ type: string; description?: string }> }>();
  for (const s of props.suites) {
    map.set(`${s.filePath}\x1f${s.suitePath.join('\x1f')}`, s);
  }
  return map;
});

interface Stats {
  passed: number;
  failed: number;
  skipped: number;
  didnotrun: number;
  running: number;
  total: number;
}

interface GroupRow {
  kind: 'group';
  depth: number;
  key: string;
  label: string;
  stats: Stats;
  mode?: 'parallel' | 'serial' | 'default';
  annotations?: Array<{ type: string; description?: string }>;
}

interface TestRow {
  kind: 'test';
  depth: number;
  key: string;
  test: TestCaseResult;
}

type FlatRow = GroupRow | TestRow;

function normalizeStatus(s: string): string {
  return s === 'timedOut' || s === 'timedout' ? 'failed' : s;
}

/** Order the per-group tallies are shown in — failures first, they matter most. */
const GROUP_STAT_KEYS = ['failed', 'passed', 'skipped', 'didnotrun', 'running'] as const;

/** The non-zero tallies of a group row, ready to render. */
function visibleStats(stats: Stats) {
  return GROUP_STAT_KEYS.filter((key) => stats[key] > 0).map((key) => ({
    key,
    count: stats[key],
    label: formatStatusLabel(key),
  }));
}

function computeStats(tests: TestCaseResult[]): Stats {
  const stats: Stats = { passed: 0, failed: 0, skipped: 0, didnotrun: 0, running: 0, total: 0 };
  for (const t of tests) {
    const s = normalizeStatus(t.status) as keyof Stats;
    if (s in stats) (stats[s] as number)++;
    stats.total++;
  }
  return stats;
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
  const keys: string[] = [];
  const byFile = new Map<string, TestCaseResult[]>();
  for (const t of props.testCases) {
    const fp = t.filePath ?? 'unknown';
    if (!byFile.has(fp)) byFile.set(fp, []);
    byFile.get(fp)!.push(t);
  }
  for (const [filePath, fileTests] of byFile) {
    keys.push(`file:${filePath}`);
    const suiteKeys = new Set<string>();
    for (const t of fileTests) {
      const sp = t.suitePath ?? [];
      for (let i = 1; i <= sp.length; i++) {
        suiteKeys.add(`group:${filePath}\x1f${sp.slice(0, i).join('\x1f')}`);
      }
    }
    for (const k of suiteKeys) keys.push(k);
  }
  return keys;
}

function collapseAll(): void {
  collapsedKeys.value = new Set(computeAllGroupKeys());
}

function expandAll(): void {
  collapsedKeys.value = new Set();
}

function addLevel(
  rows: FlatRow[],
  tests: TestCaseResult[],
  filePath: string,
  parentSuite: string[],
  depth: number,
): void {
  const direct = tests.filter((t) => (t.suitePath ?? []).length === parentSuite.length);
  const nested = tests.filter((t) => (t.suitePath ?? []).length > parentSuite.length);

  const groups = new Map<string, TestCaseResult[]>();
  for (const t of nested) {
    const seg = (t.suitePath ?? [])[parentSuite.length]!;
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg)!.push(t);
  }

  for (const [seg, groupTests] of groups) {
    const groupPath = [...parentSuite, seg];
    const groupKey = `group:${filePath}\x1f${groupPath.join('\x1f')}`;
    const suiteEntry = suiteLookup.value.get(`${filePath}\x1f${groupPath.join('\x1f')}`);

    rows.push({
      kind: 'group',
      depth,
      key: groupKey,
      label: seg,
      stats: computeStats(groupTests),
      mode: (suiteEntry?.mode as 'parallel' | 'serial' | 'default') ?? 'default',
      annotations: suiteEntry?.annotations ?? [],
    });

    if (isExpanded(groupKey)) {
      addLevel(rows, groupTests, filePath, groupPath, depth + 1);
    }
  }

  for (const test of direct) {
    rows.push({ kind: 'test', depth, key: `test:${test.executionId}`, test });
  }
}

const flatRows = computed<FlatRow[]>(() => {
  const rows: FlatRow[] = [];

  const byFile = new Map<string, TestCaseResult[]>();
  for (const test of props.testCases) {
    const fp = test.filePath ?? 'unknown';
    if (!byFile.has(fp)) byFile.set(fp, []);
    byFile.get(fp)!.push(test);
  }

  for (const [filePath, fileTests] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const fileKey = `file:${filePath}`;
    rows.push({ kind: 'group', depth: 0, key: fileKey, label: filePath, stats: computeStats(fileTests) });
    if (isExpanded(fileKey)) {
      addLevel(rows, fileTests, filePath, [], 1);
    }
  }

  return rows;
});
</script>

<template>
  <div class="rounded-lg border border-default bg-default text-sm flex flex-col flex-1 min-h-0">
    <!-- Toolbar: collapse/expand all -->
    <div class="flex items-center justify-end px-3 py-1.5 border-b border-default bg-elevated shrink-0">
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

    <!-- Scrollable tree body -->
    <div class="overflow-y-auto flex-1 min-h-0">
      <template v-for="row in flatRows" :key="row.key">
        <!-- Group row (file or describe) — sticky within the scroll container -->
        <div
          v-if="row.kind === 'group'"
          class="flex items-center gap-2 py-2 pr-4 border-b border-default last:border-b-0 select-none sticky"
          :class="[row.depth === 0 ? 'bg-elevated' : 'bg-default', !hasFilter && 'cursor-pointer']"
          :style="{
            paddingLeft: `${row.depth * 20 + 12}px`,
            top: `${row.depth * 36}px`,
            zIndex: 20 - row.depth,
          }"
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
          <span v-if="row.depth === 0" class="min-w-0" @click.stop>
            <OpenInIdeLink
              :file-path="row.label"
              :project-key="projectKey"
              :project-name="projectName"
              class="font-medium text-default"
            />
          </span>
          <span v-else class="font-medium truncate min-w-0 text-muted">
            {{ row.label }}
          </span>
          <TestRowBadges v-if="row.depth > 0" :mode="row.mode" :annotations="row.annotations" class="shrink-0" />
          <div class="flex-1" />
          <!--
            Counts stay visible at every width. Below `sm` the wording drops to
            `sr-only` — still announced, still on the hover title — and a status
            icon takes its place so the tally never reads on colour alone. That
            is what gives the spec path room to breathe on a phone.
          -->
          <div class="flex items-center gap-1.5 sm:gap-2 shrink-0 tabular-nums">
            <span
              v-for="stat in visibleStats(row.stats)"
              :key="stat.key"
              class="text-xs inline-flex items-center gap-0.5"
              :class="[getStatusTextClass(stat.key), stat.key === 'failed' ? 'font-medium' : '']"
              :title="`${stat.count} ${stat.label}`"
            >
              <UIcon :name="getStatusIcon(stat.key)" class="size-3 shrink-0 sm:hidden" />
              {{ stat.count }}<span class="max-sm:sr-only"> {{ stat.label }}</span>
            </span>
          </div>
        </div>

        <!-- Test row -->
        <div
          v-else
          class="flex flex-wrap items-center gap-x-2 gap-y-1 pr-3 py-2 sm:py-1.5 border-b border-default last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors"
          :class="highlightedCaseId === row.test.executionId ? 'animate-pulse bg-yellow-100 dark:bg-yellow-900/30' : ''"
          :style="{ paddingLeft: `${row.depth * 20 + 12}px` }"
        >
          <!--
            Same data as the flat list, same left-to-right order: browser,
            status, badges, title, then the numbers.
          -->
          <BrowserBadge :browser="row.test.browser" size="sm" />
          <!--
            The status rides on the row's leading icon (it replaces a purely
            decorative flask). The icon is the row's ONLY status encoding —
            a per-row "Passed" badge repeated ten times carries no information,
            it just buries the one failed row in green ink.
          -->
          <span
            class="size-4 shrink-0"
            role="img"
            :aria-label="`Status: ${formatStatusLabel(row.test.status)}`"
            :title="formatStatusLabel(row.test.status)"
          >
            <UIcon
              :name="getStatusIcon(row.test.status)"
              class="size-4"
              :class="[getStatusTextClass(row.test.status), isStatusInFlight(row.test.status) ? 'animate-spin' : '']"
            />
          </span>
          <!--
            The title is the row's only navigation — a separate "View" button
            pointed at the same page and just ate width. `self-stretch` keeps the
            tap target the full height of the row on touch screens, and the
            `min-w-32` floor stops a tagged test from squeezing its own title to
            nothing on a phone: the badges wrap to a second line instead.

            Neutral title: primary-green titles read as "passed" — on the one
            row that failed, a green title actively lies. Status stays on the
            icon; the link affordance shows on hover.

            The badges follow the title rather than leading it: a row is scanned
            by name, and a `@tag` in front of every name is noise to read past.
          -->
          <a
            :href="`/test-run-cases/${row.test.executionId}`"
            class="text-highlighted hover:text-primary hover:underline min-w-32 self-stretch flex items-center"
            :title="row.test.title"
            @click.prevent="navigateTo(`/test-run-cases/${row.test.executionId}`)"
          >
            <span class="truncate">{{ row.test.title }}</span>
          </a>
          <TestRowBadges
            :is-new-regression="Boolean(row.test.isNewRegression)"
            :is-new-flaky="Boolean(row.test.isNewFlaky)"
            :annotations="row.test.testAnnotations"
            :tags="row.test.tags"
            :meta="row.test.testMeta"
            :max-tags="3"
            class="shrink-0"
          />
          <div class="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
            <template v-if="row.test.status === 'running'">
              <TestRowLiveStep
                v-if="liveStepForCase(liveSteps, row.test)"
                :step="liveStepForCase(liveSteps, row.test)!"
                class="max-w-48 lg:max-w-96"
              />
              <span v-else class="text-xs text-info">In progress...</span>
            </template>
            <DurationValue v-else-if="row.test.duration" :ms="row.test.duration" class="text-xs text-muted" />
            <UBadge
              v-if="row.test.workerIndex != null"
              color="neutral"
              variant="soft"
              size="xs"
              class="font-mono"
              :title="`Worker ${row.test.workerIndex}`"
            >
              w{{ row.test.workerIndex }}
            </UBadge>
            <UBadge v-if="(row.test.retries ?? 0) > 0" color="warning" variant="soft" size="xs">
              {{ row.test.retries }}x
            </UBadge>
            <span
              v-if="row.test.wastedTimeMs"
              class="inline-flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400"
              title="Wasted in fixed waits"
            >
              <UIcon name="i-lucide-hourglass" class="size-3 shrink-0" />
              <DurationValue :ms="row.test.wastedTimeMs" unit-class="opacity-60" no-title />
            </span>
          </div>
        </div>
      </template>

      <div v-if="flatRows.length === 0" class="text-center py-8 text-muted">
        <UIcon name="i-lucide-search-x" class="size-6 mx-auto mb-2 text-zinc-300 dark:text-zinc-600" />
        <p class="text-sm">No test cases match your filters.</p>
      </div>
    </div>
  </div>
</template>
