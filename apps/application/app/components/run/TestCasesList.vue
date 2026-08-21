<script setup lang="ts">
import { computed, nextTick, watch, ref } from 'vue';
import type { TestCaseResult, SuiteInfo } from '~~/types/api';
import type { LiveStepsByWorker } from '~/utils/live-steps';

const { treeView, setTreeView } = useTreeViewCookie('test-cases');

// Transient flat-view override for scrollToCase: reveals the row without
// persisting the switch in the tree-view cookie (which lasts a year).
const flatViewOverride = ref(false);
const effectiveTreeView = computed(() => treeView.value && !flatViewOverride.value);

const props = defineProps<{
  testCases: TestCaseResult[];
  suites: SuiteInfo[];
  isLive: boolean;
  /** Worker index → current step, rendered inline on the matching running rows. */
  liveSteps?: LiveStepsByWorker | null;
  failureClusterFilter?: number | null;
  /** Failure-cluster id → display name, for the cluster badges on failing rows. */
  clusterNames?: Record<number, string> | null;
  /** Piwi project id + name, threaded so the IDE opener can resolve a workspace root. */
  projectKey?: string | number | null;
  projectName?: string | null;
}>();

// Filter state is owned by the parent page so it survives tab switches.
const testCaseSearch = defineModel<string>('search', { default: '' });
const activeStatuses = defineModel<string[]>('activeStatuses', { default: () => [] });
const testCaseBrowserFilter = defineModel<string>('browserFilter', { default: 'all' });

const showNewRegressionsOnly = ref(false);
const showNewFlakyOnly = ref(false);

const STATUS_OPTIONS = [
  { label: 'Passed', value: 'passed', color: 'green' },
  { label: 'Failed', value: 'failed', color: 'red' },
  { label: 'Skipped', value: 'skipped', color: 'gray' },
  { label: "Didn't run", value: 'didnotrun', color: 'amber' },
  { label: 'Flaky', value: 'flaky', color: 'orange' },
] as const;

function toggleStatus(value: string) {
  const idx = activeStatuses.value.indexOf(value);
  if (idx >= 0) {
    activeStatuses.value = activeStatuses.value.filter((s) => s !== value);
  } else {
    activeStatuses.value = [...activeStatuses.value, value];
  }
}

const testCaseBrowserOptions = computed(() => {
  const browsers = new Set<string>();
  for (const tc of props.testCases) {
    const name = tc.browser?.projectName;
    if (name) browsers.add(name);
  }
  const items = [{ label: 'All browsers', value: 'all' }];
  for (const b of [...browsers].sort()) {
    items.push({ label: b, value: b });
  }
  return items;
});

/** Tooltip for a status cell: a did-not-run row explains *why* it never ran. */
function statusHint(tc: TestCaseResult): string {
  if (tc.status === 'didnotrun') return formatDidNotRunReason(tc.didNotRunReason);
  return formatStatusLabel(tc.status);
}

/** The live step to show on a running row (worker-matched, see the helper). */
function liveStep(tc: TestCaseResult) {
  return liveStepForCase(props.liveSteps, tc);
}

function matchesStatus(tc: TestCaseResult, filter: string): boolean {
  if (filter === 'failed') return isFailedStatus(tc.status);
  if (filter === 'flaky') return (tc.retries ?? 0) > 0;
  return tc.status === filter;
}

const filteredTestCases = computed<TestCaseResult[]>(() => {
  let cases = props.testCases;
  if (props.failureClusterFilter != null) {
    cases = cases.filter((tc) => tc.failureClusterId === props.failureClusterFilter);
  }
  if (activeStatuses.value.length > 0) {
    cases = cases.filter((tc) => activeStatuses.value.some((s) => matchesStatus(tc, s)));
  }
  if (testCaseBrowserFilter.value !== 'all') {
    cases = cases.filter((tc) => tc.browser?.projectName === testCaseBrowserFilter.value);
  }
  if (testCaseSearch.value) {
    const query = testCaseSearch.value.toLowerCase();
    cases = cases.filter(
      (tc) => tc.title.toLowerCase().includes(query) || (tc.location && tc.location.toLowerCase().includes(query)),
    );
  }
  if (showNewRegressionsOnly.value) {
    cases = cases.filter((tc) => tc.isNewRegression);
  }
  if (showNewFlakyOnly.value) {
    cases = cases.filter((tc) => tc.isNewFlaky);
  }
  return cases;
});

// Client-side sort (the old UTable sorting, re-implemented for the virtualized list).
const sortKey = ref<string | null>(null);
const sortDir = ref<'asc' | 'desc'>('asc');

function toggleSort(key: string) {
  if (sortKey.value !== key) {
    sortKey.value = key;
    sortDir.value = 'asc';
  } else if (sortDir.value === 'asc') {
    sortDir.value = 'desc';
  } else {
    // Third click clears the sort → natural (insertion) order.
    sortKey.value = null;
  }
}

function sortIcon(key: string): string {
  if (sortKey.value !== key) return 'i-lucide-chevrons-up-down';
  return sortDir.value === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down';
}

function sortValue(tc: TestCaseResult, key: string): string | number {
  switch (key) {
    case 'browser':
      return tc.browser?.projectName ?? '';
    case 'title':
      return tc.title ?? '';
    case 'status':
      // Timeouts sort beside failures, matching the filter and the badge.
      return isFailedStatus(tc.status ?? '') ? 'failed' : (tc.status ?? '');
    case 'duration':
      return tc.duration ?? 0;
    case 'workerIndex':
      return tc.workerIndex ?? -1;
    case 'retries':
      return tc.retries ?? 0;
    case 'wastedTimeMs':
      return tc.wastedTimeMs ?? 0;
    default:
      return '';
  }
}

// A run with failures shows them first by default: the landing view's first
// job is answering "why did it fail". Stable, so insertion order is kept
// within each group.
const failedCount = computed(() => props.testCases.filter((tc) => isFailedStatus(tc.status)).length);

const sortedTestCases = computed<TestCaseResult[]>(() => {
  const cases = filteredTestCases.value;
  const key = sortKey.value;
  if (!key) {
    if (failedCount.value === 0) return cases;
    return [...cases].sort((a, b) => failureFirstCompare(a.status, b.status));
  }
  const dir = sortDir.value === 'asc' ? 1 : -1;
  // Copy first — never sort the props array in place.
  return [...cases].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
});

const hasWastedTime = computed(() => props.testCases.some((tc) => (tc.wastedTimeMs ?? 0) > 0));

// Column layout — one grid template shared by the header and every row so the
// columns stay aligned. Keep the cell order in the template in sync with this.
// An `icon` header keeps an icon-only column (browser) from overflowing a label
// into its neighbor while staying sortable.
type Column = {
  key: string;
  label: string;
  sortable: boolean;
  width: string;
  align: 'left' | 'right';
  icon?: string;
};

const columns = computed<Column[]>(() => {
  const cols: Column[] = [
    { key: 'browser', label: 'Browser', sortable: true, width: '3.25rem', align: 'left', icon: 'i-lucide-monitor' },
    { key: 'title', label: 'Test case', sortable: true, width: 'minmax(12rem, 3fr)', align: 'left' },
    { key: 'status', label: 'Status', sortable: true, width: '6rem', align: 'left' },
    { key: 'duration', label: 'Duration', sortable: true, width: '7rem', align: 'left' },
    { key: 'workerIndex', label: 'Worker', sortable: true, width: '6rem', align: 'left' },
    { key: 'retries', label: 'Retries', sortable: true, width: '6.5rem', align: 'left' },
  ];
  if (hasWastedTime.value) {
    cols.push({ key: 'wastedTimeMs', label: 'Wasted', sortable: true, width: '6rem', align: 'left' });
  }
  return cols;
});

/**
 * Sort picker for the card layout below `md`, which has no column headers to
 * click. `NATURAL_ORDER` stands in for "no sort key" — a `USelect` item may not
 * carry an empty string, which the select reserves for clearing itself.
 */
const NATURAL_ORDER = 'natural';

const sortOptions = computed(() => [
  { label: failedCount.value > 0 ? 'Failures first' : 'Run order', value: NATURAL_ORDER },
  ...columns.value.map((c) => ({ label: c.label, value: c.key })),
]);

const mobileSortKey = computed({
  get: () => sortKey.value ?? NATURAL_ORDER,
  set: (value: string) => {
    sortKey.value = value === NATURAL_ORDER ? null : value;
    if (value !== NATURAL_ORDER) sortDir.value = 'asc';
  },
});

const gridTemplate = computed(() => columns.value.map((c) => c.width).join(' '));
const gridMinWidth = computed(() => (hasWastedTime.value ? '47.5rem' : '41.5rem'));

// The cluster filter narrows rows but must not force-expand the tree or
// disable Collapse-all — those belong to the user, whatever the filter is.
const hasFilter = computed(
  () => testCaseSearch.value !== '' || activeStatuses.value.length > 0 || testCaseBrowserFilter.value !== 'all',
);

// Virtualized scroller ref — only the exposed methods we call are typed.
const scrollerRef = ref<{
  scrollToItem: (index: number, options?: ScrollToOptions) => void;
  scrollToBottom: () => void;
} | null>(null);
const userScrolledAway = ref(false);
const highlightedCaseId = ref<number | null>(null);

function isAtBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
}

function onScrollerScroll(event: Event) {
  const el = event.target as HTMLElement | null;
  if (el) userScrolledAway.value = !isAtBottom(el);
}

// Reset scroll lock when live mode ends.
watch(
  () => props.isLive,
  (live) => {
    if (!live) userScrolledAway.value = false;
  },
);

// Auto-scroll to the newest item during a live run, unless the user scrolled up.
watch(
  () => sortedTestCases.value.length,
  () => {
    if (!props.isLive || userScrolledAway.value) return;
    nextTick(() => scrollerRef.value?.scrollToBottom());
  },
);

function scrollToCase(id: number) {
  // Reveal the row without touching the user's persisted view preference:
  // the flat override lives for this mount only, the cookie is untouched.
  flatViewOverride.value = true;
  highlightedCaseId.value = id;
  const doScroll = () => {
    const index = sortedTestCases.value.findIndex((tc) => tc.executionId === id);
    if (index >= 0) scrollerRef.value?.scrollToItem(index, { behavior: 'smooth' });
  };
  nextTick(() => {
    if (scrollerRef.value) doScroll();
    else setTimeout(doScroll, 60);
    setTimeout(() => {
      highlightedCaseId.value = null;
    }, 3000);
  });
}

defineExpose({ scrollToCase });
</script>

<template>
  <div class="flex flex-col min-h-0">
    <FilterToolbar class="mb-4 shrink-0">
      <template #start>
        <div class="flex items-center rounded-md border border-default overflow-hidden">
          <button
            class="px-2 py-1 text-xs transition-colors"
            :class="!treeView ? 'bg-primary text-white dark:text-white' : 'text-muted hover:bg-elevated/60'"
            title="Flat list"
            :aria-pressed="!treeView"
            @click="setTreeView(false)"
          >
            <UIcon name="i-lucide-list" class="size-3.5" />
          </button>
          <button
            class="px-2 py-1 text-xs transition-colors"
            :class="treeView ? 'bg-primary text-white dark:text-white' : 'text-muted hover:bg-elevated/60'"
            title="Tree view"
            :aria-pressed="treeView"
            @click="setTreeView(true)"
          >
            <UIcon name="i-lucide-folder-tree" class="size-3.5" />
          </button>
        </div>
        <span v-if="isLive" class="text-sm text-zinc-500 tabular-nums inline-flex items-center gap-1">
          {{ testCases.length }} completed <HelpHint topic="run.live" />
        </span>
        <span v-else class="text-sm text-zinc-500 tabular-nums inline-flex items-center gap-1">
          {{ sortedTestCases.length
          }}{{ sortedTestCases.length !== testCases.length ? ` / ${testCases.length}` : '' }} cases
          <HelpHint topic="run.test-cases" />
        </span>
      </template>

      <UInput
        v-model="testCaseSearch"
        placeholder="Search test cases..."
        icon="i-lucide-search"
        size="sm"
        class="min-w-48 max-sm:flex-1"
      />
      <div class="flex flex-wrap items-center gap-1">
        <button
          v-for="opt in STATUS_OPTIONS"
          :key="opt.value"
          class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
          :class="
            activeStatuses.includes(opt.value)
              ? opt.color === 'green'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : opt.color === 'red'
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                  : opt.color === 'orange'
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          "
          :aria-pressed="activeStatuses.includes(opt.value)"
          @click="toggleStatus(opt.value)"
        >
          <span
            class="size-2 rounded-full shrink-0"
            :class="
              opt.color === 'green'
                ? 'bg-emerald-500'
                : opt.color === 'red'
                  ? 'bg-rose-500'
                  : opt.color === 'orange'
                    ? 'bg-orange-500'
                    : 'bg-zinc-400'
            "
          />
          {{ opt.label }}
        </button>
      </div>
      <USelect
        v-model="testCaseBrowserFilter"
        :items="testCaseBrowserOptions"
        size="sm"
        class="w-36"
        aria-label="Filter by browser"
      />
      <UCheckbox v-if="!isLive" v-model="showNewRegressionsOnly" label="New regressions" size="sm" />
      <UCheckbox v-if="!isLive" v-model="showNewFlakyOnly" label="New flaky" size="sm" />
      <!-- Phones get the card layout, which has no sortable column headers. -->
      <div v-if="!treeView" class="flex items-center gap-1 md:hidden">
        <USelect v-model="mobileSortKey" :items="sortOptions" size="sm" class="w-32" aria-label="Sort cases by" />
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          :disabled="sortKey === null"
          :icon="sortDir === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'"
          :title="sortDir === 'asc' ? 'Sorted ascending' : 'Sorted descending'"
          :aria-label="sortDir === 'asc' ? 'Sorted ascending' : 'Sorted descending'"
          @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
        />
      </div>
    </FilterToolbar>

    <!-- Tree view -->
    <TestCasesTree
      v-if="effectiveTreeView"
      :test-cases="sortedTestCases"
      :suites="suites"
      :has-filter="hasFilter"
      :highlighted-case-id="highlightedCaseId"
      :live-steps="liveSteps"
      :project-key="projectKey"
      :project-name="projectName"
      class="flex-1 min-h-0"
    />

    <!-- Flat, virtualized table view -->
    <template v-else-if="!effectiveTreeView">
      <div
        v-if="sortedTestCases.length > 0"
        class="flex-1 min-h-0 max-lg:h-[70dvh] md:overflow-x-auto overflow-y-hidden rounded-lg border border-default bg-default"
      >
        <!--
          The grid only claims its minimum width from `md` up, where the columns
          exist; below that the cards fit the viewport and the page must not
          scroll sideways.
        -->
        <div
          class="flex flex-col h-full md:min-w-(--grid-min-width)"
          role="table"
          aria-label="Test cases"
          :aria-rowcount="sortedTestCases.length + 1"
          :style="{ '--grid-min-width': gridMinWidth }"
        >
          <!-- Header — the sort control below `md` lives in the toolbar instead -->
          <div
            class="hidden md:grid shrink-0 bg-elevated/50 border-b border-default"
            role="row"
            :style="{ gridTemplateColumns: gridTemplate }"
          >
            <template v-for="col in columns" :key="col.key">
              <button
                v-if="col.sortable"
                type="button"
                role="columnheader"
                :aria-sort="sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'"
                :aria-label="col.icon ? col.label : undefined"
                :title="col.icon ? col.label : undefined"
                class="flex items-center gap-1 min-w-0 px-3 py-2 text-sm font-semibold select-none cursor-pointer hover:text-highlighted transition-colors"
                :class="col.align === 'right' ? 'justify-end' : ''"
                @click="toggleSort(col.key)"
              >
                <UIcon v-if="col.icon" :name="col.icon" class="shrink-0 size-4" />
                <span v-else class="truncate">{{ col.label }}</span>
                <UIcon
                  :name="sortIcon(col.key)"
                  class="shrink-0 size-3.5"
                  :class="sortKey === col.key ? '' : 'opacity-40'"
                />
              </button>
              <div
                v-else
                role="columnheader"
                class="px-3 py-2 text-sm font-semibold"
                :class="col.align === 'right' ? 'text-right' : ''"
              >
                {{ col.label }}
              </div>
            </template>
          </div>

          <!-- Virtualized rows -->
          <ClientOnly>
            <DynamicScroller
              ref="scrollerRef"
              :items="sortedTestCases"
              :min-item-size="44"
              key-field="executionId"
              role="rowgroup"
              class="flex-1 min-h-0"
              @scroll.passive="onScrollerScroll"
            >
              <template #default="{ item, index, active }">
                <DynamicScrollerItem
                  :item="item"
                  :active="active"
                  :size-dependencies="[
                    item.title,
                    item.location,
                    item.isNewRegression,
                    item.isNewFlaky,
                    item.testAnnotations,
                    item.tags,
                    liveStep(item)?.title,
                  ]"
                  :data-index="index"
                >
                  <!--
                    Below `md` the columns become a card: a phone cannot show
                    seven of them without a horizontal scroll, and the numbers
                    need their own labels once the header row is gone. The card
                    mirrors the tree's row so the two views still read alike.
                  -->
                  <div
                    class="md:hidden border-b border-default px-3 py-2.5 space-y-1.5 text-sm transition-colors"
                    :class="
                      highlightedCaseId === item.executionId ? 'animate-pulse bg-yellow-100 dark:bg-yellow-900/30' : ''
                    "
                    role="row"
                  >
                    <div class="flex items-start gap-2">
                      <span
                        class="size-4 shrink-0 mt-0.5"
                        role="img"
                        :aria-label="`Status: ${statusHint(item)}`"
                        :title="statusHint(item)"
                      >
                        <UIcon
                          :name="getStatusIcon(item.status)"
                          class="size-4"
                          :class="[
                            getStatusTextClass(item.status),
                            isStatusInFlight(item.status) ? 'animate-spin' : '',
                          ]"
                        />
                      </span>
                      <a
                        :href="`/test-run-cases/${item.executionId}`"
                        class="text-highlighted hover:text-primary hover:underline font-medium flex-1 min-w-0"
                        @click.prevent="navigateTo(`/test-run-cases/${item.executionId}`)"
                        >{{ item.title }}</a
                      >
                      <NuxtLink
                        v-if="item.failureClusterId && clusterNames?.[item.failureClusterId]"
                        :to="`/failure-clusters/${item.failureClusterId}`"
                        class="shrink-0"
                      >
                        <UBadge color="info" variant="subtle" size="xs" class="max-w-44">
                          <span class="truncate">{{ clusterNames[item.failureClusterId] }}</span>
                        </UBadge>
                      </NuxtLink>
                      <BrowserBadge :browser="item.browser" size="sm" class="mt-0.5" />
                    </div>

                    <p
                      v-if="isFailedStatus(item.status) && item.error"
                      class="pl-6 text-xs text-rose-600 dark:text-rose-400 truncate"
                      :title="item.error"
                    >
                      {{ item.error }}
                    </p>

                    <OpenInIdeLink
                      v-if="item.location"
                      :location="item.location"
                      :project-key="projectKey"
                      :project-name="projectName"
                      class="block pl-6 text-xs text-gray-400 dark:text-gray-500"
                    />

                    <TestRowBadges
                      :is-new-regression="Boolean(item.isNewRegression)"
                      :is-new-flaky="Boolean(item.isNewFlaky)"
                      :annotations="item.testAnnotations"
                      :tags="item.tags"
                      :meta="item.testMeta"
                      :max-tags="3"
                      class="pl-6"
                    />

                    <div class="pl-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <template v-if="item.status === 'running'">
                        <TestRowLiveStep v-if="liveStep(item)" :step="liveStep(item)!" class="max-w-full" />
                        <span v-else class="text-info">In progress...</span>
                      </template>
                      <DurationValue v-else-if="item.duration" :ms="item.duration" />
                      <UBadge
                        v-if="item.workerIndex != null"
                        color="neutral"
                        variant="soft"
                        size="xs"
                        class="font-mono"
                        :title="`Worker ${item.workerIndex}`"
                      >
                        w{{ item.workerIndex }}
                      </UBadge>
                      <UBadge v-if="(item.retries ?? 0) > 0" color="warning" variant="soft" size="xs">
                        {{ item.retries }}x
                      </UBadge>
                      <span
                        v-if="item.wastedTimeMs"
                        class="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"
                        title="Wasted in fixed waits"
                      >
                        <UIcon name="i-lucide-hourglass" class="size-3 shrink-0" />
                        <DurationValue :ms="item.wastedTimeMs" unit-class="opacity-60" no-title />
                      </span>
                    </div>
                  </div>

                  <div
                    class="hidden md:grid items-center border-b border-default text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    :class="
                      highlightedCaseId === item.executionId ? 'animate-pulse bg-yellow-100 dark:bg-yellow-900/30' : ''
                    "
                    role="row"
                    :style="{ gridTemplateColumns: gridTemplate }"
                  >
                    <!-- browser -->
                    <div class="px-3 py-2 flex items-center min-w-0" role="cell">
                      <BrowserBadge :browser="item.browser" />
                    </div>

                    <!-- title -->
                    <div class="px-3 py-2 min-w-0 space-y-0.5" role="cell">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <!-- Neutral title: green titles read as "passed" even on failed rows. -->
                        <a
                          :href="`/test-run-cases/${item.executionId}`"
                          class="text-highlighted hover:text-primary hover:underline font-medium truncate"
                          :title="item.title"
                          @click.prevent="navigateTo(`/test-run-cases/${item.executionId}`)"
                          >{{ item.title }}</a
                        >
                        <!-- Same badge cluster, in the same place, as the tree's rows. -->
                        <TestRowBadges
                          :is-new-regression="Boolean(item.isNewRegression)"
                          :is-new-flaky="Boolean(item.isNewFlaky)"
                          :annotations="item.testAnnotations"
                          :tags="item.tags"
                          :meta="item.testMeta"
                          :max-tags="3"
                          class="shrink-0"
                        />
                        <NuxtLink
                          v-if="item.failureClusterId && clusterNames?.[item.failureClusterId]"
                          :to="`/failure-clusters/${item.failureClusterId}`"
                          class="shrink-0"
                        >
                          <UBadge color="info" variant="subtle" size="xs" class="max-w-44">
                            <span class="truncate">{{ clusterNames[item.failureClusterId] }}</span>
                          </UBadge>
                        </NuxtLink>
                      </div>
                      <p
                        v-if="isFailedStatus(item.status) && item.error"
                        class="text-xs text-rose-600 dark:text-rose-400 truncate"
                        :title="item.error"
                      >
                        {{ item.error }}
                      </p>
                      <OpenInIdeLink
                        v-if="item.location"
                        :location="item.location"
                        :project-key="projectKey"
                        :project-name="projectName"
                        class="text-xs text-zinc-400 dark:text-zinc-500"
                      />
                      <!-- The step this row's worker is on right now (live runs only). -->
                      <div v-if="liveStep(item)" class="min-w-0">
                        <TestRowLiveStep :step="liveStep(item)!" class="max-w-full" />
                      </div>
                    </div>

                    <!-- status — the flat view's only status encoding, so it keeps a chip (subtle, not solid) -->
                    <div class="px-3 py-2 flex items-center" role="cell">
                      <UBadge
                        :color="
                          getStatusColor(
                            item.status === 'timedOut' || item.status === 'timedout' ? 'failed' : item.status,
                          )
                        "
                        variant="subtle"
                        class="capitalize"
                        :title="statusHint(item)"
                      >
                        {{ formatStatusLabel(item.status) }}
                      </UBadge>
                    </div>

                    <!-- duration -->
                    <div class="px-3 py-2 flex items-center whitespace-nowrap" role="cell">
                      <span v-if="item.status === 'running'" class="text-info text-xs">In progress...</span>
                      <DurationValue v-else :ms="item.duration" fallback="" />
                    </div>

                    <!-- worker -->
                    <div class="px-3 py-2 flex items-center" role="cell">
                      <UBadge v-if="item.workerIndex != null" color="neutral" variant="soft" class="font-mono text-xs">
                        {{ item.workerIndex }}
                      </UBadge>
                    </div>

                    <!-- retries -->
                    <div class="px-3 py-2 flex items-center tabular-nums" role="cell">
                      {{ item.retries && item.retries > 0 ? item.retries : '' }}
                    </div>

                    <!-- wasted -->
                    <div v-if="hasWastedTime" class="px-3 py-2 flex items-center whitespace-nowrap" role="cell">
                      <DurationValue
                        v-if="item.wastedTimeMs"
                        :ms="item.wastedTimeMs"
                        class="text-amber-600 dark:text-amber-400"
                        unit-class="opacity-60"
                      />
                      <span v-else class="text-zinc-400">&mdash;</span>
                    </div>
                  </div>
                </DynamicScrollerItem>
              </template>
            </DynamicScroller>

            <template #fallback>
              <div class="flex-1 min-h-0 flex items-center justify-center py-10 text-sm text-zinc-500">
                <UIcon name="i-lucide-loader-circle" class="size-4 mr-2 animate-spin" />
                Loading test cases…
              </div>
            </template>
          </ClientOnly>
        </div>
      </div>

      <EmptyState
        v-else-if="testCases.length === 0"
        icon="i-lucide-beaker"
        text="No test cases recorded for this run."
      />

      <EmptyState v-else icon="i-lucide-search-x" text="No test cases match your filters.">
        <UButton
          size="xs"
          variant="outline"
          color="neutral"
          label="Clear filters"
          @click="
            testCaseSearch = '';
            activeStatuses = [];
            testCaseBrowserFilter = 'all';
          "
        />
      </EmptyState>
    </template>
  </div>
</template>
