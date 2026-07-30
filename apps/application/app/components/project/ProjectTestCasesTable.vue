<script setup lang="ts">
import { h } from 'vue';
import { UIcon } from '#components';
import type { TableColumn } from '@nuxt/ui';
import type { TestCasesPage, TestCaseWithStats } from '~~/types/api';
import type { TestCasesSort } from '#shared/handlers/projects';

const props = defineProps<{
  projectId: string | number;
  /** Project name — forwarded to OpenInIdeLink for the JetBrains project hint. */
  projectName?: string | null;
  /** Mirror search/filter/sort/page state into the route query (shareable URLs, survives tab switches). */
  syncQuery?: boolean;
}>();

const emit = defineEmits<{ total: [total: number] }>();

const route = useRoute();
const router = useRouter();
const { treeView, setTreeView } = useTreeViewCookie('project-test-cases');

const TREE_LIMIT = 1000;
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [
  { label: '10 / page', value: 10 },
  { label: '25 / page', value: 25 },
  { label: '50 / page', value: 50 },
  { label: '100 / page', value: 100 },
];
const AGE_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'Last year', value: 365 },
  { label: 'All time', value: 0 },
];
const STATUS_OPTIONS = [
  { label: 'Passed', value: 'passed', color: 'green' },
  { label: 'Failed', value: 'failed', color: 'red' },
  { label: 'Flaky', value: 'flaky', color: 'orange' },
  { label: 'Skipped', value: 'skipped', color: 'gray' },
  { label: "Didn't run", value: 'didnotrun', color: 'amber' },
] as const;

// The public demo's seed data is anchored at a fixed past date, so an age
// window would render the catalog empty there — default to all time instead.
const defaultAge = useRuntimeConfig().public.demoMode ? 0 : 30;

const init = props.syncQuery ? route.query : {};
const page = ref(Math.max(1, Number(init.page) || 1));
const q = ref(typeof init.q === 'string' ? init.q : '');
const searchInput = ref(q.value);
const statuses = ref<string[]>(typeof init.status === 'string' ? init.status.split(',').filter(Boolean) : []);
const age = ref(typeof init.age === 'string' && init.age !== '' ? Math.max(0, Number(init.age) || 0) : defaultAge);
const tagsFilter = ref(typeof init.tags === 'string' ? init.tags : '');
const tagsInput = ref(tagsFilter.value);
const sort = ref<TestCasesSort>(typeof init.sort === 'string' ? (init.sort as TestCasesSort) : 'lastRun');
const dir = ref<'asc' | 'desc'>(init.dir === 'asc' ? 'asc' : 'desc');
const initialPageSize = Number(init.pageSize);
const pageSize = ref(PAGE_SIZE_OPTIONS.some((o) => o.value === initialPageSize) ? initialPageSize : DEFAULT_PAGE_SIZE);

watch(
  searchInput,
  useDebounceFn((value: string) => {
    q.value = value.trim();
  }, 300),
);
watch(
  tagsInput,
  useDebounceFn((value: string) => {
    tagsFilter.value = value.trim();
  }, 300),
);
watch([q, statuses, tagsFilter, age, sort, dir, pageSize, treeView], () => {
  page.value = 1;
});

const query = computed(() => ({
  limit: treeView.value ? TREE_LIMIT : pageSize.value,
  offset: treeView.value ? 0 : (page.value - 1) * pageSize.value,
  ...(q.value ? { q: q.value } : {}),
  ...(statuses.value.length > 0 ? { status: statuses.value.join(',') } : {}),
  ...(tagsFilter.value ? { tags: tagsFilter.value } : {}),
  maxAgeDays: age.value,
  sort: sort.value,
  dir: dir.value,
}));

const { data, status, error, refresh } = useFetch<TestCasesPage>(`/api/projects/${props.projectId}/test-cases`, {
  query,
});

watch(
  () => data.value?.total,
  (total) => {
    if (total != null) emit('total', total);
  },
  { immediate: true },
);

if (props.syncQuery) {
  watch([q, statuses, tagsFilter, age, sort, dir, page, pageSize], () => {
    router.replace({
      query: {
        ...route.query,
        q: q.value || undefined,
        status: statuses.value.length > 0 ? statuses.value.join(',') : undefined,
        tags: tagsFilter.value || undefined,
        age: age.value !== defaultAge ? String(age.value) : undefined,
        sort: sort.value !== 'lastRun' ? sort.value : undefined,
        dir: dir.value !== 'desc' ? dir.value : undefined,
        page: page.value > 1 ? String(page.value) : undefined,
        pageSize: pageSize.value !== DEFAULT_PAGE_SIZE ? String(pageSize.value) : undefined,
      },
    });
  });
}

function toggleStatus(value: string) {
  statuses.value = statuses.value.includes(value)
    ? statuses.value.filter((s) => s !== value)
    : [...statuses.value, value];
}

function toggleSort(key: TestCasesSort) {
  if (sort.value === key) {
    dir.value = dir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sort.value = key;
    dir.value = key === 'title' ? 'asc' : 'desc';
  }
}

function sortableHeader(label: string, key: TestCasesSort) {
  return () => {
    const active = sort.value === key;
    const iconName = !active
      ? 'i-lucide-chevrons-up-down'
      : dir.value === 'asc'
        ? 'i-lucide-chevron-up'
        : 'i-lucide-chevron-down';
    return h(
      'button',
      {
        type: 'button',
        class:
          'flex items-center gap-1 font-semibold select-none cursor-pointer hover:text-highlighted transition-colors',
        onClick: () => toggleSort(key),
      },
      [label, h(UIcon, { name: iconName, class: ['shrink-0 size-3.5', !active && 'opacity-40'] })],
    );
  };
}

const columns = computed<TableColumn<TestCaseWithStats>[]>(() => [
  { accessorKey: 'title', header: sortableHeader('Test case', 'title') },
  { accessorKey: 'status', header: sortableHeader('Status', 'status') },
  { accessorKey: 'totalRuns', header: sortableHeader('Runs', 'totalRuns') },
  { accessorKey: 'passRate', header: sortableHeader('Pass rate', 'passRate') },
  { id: 'results', header: 'Results' },
  { accessorKey: 'avgDuration', header: sortableHeader('Avg duration', 'avgDuration') },
  { accessorKey: 'lastRun', header: sortableHeader('Last run', 'lastRun') },
  { id: 'actions', header: () => h('div', { class: 'text-right' }, 'Actions') },
]);

const items = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.total ?? 0);
const showingFrom = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1));
const showingTo = computed(() =>
  treeView.value ? items.value.length : Math.min(page.value * pageSize.value, total.value),
);
const hasSearchOrStatusFilter = computed(() => q.value !== '' || statuses.value.length > 0);
const hasAnyFilter = computed(() => hasSearchOrStatusFilter.value || age.value !== 0);
const initialLoading = computed(() => status.value === 'pending' && !data.value);

defineExpose({ refresh });
</script>

<template>
  <SectionCard title="Test cases" icon="i-lucide-flask-conical" :count="data?.total" help="project.test-cases">
    <template #actions>
      <UButton
        icon="i-lucide-refresh-cw"
        size="sm"
        color="neutral"
        variant="ghost"
        aria-label="Refresh test cases"
        :loading="status === 'pending' && !!data"
        @click="() => refresh()"
      />
    </template>

    <FilterToolbar class="mb-4">
      <template #start>
        <div class="flex items-center rounded-md border border-default overflow-hidden">
          <button
            type="button"
            class="px-2 py-1 text-xs transition-colors"
            :class="!treeView ? 'bg-primary text-white dark:text-white' : 'text-muted hover:bg-elevated/60'"
            title="Flat list"
            @click="setTreeView(false)"
          >
            <UIcon name="i-lucide-list" class="size-3.5" />
          </button>
          <button
            type="button"
            class="px-2 py-1 text-xs transition-colors"
            :class="treeView ? 'bg-primary text-white dark:text-white' : 'text-muted hover:bg-elevated/60'"
            title="Tree view"
            @click="setTreeView(true)"
          >
            <UIcon name="i-lucide-folder-tree" class="size-3.5" />
          </button>
        </div>
        <span class="text-sm text-muted tabular-nums"> {{ total }} {{ total === 1 ? 'case' : 'cases' }} </span>
      </template>

      <UInput
        v-model="searchInput"
        placeholder="Search title or file..."
        icon="i-lucide-search"
        size="sm"
        class="min-w-48 max-sm:flex-1"
        aria-label="Search test cases"
      />
      <UInput
        v-model="tagsInput"
        placeholder="Tags (comma-separated)…"
        icon="i-lucide-tag"
        size="sm"
        class="min-w-44 max-sm:flex-1"
        aria-label="Filter by tag"
        title="Show only cases carrying every listed tag. A leading @ is optional."
      />
      <div class="flex flex-wrap items-center gap-1">
        <button
          v-for="opt in STATUS_OPTIONS"
          :key="opt.value"
          type="button"
          class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
          :aria-pressed="statuses.includes(opt.value)"
          :class="
            statuses.includes(opt.value)
              ? opt.color === 'green'
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : opt.color === 'red'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : opt.color === 'orange'
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : opt.color === 'amber'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          "
          @click="toggleStatus(opt.value)"
        >
          <span
            class="size-2 rounded-full shrink-0"
            :class="
              opt.color === 'green'
                ? 'bg-green-500'
                : opt.color === 'red'
                  ? 'bg-red-500'
                  : opt.color === 'orange'
                    ? 'bg-orange-500'
                    : opt.color === 'amber'
                      ? 'bg-amber-500'
                      : 'bg-gray-400'
            "
          />
          {{ opt.label }}
        </button>
      </div>
      <USelect v-model="age" :items="AGE_OPTIONS" size="sm" class="w-36" aria-label="Last run age filter" />
    </FilterToolbar>

    <LoadingState v-if="initialLoading" text="Loading test cases..." />

    <ErrorState v-else-if="error" :text="errorMessage(error, 'Failed to load test cases')">
      <template #action>
        <UButton size="sm" variant="outline" @click="() => refresh()">Retry</UButton>
      </template>
    </ErrorState>

    <template v-else-if="total === 0">
      <EmptyState v-if="!hasAnyFilter" icon="i-lucide-flask-conical" text="No test cases yet for this project." />
      <EmptyState v-else icon="i-lucide-search-x" text="No test cases match your filters.">
        <div class="mt-3 flex items-center justify-center gap-2">
          <UButton v-if="age !== 0" size="sm" variant="outline" @click="age = 0">Show all time</UButton>
          <UButton
            v-if="hasSearchOrStatusFilter"
            size="sm"
            variant="ghost"
            @click="
              () => {
                searchInput = '';
                q = '';
                statuses = [];
              }
            "
          >
            Clear filters
          </UButton>
        </div>
      </EmptyState>
    </template>

    <template v-else>
      <div :class="{ 'opacity-60 pointer-events-none': status === 'pending' }" class="transition-opacity">
        <!-- Tree view -->
        <template v-if="treeView">
          <UAlert
            v-if="items.length < total"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            class="mb-3"
            :title="`Showing the first ${items.length} of ${total} cases — narrow the search or filters to see the rest.`"
          />
          <ProjectTestCasesTree :items="items" :has-filter="hasSearchOrStatusFilter" />
        </template>

        <!-- Flat view: table from md up, cards below -->
        <template v-else>
          <div class="hidden md:block overflow-x-auto">
            <UTable
              :data="items"
              :columns="columns"
              :ui="{
                base: 'w-full table-fixed border-separate border-spacing-0 min-w-[56rem]',
                thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                tbody: '[&>tr]:last:[&>td]:border-b-0 [&>tr]:hover:bg-gray-50 dark:[&>tr]:hover:bg-gray-900/50',
                th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                td: 'border-b border-default',
              }"
            >
              <template #title-cell="{ row }">
                <div class="min-w-0 space-y-0.5">
                  <NuxtLink
                    :to="`/test-cases/${row.original.id}`"
                    class="text-sm font-medium text-primary hover:underline truncate block"
                    :title="row.original.title"
                  >
                    {{ row.original.title }}
                  </NuxtLink>
                  <TestMetaBadges
                    :tags="row.original.tags"
                    :meta="{
                      owner: row.original.owner ?? undefined,
                      priority: toTestPriority(row.original.priority),
                      feature: row.original.feature ?? undefined,
                      link: row.original.link ?? undefined,
                    }"
                    :max-tags="4"
                  />
                  <div class="flex items-center gap-1 text-xs text-muted">
                    <UIcon name="i-lucide-file-code" class="size-3 shrink-0" />
                    <OpenInIdeLink
                      :file-path="row.original.filePath"
                      :project-key="projectId"
                      :project-name="projectName"
                      class="min-w-0"
                    />
                  </div>
                </div>
              </template>

              <template #status-cell="{ row }">
                <UBadge
                  :color="testCaseCategoryColor(row.original.status)"
                  variant="subtle"
                  size="sm"
                  class="capitalize"
                >
                  {{ formatStatusLabel(row.original.status) }}
                </UBadge>
              </template>

              <template #totalRuns-cell="{ row }">
                <span class="text-sm tabular-nums">{{ row.original.totalRuns }}</span>
              </template>

              <template #passRate-cell="{ row }">
                <PassRateIndicator :rate="row.original.passRate" />
              </template>

              <template #results-cell="{ row }">
                <TestStatusBar
                  :passed="row.original.passedRuns"
                  :failed="row.original.failedRuns"
                  :skipped="row.original.skippedRuns"
                  :flaky="row.original.flakyRuns"
                  :did-not-run="row.original.didNotRunRuns"
                  :total="row.original.totalRuns"
                />
              </template>

              <template #avgDuration-cell="{ row }">
                <DurationValue :ms="row.original.avgDuration" class="text-sm text-muted" />
              </template>

              <template #lastRun-cell="{ row }">
                <span class="text-sm text-muted" :title="prettyDateFormat(row.original.lastRun)">
                  {{ row.original.lastRun != null ? formatRelativeTime(row.original.lastRun) : '—' }}
                </span>
              </template>

              <template #actions-cell="{ row }">
                <div class="flex justify-end">
                  <UButton
                    :to="`/test-cases/${row.original.id}`"
                    size="sm"
                    variant="outline"
                    trailing-icon="i-lucide-arrow-right"
                  >
                    View
                  </UButton>
                </div>
              </template>
            </UTable>
          </div>

          <!-- Below md: one card per case (no horizontal scroll) -->
          <div class="space-y-2 md:hidden">
            <div v-for="tc in items" :key="tc.id" class="rounded-lg border border-default p-3 space-y-2">
              <div class="flex items-start justify-between gap-2">
                <NuxtLink
                  :to="`/test-cases/${tc.id}`"
                  class="text-sm font-medium text-primary hover:underline min-w-0 truncate"
                  :title="tc.title"
                >
                  {{ tc.title }}
                </NuxtLink>
                <UBadge
                  :color="testCaseCategoryColor(tc.status)"
                  variant="subtle"
                  size="sm"
                  class="capitalize shrink-0"
                >
                  {{ formatStatusLabel(tc.status) }}
                </UBadge>
              </div>
              <div class="flex items-center gap-1 text-xs text-muted min-w-0">
                <UIcon name="i-lucide-file-code" class="size-3 shrink-0" />
                <OpenInIdeLink
                  :file-path="tc.filePath"
                  :project-key="projectId"
                  :project-name="projectName"
                  class="min-w-0"
                />
              </div>
              <TestStatusBar
                :passed="tc.passedRuns"
                :failed="tc.failedRuns"
                :skipped="tc.skippedRuns"
                :flaky="tc.flakyRuns"
                :did-not-run="tc.didNotRunRuns"
                :total="tc.totalRuns"
              />
              <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <PassRateIndicator :rate="tc.passRate" />
                <span class="text-xs text-muted tabular-nums">{{ tc.totalRuns }} runs</span>
                <DurationValue v-if="tc.avgDuration != null" :ms="tc.avgDuration" class="text-xs text-muted" />
                <span class="text-xs text-muted" :title="prettyDateFormat(tc.lastRun)">
                  {{ tc.lastRun != null ? formatRelativeTime(tc.lastRun) : '—' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Pagination footer -->
          <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-sm text-muted tabular-nums"
                >Showing {{ showingFrom }}–{{ showingTo }} of {{ total }}</span
              >
              <div class="flex items-center gap-1.5">
                <span class="text-sm text-muted">Rows per page</span>
                <USelect
                  v-model="pageSize"
                  :items="PAGE_SIZE_OPTIONS"
                  size="sm"
                  class="w-28"
                  aria-label="Rows per page"
                />
              </div>
            </div>
            <UPagination
              v-if="total > pageSize"
              v-model:page="page"
              :total="total"
              :items-per-page="pageSize"
              size="sm"
            />
          </div>
        </template>
      </div>
    </template>
  </SectionCard>
</template>
