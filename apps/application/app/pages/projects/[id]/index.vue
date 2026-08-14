<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type {
  ProjectWithTestRuns,
  TestRunSummary,
  PerformanceTrendPoint,
  SlowTest,
  TestRunForCompare,
  FlakyTest,
  ProjectMemberEntry,
  ProjectMembersResponse,
  UserDetails,
  UsersResponse,
  MarkersResponse,
} from '~~/types/api';
import { useRunComparison } from '~/composables/useRunComparison';
import type { ComparisonRow } from '~/composables/useRunComparison';
import { RUN_DURATION_SERIES, RUN_STATUS_SERIES, legendOf } from '~/utils/chart';

const route = useRoute();
const router = useRouter();
const projectId = route.params.id as string;

// === MAIN PROJECT DATA ===
const { data: project, refresh } = await useFetch<ProjectWithTestRuns>(`/api/projects/${projectId}`);

useHead(computed(() => ({ title: `${project.value?.label || project.value?.name || 'Project'} — Piwi Dashboard` })));

const toast = useToast();
const deletingRunId = ref<number | null>(null);
const confirmDeleteRunId = ref<number | null>(null);

// === PROJECT DELETION ===
const { isAdmin, isReporter } = useAuth();
const runtimeConfig = useRuntimeConfig();
const canDelete = computed(() => !runtimeConfig.public.authEnabled || isAdmin.value);
const canImport = canDelete;
const showDeleteProjectModal = ref(false);
const deleteProjectConfirmInput = ref('');
const deletingProject = ref(false);

const deleteProjectConfirmValid = computed(() => deleteProjectConfirmInput.value === project.value?.name);

async function handleDeleteProject() {
  if (!deleteProjectConfirmValid.value) return;
  deletingProject.value = true;
  try {
    await $fetch(`/api/projects/${projectId}` as '/api/projects/:id', { method: 'DELETE' });
    toast.add({ title: 'Project deleted', color: 'success' });
    await refreshNuxtData();
    await router.push('/');
  } catch (error: unknown) {
    const errorMessage =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({ title: 'Delete failed', description: errorMessage || 'An error occurred', color: 'error' });
    deletingProject.value = false;
  }
}

useRunStream(refresh);

async function handleDeleteRun(runId: number) {
  confirmDeleteRunId.value = null;
  deletingRunId.value = runId;
  try {
    await $fetch(`/api/test-runs/${runId}`, { method: 'DELETE' });
    toast.add({ title: 'Test run deleted', color: 'success' });
    await refresh();
  } catch (error: unknown) {
    const errorMessage =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({ title: 'Delete failed', description: errorMessage || 'An error occurred', color: 'error' });
  } finally {
    deletingRunId.value = null;
  }
}

// === MEMBERS TAB ===
const members = ref<ProjectMemberEntry[]>([]);
const allUsers = ref<UserDetails[]>([]);
const selectedMemberIds = ref<number[]>([]);

const mergedMembers = computed(() => {
  // Build a lookup of project members by ID
  const memberMap = new Map(members.value.map((m) => [m.id, m]));
  // Show all non-admin users; admins always have access and are shown from members
  const result: (ProjectMemberEntry & { hasAccess: boolean })[] = [];
  for (const u of allUsers.value) {
    if (u.role === 'administrator') continue;
    const m = memberMap.get(u.id);
    result.push({
      id: u.id,
      username: u.username,
      name: u.name ?? null,
      role: u.role,
      global: m?.global ?? false,
      hasAccess: !!m,
    });
  }
  // Also include admins from the members list
  for (const m of members.value) {
    if (m.role === 'administrator') result.push({ ...m, hasAccess: true });
  }
  return result;
});

const membersChanged = computed(() => {
  const originalIds = members.value
    .filter((m) => m.role !== 'administrator' && !m.global)
    .map((m) => m.id)
    .sort();
  const currentIds = [...selectedMemberIds.value].sort();
  return JSON.stringify(originalIds) !== JSON.stringify(currentIds);
});

watch(
  () => project.value?.id,
  async (newId) => {
    if (!newId || !isAdmin.value) return;
    try {
      const [membersData, usersData] = await Promise.all([
        $fetch<ProjectMembersResponse>(`/api/projects/${projectId}/members`),
        $fetch<UsersResponse>('/api/users'),
      ]);
      members.value = membersData.items;
      allUsers.value = usersData.items;
      selectedMemberIds.value = membersData.items
        .filter((m) => m.role !== 'administrator' && !m.global)
        .map((m) => m.id);
    } catch {
      members.value = [];
      allUsers.value = [];
      selectedMemberIds.value = [];
    }
  },
  { immediate: true },
);

function toggleMemberSelection(userId: number) {
  const idx = selectedMemberIds.value.indexOf(userId);
  if (idx >= 0) {
    selectedMemberIds.value.splice(idx, 1);
  } else {
    selectedMemberIds.value.push(userId);
  }
}

async function handleSaveMembers() {
  try {
    await $fetch(`/api/projects/${projectId}/members`, {
      method: 'PUT',
      body: { userIds: selectedMemberIds.value },
    });
    toast.add({ title: 'Members updated', color: 'success' });
    const data = await $fetch<ProjectMembersResponse>(`/api/projects/${projectId}/members`);
    members.value = data.items;
  } catch (error: unknown) {
    const errorMessage =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({ title: 'Update failed', description: errorMessage || 'An error occurred', color: 'error' });
  }
}

// === TABS ===
const activeTab = ref('test-runs');
// Bumped after a suggested merge is approved, to refresh the clusters list.
const clustersRefreshKey = ref(0);

// Support ?tab= query param for sidebar/redirect links
const validTabs = [
  'test-runs',
  'failure-clusters',
  'flaky-tests',
  'performance',
  'test-cases',
  'compare',
  'spec-health',
  'ai-steps',
  'quarantine',
  'timeline',
  'members',
] as const;
const queryTab = route.query.tab;
if (typeof queryTab === 'string' && validTabs.includes(queryTab as (typeof validTabs)[number])) {
  activeTab.value = queryTab as string;
}

// Reflect the active tab in the URL so it is bookmarkable/shareable and survives a
// reload. Use replace() (not push()) so switching tabs does not stack history entries —
// Back returns to the previous page, not the previously viewed tab. Mirrors the
// test-runs/[id] and test-run-cases/[id] pages.
watch(activeTab, (tab) => {
  if (route.query.tab === tab) return;
  if (!validTabs.includes(tab as (typeof validTabs)[number])) return;
  router.replace({ query: { ...route.query, tab } });
});

const hasFailures = computed(() => project.value?.testRuns?.some((r) => r.failedTests > 0) ?? false);

/**
 * Tabs, grouped by the question they answer rather than listed flat.
 *
 * Ten peer tabs made the page read as a pile — "Performance" sat between
 * "Flaky tests" and "Test cases" for no reason a reader could reconstruct.
 * The groups run: what happened (Results) → what's broken (Failures) → is the
 * suite healthy (Health) → administration. The desktop strip renders the
 * flattened order (adjacency alone carries most of the meaning); the mobile
 * select and the command palette render the labelled groups.
 */
const tabGroups = computed(() => [
  {
    label: 'Results',
    items: [
      {
        label: `Test runs (${filteredRuns.value.length})`,
        icon: 'i-lucide-play-circle',
        value: 'test-runs',
        slot: 'test-runs',
      },
      {
        label: `Test cases${testCasesTotal.value != null ? ` (${testCasesTotal.value})` : ''}`,
        icon: 'i-lucide-list-checks',
        value: 'test-cases',
        slot: 'test-cases',
      },
      { label: 'Compare', icon: 'i-lucide-git-compare-arrows', value: 'compare', slot: 'compare' },
    ],
  },
  {
    label: 'Failures',
    items: [
      ...(hasFailures.value
        ? [
            {
              label: 'Failure clusters',
              icon: 'i-lucide-layers',
              value: 'failure-clusters',
              slot: 'failure-clusters',
            },
          ]
        : []),
      { label: 'Flaky tests', icon: 'i-lucide-shuffle', value: 'flaky-tests', slot: 'flaky-tests' },
      { label: 'Quarantine', icon: 'i-lucide-shield-alert', value: 'quarantine', slot: 'quarantine' },
    ],
  },
  {
    label: 'Health',
    items: [
      { label: 'Spec health', icon: 'i-lucide-table-2', value: 'spec-health', slot: 'spec-health' },
      { label: 'AI steps', icon: 'i-lucide-wand-sparkles', value: 'ai-steps', slot: 'ai-steps' },
      { label: 'Performance', icon: 'i-lucide-trending-up', value: 'performance', slot: 'performance' },
      {
        label: `Timeline${markers.value.length ? ` (${markers.value.length})` : ''}`,
        icon: 'i-lucide-milestone',
        value: 'timeline',
        slot: 'timeline',
      },
    ],
  },
  ...(isAdmin.value
    ? [
        {
          label: 'Admin',
          items: [{ label: 'Members', icon: 'i-lucide-users', value: 'members', slot: 'members' }],
        },
      ]
    : []),
]);

const tabItems = computed(() => tabGroups.value.flatMap((g) => g.items));

/** Grouped shape for `USelect` (mobile) — array-of-arrays renders as sections. */
const tabSelectGroups = computed(() => tabGroups.value.map((g) => g.items).filter((items) => items.length > 0));

const activeTabIcon = computed(() => tabItems.value.find((t) => t.value === activeTab.value)?.icon);

// === TEST RUNS TAB ===
const selectedRunIds = ref<number[]>([]);

const isRunSelected = (runId: number) => selectedRunIds.value.includes(runId);

function toggleRunSelection(runId: number) {
  const idx = selectedRunIds.value.indexOf(runId);
  if (idx >= 0) {
    selectedRunIds.value.splice(idx, 1);
  } else {
    if (selectedRunIds.value.length >= 2) {
      toast.add({
        title: 'Maximum 2 runs',
        description: 'Select at most 2 runs to compare. Deselect one first.',
        color: 'warning',
      });
      return;
    }
    selectedRunIds.value.push(runId);
  }
}

// Shared ref for passing selected runs to compare tab
const preSelectedCompareRuns = ref<[number, number] | null>(null);

function compareSelectedRuns() {
  if (selectedRunIds.value.length !== 2) return;
  preSelectedCompareRuns.value = [selectedRunIds.value[0]!, selectedRunIds.value[1]!];
  activeTab.value = 'compare';
}

// Environment filter
const selectedEnvironments = ref<string[]>([]);
const fullRunsOnly = ref(true);

const availableEnvironments = computed(() => {
  const envs = new Set<string>();
  for (const run of project.value?.testRuns || []) {
    if (run.environment) envs.add(run.environment);
  }
  return [...envs].sort();
});

function toggleEnvironmentFilter(env: string) {
  const idx = selectedEnvironments.value.indexOf(env);
  if (idx === -1) {
    selectedEnvironments.value.push(env);
  } else {
    selectedEnvironments.value.splice(idx, 1);
  }
}

function isEnvironmentFilterActive(env: string) {
  return selectedEnvironments.value.includes(env);
}

// Branch filter — reads the scalar run branch, falling back to the SCM metadata
// for runs reported before the branch column existed.
function runBranch(run: { branch?: string | null; metadata?: { scm?: { branch?: string | null } } | null }) {
  return run.branch ?? run.metadata?.scm?.branch ?? null;
}

const selectedBranches = ref<string[]>([]);

const availableBranches = computed(() => {
  const branches = new Set<string>();
  for (const run of project.value?.testRuns || []) {
    const b = runBranch(run);
    if (b) branches.add(b);
  }
  return [...branches].sort();
});

function toggleBranchFilter(branch: string) {
  const idx = selectedBranches.value.indexOf(branch);
  if (idx === -1) {
    selectedBranches.value.push(branch);
  } else {
    selectedBranches.value.splice(idx, 1);
  }
}

function isBranchFilterActive(branch: string) {
  return selectedBranches.value.includes(branch);
}

const filteredRuns = computed(() => {
  let runs = project.value?.testRuns || [];
  if (fullRunsOnly.value) {
    runs = runs.filter((r) => r.isFullRun !== false);
  }
  if (selectedEnvironments.value.length > 0) {
    runs = runs.filter((r) => r.environment && selectedEnvironments.value.includes(r.environment));
  }
  if (selectedBranches.value.length > 0) {
    runs = runs.filter((r) => {
      const b = runBranch(r);
      return b !== null && selectedBranches.value.includes(b);
    });
  }
  return runs;
});

// When exactly one environment is selected, scope the (server-side) flaky
// analysis to it so staging vs production stability can be compared.
const flakyEnvironment = computed(() =>
  selectedEnvironments.value.length === 1 ? selectedEnvironments.value[0] : undefined,
);

// When exactly one branch is selected, scope the (server-side) flaky analysis
// to it so a feature branch's stability can be compared to the default branch.
const flakyBranch = computed(() => (selectedBranches.value.length === 1 ? selectedBranches.value[0] : undefined));

// === TIMELINE MARKERS ===
const { data: markersData, refresh: refreshMarkers } = await useFetch<MarkersResponse>(
  `/api/projects/${projectId}/markers`,
  { default: () => ({ items: [] }) },
);
const markers = computed(() => markersData.value?.items ?? []);

const canEditMarkers = computed(() => !runtimeConfig.public.authEnabled || isAdmin.value || isReporter.value);

// Markers overlaid on the charts follow the same environment filter as the runs:
// show global (no-environment) markers always, and env-scoped markers only when
// their environment is in the active filter (or no filter is set).
const visibleMarkers = computed(() => {
  if (selectedEnvironments.value.length === 0) return markers.value;
  return markers.value.filter((m) => m.environment == null || selectedEnvironments.value.includes(m.environment));
});

// Clicking a marker line on a chart jumps to the Timeline tab and opens its editor.
const focusMarkerId = ref<number | null>(null);
function handleMarkerClick(id: number) {
  focusMarkerId.value = id;
  activeTab.value = 'timeline';
}

// Tooltip for the Scope icon: full runs are self-explanatory; partial runs surface
// the grep / grep-invert filter that narrowed the run, when the reporter captured it.
function scopeTooltip(run: TestRunSummary): string {
  if (run.isFullRun !== false) return 'Full run — the complete test suite ran';
  const parts: string[] = [];
  const grep = run.filterDetails?.grep?.trim();
  const grepInvert = run.filterDetails?.grepInvert?.trim();
  const files = run.filterDetails?.files;
  // ".*" is Playwright's default grep (matches everything) → not a real filter, skip it.
  if (grep && grep !== '.*') parts.push(`grep: ${grep}`);
  if (grepInvert) parts.push(`grep-invert: ${grepInvert}`);
  if (files?.length) parts.push(`files: ${files.join(', ')}`);
  return parts.length
    ? `Partial run — ${parts.join(' · ')}`
    : 'Partial run — only a filtered subset of tests ran (grep, file, or line filter)';
}

const runsColumns: TableColumn<TestRunSummary>[] = [
  {
    accessorKey: 'select',
    header: '',
  },
  {
    accessorKey: 'id',
    header: createSortHeader<TestRunSummary>('Run'),
  },
  {
    accessorKey: 'status',
    header: createSortHeader<TestRunSummary>('Status'),
  },
  {
    accessorKey: 'isFullRun',
    header: 'Scope',
  },
  {
    id: 'browsers',
    accessorFn: (row) => row.browsers,
    header: '',
  },
  {
    accessorKey: 'startTime',
    header: createSortHeader<TestRunSummary>('Started'),
  },
  {
    accessorKey: 'environment',
    header: createSortHeader<TestRunSummary>('Environment'),
  },
  {
    accessorKey: 'metadata',
    header: 'Branch / Commit',
  },
  {
    accessorKey: 'duration',
    header: createSortHeader<TestRunSummary>('Test status / Dur.'),
  },
  {
    accessorKey: 'reports',
    header: 'Reports',
  },
  {
    id: 'actions',
    header: 'Actions',
  },
];

// === TEST CASES TAB ===
// The catalog table (ProjectTestCasesTable) owns its own fetch, filters and
// pagination; it emits its total row count so the tab label can show it.
const testCasesTotal = ref<number | null>(null);

// === PERFORMANCE TAB ===
const dateFrom = ref('');
const dateTo = ref('');

const performanceQueryParams = computed(() => {
  const params: Record<string, string> = {};
  if (dateFrom.value) params.from = dateFrom.value;
  if (dateTo.value) params.to = dateTo.value;
  return params;
});

// Only fetch when the trends tab is active; re-fetch when date filters change
const performanceData = ref<PerformanceTrendPoint[] | null>(null);
const performanceLoading = ref(false);
const slowTests = ref<SlowTest[] | null>(null);
const slowTestsError = ref(false);
const slowTestsLoading = ref(false);

// Show a loading state — not the chart's "no data" empty message — until the first
// fetch settles. Without this, a refresh on ?tab=performance renders the empty state
// while the async fetch is still in flight, so the tab reads as if it loaded broken.
const performanceInitialLoading = computed(() => performanceLoading.value && performanceData.value === null);

watch(
  [activeTab, performanceQueryParams, fullRunsOnly],
  async ([tab, params]) => {
    if (tab !== 'performance') return;
    performanceLoading.value = true;
    if (!slowTests.value) slowTestsLoading.value = true;
    // The fetch result isn't awaited into the SSR render, so skip the wasted server
    // round-trip; the immediate run on the client performs it (SSR still shows the loader).
    if (import.meta.server) return;
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    const fullParam = fullRunsOnly.value ? `${qs ? '&' : ''}fullRunsOnly=true` : '';
    const queryString = qs || fullParam ? `?${qs}${fullParam}` : '';
    const perfRes = await $fetch<{ items: PerformanceTrendPoint[] }>(
      `/api/projects/${projectId}/performance${queryString}`,
    ).catch((err) => {
      console.warn('[PerformanceTab] Failed to fetch performance trend:', err);
      return null;
    });
    performanceData.value = perfRes?.items ?? null;
    performanceLoading.value = false;
    if (slowTestsLoading.value) {
      slowTestsError.value = false;
      const slowRes = await $fetch<{ items: SlowTest[] }>(`/api/projects/${projectId}/slow-tests`).catch((err) => {
        slowTestsError.value = true;
        console.warn('[PerformanceTab] Failed to fetch slow tests:', err);
        return null;
      });
      slowTests.value = slowRes?.items ?? null;
      slowTestsLoading.value = false;
    }
  },
  { immediate: true },
);

const slowTestsColumns: TableColumn<SlowTest>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<SlowTest>('Test case'),
  },
  {
    accessorKey: 'avgDuration',
    header: createSortHeader<SlowTest>('Avg duration'),
  },
  {
    accessorKey: 'maxDuration',
    header: createSortHeader<SlowTest>('Max'),
  },
  {
    accessorKey: 'minDuration',
    header: createSortHeader<SlowTest>('Min'),
  },
  {
    accessorKey: 'latestDuration',
    header: createSortHeader<SlowTest>('Latest'),
  },
  {
    accessorKey: 'trend',
    header: createSortHeader<SlowTest>('Trend'),
  },
  {
    accessorKey: 'runCount',
    header: createSortHeader<SlowTest>('Runs'),
  },
];

// === COMPARE TAB ===
function formatRunLabel(run: TestRunSummary): string {
  const date = prettyDateFormat(run.startTime, { dateOnly: true });
  const commitSuffix = run.metadata?.scm?.commit ? ` (${run.metadata.scm.commit.substring(0, 7)})` : '';
  return `Run #${run.id} — ${date}${commitSuffix}`;
}

interface RunOption {
  label: string;
  value: number;
}

const runOptions = computed<RunOption[]>(() => {
  if (!project.value?.testRuns) return [];
  return [...project.value.testRuns].reverse().map((run) => ({
    label: formatRunLabel(run),
    value: run.id,
  }));
});

const compareRunA = ref<RunOption | undefined>(undefined);
const compareRunB = ref<RunOption | undefined>(undefined);

// Pre-select from query params (direct links to compare tab)
const queryRunA = computed(() => (route.query.runA ? Number(route.query.runA) : null));
const queryRunB = computed(() => (route.query.runB ? Number(route.query.runB) : null));

watch(
  runOptions,
  (options) => {
    if (queryRunA.value) {
      const match = options.find((o) => o.value === queryRunA.value);
      if (match) compareRunA.value = match;
    }
    if (queryRunB.value) {
      const match = options.find((o) => o.value === queryRunB.value);
      if (match) compareRunB.value = match;
    }
  },
  { immediate: true },
);

// Watch for pre-selected runs from the test runs tab
watch(preSelectedCompareRuns, (selected) => {
  if (selected) {
    const optA = runOptions.value.find((o) => o.value === selected[0]);
    const optB = runOptions.value.find((o) => o.value === selected[1]);
    if (optA) compareRunA.value = optA;
    if (optB) compareRunB.value = optB;
    preSelectedCompareRuns.value = null;
  }
});

function compareLatestWithPrevious() {
  if (runOptions.value.length >= 2) {
    compareRunA.value = runOptions.value[1];
    compareRunB.value = runOptions.value[0];
  }
}

const runADetails = ref<TestRunForCompare | null>(null);
const runBDetails = ref<TestRunForCompare | null>(null);
const compareLoading = ref(false);

async function fetchBothRuns() {
  const optA = compareRunA.value;
  const optB = compareRunB.value;
  if (!optA?.value && !optB?.value) return;
  compareLoading.value = true;
  try {
    const ids: number[] = [];
    if (optA?.value) ids.push(optA.value);
    if (optB?.value) ids.push(optB.value);
    const results = await Promise.all(ids.map((id) => $fetch<TestRunForCompare>(`/api/test-runs/${id}/summary`)));
    const map = new Map<number, TestRunForCompare>();
    for (const r of results) map.set(r.id, r);
    runADetails.value = optA?.value ? (map.get(optA.value) ?? null) : null;
    runBDetails.value = optB?.value ? (map.get(optB.value) ?? null) : null;
  } catch {
    runADetails.value = null;
    runBDetails.value = null;
  } finally {
    compareLoading.value = false;
  }
}

watch([compareRunA, compareRunB], () => {
  fetchBothRuns();
});

const { comparisonData, comparisonSummary } = useRunComparison(runADetails, runBDetails);

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
  <UDashboardPanel id="project-detail">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project' },
            ]"
          />
        </template>
        <template #right>
          <NavbarActions
            size="sm"
            :actions="[
              ...(canDelete
                ? [
                    {
                      label: 'Delete',
                      icon: 'i-lucide-trash-2',
                      color: 'error' as const,
                      variant: 'ghost' as const,
                      onClick: () => {
                        deleteProjectConfirmInput = '';
                        showDeleteProjectModal = true;
                      },
                    },
                  ]
                : []),
              ...(canImport
                ? [
                    {
                      label: 'Import',
                      icon: 'i-lucide-import',
                      variant: 'outline' as const,
                      to: `/projects/${projectId}/import`,
                    },
                  ]
                : []),
              {
                label: 'Test functions',
                icon: 'i-lucide-function-square',
                variant: 'outline' as const,
                to: `/projects/${projectId}/test-functions`,
              },
              {
                label: 'Edit',
                icon: 'i-lucide-pencil',
                variant: 'outline' as const,
                to: `/projects/${projectId}/edit`,
              },
              { label: 'Refresh', icon: 'i-lucide-refresh-cw', variant: 'outline' as const, onClick: () => refresh() },
            ]"
          >
            <template #leading>
              <SubscribeBell :project-id="parseInt(projectId)" :project-label="project?.label || project?.name" />
            </template>
          </NavbarActions>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col h-full overflow-y-auto gap-4">
        <div v-if="project?.description || (project?.tags && project.tags.length > 0)" class="pb-0 space-y-4">
          <p v-if="project?.description" class="text-gray-600">
            {{ project.description }}
          </p>

          <div v-if="project?.tags && project.tags.length > 0" class="flex flex-wrap gap-1 mt-2">
            <TagBadge v-for="tag in project.tags" :key="tag.id" :text="tag.text" :color="tag.color" />
          </div>
        </div>

        <!-- Desktop shell only (renders nothing without the IPC bridge). -->
        <DesktopProjectLinkCard :project-id="projectId" />

        <!-- Mobile: a select replaces the cramped tab strip; the strip scrolls from sm up. -->
        <USelect
          v-model="activeTab"
          :items="tabSelectGroups"
          :icon="activeTabIcon"
          size="md"
          class="w-full mx-1 mb-1 sm:hidden"
        />
        <UTabs
          v-model="activeTab"
          :items="tabItems"
          size="sm"
          class="p-1"
          :ui="{ list: 'max-sm:hidden overflow-x-auto', trigger: 'shrink-0' }"
        >
          <!-- TEST RUNS TAB -->
          <template #test-runs>
            <!-- Full runs toggle + Environment filter — drives the chart and the table -->
            <div class="flex flex-wrap items-center gap-3 mb-4">
              <div class="inline-flex items-center gap-1">
                <USwitch v-model="fullRunsOnly" label="Full runs only" :ui="{ label: 'text-sm' }" />
                <HelpHint topic="project.run-scope" />
              </div>
              <template v-if="availableEnvironments.length > 0">
                <span class="text-sm text-muted shrink-0">Environment:</span>
                <button
                  v-for="env in availableEnvironments"
                  :key="env"
                  type="button"
                  :class="[
                    'text-xs font-medium px-2 py-1 rounded border cursor-pointer focus:outline-none transition-colors',
                    isEnvironmentFilterActive(env)
                      ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700'
                      : 'bg-zinc-100 text-zinc-500 border-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700 dark:hover:bg-zinc-700',
                  ]"
                  @click="toggleEnvironmentFilter(env)"
                >
                  {{ env }}
                </button>
                <UButton
                  v-if="selectedEnvironments.length > 0"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-x"
                  label="Clear filter"
                  @click="selectedEnvironments = []"
                />
              </template>
              <template v-if="availableBranches.length > 0">
                <span class="text-sm text-muted shrink-0">Branch:</span>
                <button
                  v-for="branch in availableBranches"
                  :key="branch"
                  type="button"
                  :title="branch"
                  :class="[
                    'text-xs font-medium px-2 py-1 rounded border cursor-pointer focus:outline-none transition-colors max-w-[12rem] truncate',
                    isBranchFilterActive(branch)
                      ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700'
                      : 'bg-zinc-100 text-zinc-500 border-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700 dark:hover:bg-zinc-700',
                  ]"
                  @click="toggleBranchFilter(branch)"
                >
                  {{ branch }}
                </button>
                <UButton
                  v-if="selectedBranches.length > 0"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-x"
                  label="Clear filter"
                  @click="selectedBranches = []"
                />
              </template>
            </div>

            <ChartCard
              v-if="filteredRuns.length > 0"
              title="Run trend"
              subtitle="One bar per run, newest on the right"
              help="project.runs-trend"
              :legend="legendOf(RUN_STATUS_SERIES)"
              data-shot="run-trend"
            >
              <TestRunsChart :test-runs="filteredRuns" :markers="visibleMarkers" @marker-click="handleMarkerClick" />
            </ChartCard>

            <UCard class="mt-4">
              <!-- Comparison action bar -->
              <div
                v-if="selectedRunIds.length > 0"
                class="flex items-center gap-3 px-3 py-2 mb-3 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800"
              >
                <span class="text-sm text-primary-700 dark:text-primary-300">
                  {{ selectedRunIds.length }} run{{ selectedRunIds.length > 1 ? 's' : '' }} selected
                </span>
                <UButton
                  v-if="selectedRunIds.length === 2"
                  icon="i-lucide-git-compare-arrows"
                  size="sm"
                  color="primary"
                  label="Compare selected runs"
                  @click="compareSelectedRuns"
                />
                <span v-else class="text-xs text-primary-500"> Select another run to compare </span>
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-x"
                  label="Clear"
                  @click="selectedRunIds = []"
                />
              </div>

              <UTable
                v-if="filteredRuns.length > 0"
                :data="filteredRuns"
                :columns="runsColumns"
                :ui="{
                  base: 'table-fixed border-separate border-spacing-0',
                  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                  tbody: '[&>tr]:last:[&>td]:border-b-0',
                  th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                  td: 'border-b border-default',
                }"
              >
                <template #select-cell="{ row }">
                  <input
                    type="checkbox"
                    :checked="isRunSelected(row.original.id)"
                    class="cursor-pointer size-4 accent-primary"
                    @click.stop="toggleRunSelection(row.original.id)"
                  />
                </template>
                <template #id-cell="{ row }">
                  <div class="flex items-center gap-2">
                    <a
                      :href="`/test-runs/${row.original.id}`"
                      class="text-primary hover:underline font-medium"
                      @click.prevent="navigateTo(`/test-runs/${row.original.id}`)"
                    >
                      Run #{{ row.original.id }}
                    </a>
                    <span v-if="row.original.label" class="text-xs text-gray-500 dark:text-gray-400 truncate max-w-32">
                      {{ row.original.label }}
                    </span>
                  </div>
                </template>
                <template #status-cell="{ row }">
                  <RunStatusBadge :status="row.original.status" />
                </template>
                <template #isFullRun-header>
                  <span class="inline-flex items-center gap-1">Scope <HelpHint topic="run.partial" /></span>
                </template>
                <template #isFullRun-cell="{ row }">
                  <UTooltip :text="scopeTooltip(row.original)">
                    <UIcon
                      :name="row.original.isFullRun === false ? 'i-lucide-list-filter' : 'i-lucide-list-checks'"
                      class="size-4 shrink-0 cursor-help"
                      :class="row.original.isFullRun === false ? 'text-amber-500' : 'text-green-500'"
                    />
                  </UTooltip>
                </template>
                <template #browsers-cell="{ row }">
                  <div v-if="row.original.browsers?.length" class="flex items-center gap-1">
                    <BrowserBadge
                      v-for="name in row.original.browsers"
                      :key="name"
                      :browser="{ projectName: name }"
                      size="sm"
                    />
                  </div>
                </template>
                <template #startTime-cell="{ row }">
                  <span class="text-xs text-gray-600">{{ prettyDateFormat(row.original.startTime) }}</span>
                </template>
                <template #environment-cell="{ row }">
                  <UBadge v-if="row.original.environment" color="info" variant="subtle" size="sm">
                    {{ row.original.environment }}
                  </UBadge>
                </template>
                <template #metadata-cell="{ row }">
                  <div
                    v-if="runBranch(row.original) || row.original.metadata?.scm?.commit"
                    class="flex items-center gap-1 flex-wrap"
                  >
                    <button
                      v-if="runBranch(row.original)"
                      type="button"
                      :title="`Filter runs on ${runBranch(row.original)}`"
                      :class="[
                        'text-xs font-medium px-1.5 py-0.5 rounded cursor-pointer transition-colors max-w-[12rem] truncate',
                        isBranchFilterActive(runBranch(row.original)!)
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700',
                      ]"
                      @click="toggleBranchFilter(runBranch(row.original)!)"
                    >
                      {{ runBranch(row.original) }}
                    </button>
                    <code v-if="row.original.metadata?.scm?.commit" class="text-xs text-gray-500">
                      {{ row.original.metadata.scm.commit.substring(0, 7) }}
                    </code>
                  </div>
                </template>
                <template #duration-cell="{ row }">
                  <div class="space-y-1">
                    <TestStatusBar
                      :passed="row.original.passedTests"
                      :failed="row.original.failedTests"
                      :skipped="row.original.skippedTests"
                      :flaky="row.original.flakyTests"
                      :did-not-run="row.original.didNotRunTests ?? 0"
                      :total="row.original.totalTests"
                    />
                    <DurationValue :ms="row.original.duration" class="text-xs text-gray-500" />
                  </div>
                </template>
                <template #reports-cell="{ row }">
                  <RunReports :reports="row.original.reports" />
                </template>
                <template #actions-header>
                  <div class="text-right">Actions</div>
                </template>
                <template #actions-cell="{ row }">
                  <div class="flex justify-end gap-2">
                    <UButton :to="`/test-runs/${row.original.id}`" size="sm" variant="outline"> View </UButton>
                    <UButton
                      size="sm"
                      color="error"
                      variant="soft"
                      icon="i-lucide-trash-2"
                      :loading="deletingRunId === row.original.id"
                      @click="confirmDeleteRunId = row.original.id"
                    >
                      Delete
                    </UButton>
                  </div>
                </template>
              </UTable>

              <div v-else-if="project?.testRuns && project.testRuns.length > 0" class="text-center py-8 text-gray-500">
                No test runs match the selected environment filter.
              </div>

              <EmptyState v-else icon="i-lucide-rocket" text="No test runs yet for this project.">
                <p class="text-xs text-gray-400 max-w-sm">
                  Point the reporter's <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">projectName</code> at
                  <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ project?.name }}</code> to send results
                  here — see the
                  <DocLink to="reporter" no-icon class="text-primary hover:underline">reporter docs</DocLink> for setup
                  instructions.
                </p>
              </EmptyState>
            </UCard>
          </template>

          <!-- FAILURE CLUSTERS TAB -->
          <template #failure-clusters>
            <template v-if="activeTab === 'failure-clusters'">
              <ClusterMergeSuggestions
                :key="`sug-${clustersRefreshKey}`"
                :project-id="String(projectId)"
                @merged="clustersRefreshKey++"
              />
              <FailureClustersList :key="clustersRefreshKey" :project-id="String(projectId)" />
            </template>
          </template>

          <!-- FLAKY TESTS TAB -->
          <template #flaky-tests>
            <FlakyTestsList
              v-if="activeTab === 'flaky-tests'"
              :project-id="String(projectId)"
              :environment="flakyEnvironment"
              :branch="flakyBranch"
              :project-name="project?.name"
            />
          </template>

          <!-- PERFORMANCE TAB -->
          <template #performance>
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-sm text-muted shrink-0">Date range:</span>
              <UInput v-model="dateFrom" type="date" size="sm" placeholder="From" class="w-40" />
              <span class="text-sm text-muted">to</span>
              <UInput v-model="dateTo" type="date" size="sm" placeholder="To" class="w-40" />
              <UButton
                v-if="dateFrom || dateTo"
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-x"
                label="Clear"
                @click="
                  dateFrom = '';
                  dateTo = '';
                "
              />
            </div>

            <ChartCard
              title="Performance trend"
              subtitle="Duration metrics per run, newest on the right"
              help="project.performance"
              :legend="legendOf(RUN_DURATION_SERIES)"
              data-shot="performance-trend"
            >
              <LoadingState v-if="performanceInitialLoading" text="Loading chart…" />
              <PerformanceTrendChart
                v-else
                :data="performanceData || []"
                :markers="visibleMarkers"
                @marker-click="handleMarkerClick"
              />
            </ChartCard>

            <UCard data-shot="slowest-tests">
              <template #header>
                <h2 class="text-xl font-semibold inline-flex items-center gap-1">
                  Slowest tests <HelpHint topic="project.slowest-tests" />
                </h2>
                <p class="text-sm text-gray-600 mt-1">Top 20 slowest test cases across recent runs</p>
              </template>

              <LoadingState v-if="slowTestsLoading && slowTests === null" text="Loading…" />

              <UTable
                v-else-if="slowTests && slowTests.length > 0"
                :data="slowTests"
                :columns="slowTestsColumns"
                :ui="{
                  base: 'table-fixed border-separate border-spacing-0',
                  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                  tbody: '[&>tr]:last:[&>td]:border-b-0',
                  th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                  td: 'border-b border-default',
                }"
              >
                <template #title-cell="{ row }">
                  <div>
                    <div class="font-medium">{{ row.original.title }}</div>
                    <div class="mt-1">
                      <OpenInIdeLink
                        :file-path="row.original.filePath"
                        :project-key="projectId"
                        :project-name="project?.name"
                        class="text-xs"
                      />
                    </div>
                  </div>
                </template>
                <template #trend-cell="{ row }">
                  <span v-if="row.original.trend === 'slower'" class="text-red-600 font-medium">▲ Slower</span>
                  <span v-else-if="row.original.trend === 'faster'" class="text-green-600 font-medium">▼ Faster</span>
                  <span v-else class="text-gray-500">&mdash; Stable</span>
                </template>
              </UTable>

              <div v-else-if="slowTestsError" class="text-center py-8 text-red-500">
                Couldn't load the slowest tests — try refreshing.
              </div>

              <div v-else class="text-center py-8 text-gray-500">No slow test data available yet.</div>
            </UCard>

            <TimeoutOpportunitiesTable :project-id="String(projectId)" :project-name="project?.name" />

            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <div>
                    <h2 class="text-xl font-semibold inline-flex items-center gap-1">
                      Run comparison <HelpHint topic="project.run-compare" />
                    </h2>
                    <p class="text-sm text-gray-600 mt-1">Compare duration changes between two runs</p>
                  </div>
                  <UButton
                    v-if="runOptions.length >= 2"
                    icon="i-lucide-git-compare-arrows"
                    size="sm"
                    variant="outline"
                    label="Compare latest vs previous"
                    @click="compareLatestWithPrevious"
                  />
                </div>
              </template>
              <div class="space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                      >Run A (baseline)</label
                    >
                    <USelectMenu v-model="compareRunA" :items="runOptions" placeholder="Select run A..." />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                      >Run B (comparison)</label
                    >
                    <USelectMenu v-model="compareRunB" :items="runOptions" placeholder="Select run B..." />
                  </div>
                </div>
                <div v-if="compareLoading" class="text-center py-4 text-gray-500">
                  <UIcon name="i-lucide-loader-2" class="animate-spin mr-2" />
                  Loading run data…
                </div>
                <div v-else-if="compareRunA && compareRunB && comparisonData.length > 0" class="space-y-4">
                  <div class="flex gap-4 text-sm">
                    <UBadge color="success" variant="soft" size="lg">{{ comparisonSummary.improved }} improved</UBadge>
                    <UBadge color="error" variant="soft" size="lg">{{ comparisonSummary.regressed }} regressed</UBadge>
                    <UBadge color="neutral" variant="soft" size="lg"
                      >{{ comparisonSummary.unchanged }} unchanged</UBadge
                    >
                  </div>
                  <UTable
                    :data="comparisonData"
                    :columns="comparisonColumns"
                    :ui="{
                      base: 'table-fixed border-separate border-spacing-0',
                      thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                      tbody: '[&>tr]:last:[&>td]:border-b-0',
                      th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                      td: 'border-b border-default',
                    }"
                  >
                    <template #statusA-cell="{ row }">
                      <span v-if="!row.original.statusA" class="text-gray-400">&mdash;</span>
                      <UBadge
                        v-else
                        :color="getStatusColor(row.original.statusA)"
                        variant="subtle"
                        class="capitalize"
                        >{{ row.original.statusA }}</UBadge
                      >
                    </template>
                    <template #statusB-cell="{ row }">
                      <span v-if="!row.original.statusB" class="text-gray-400">&mdash;</span>
                      <UBadge
                        v-else
                        :color="getStatusColor(row.original.statusB)"
                        variant="subtle"
                        class="capitalize"
                        >{{ row.original.statusB }}</UBadge
                      >
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
                </div>
                <div v-else-if="!compareRunA || !compareRunB" class="text-center py-8 text-gray-500">
                  Select two runs to compare their performance.
                </div>
                <div v-else class="text-center py-8 text-gray-500">
                  No overlapping test cases found between the selected runs.
                </div>
              </div>
            </UCard>
          </template>

          <!-- TEST CASES TAB -->
          <template #test-cases>
            <ProjectTestCasesTable
              :project-id="projectId"
              :project-name="project?.name"
              sync-query
              @total="testCasesTotal = $event"
            />
          </template>

          <!-- COMPARE TAB -->
          <template #compare>
            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <p class="text-sm text-gray-600 inline-flex items-center gap-1">
                    Compare two test runs side-by-side — status changes and duration deltas
                    <HelpHint topic="project.compare" />
                  </p>
                  <UButton
                    v-if="runOptions.length >= 2"
                    icon="i-lucide-git-compare-arrows"
                    size="sm"
                    variant="outline"
                    label="Latest vs previous"
                    @click="compareLatestWithPrevious"
                  />
                </div>
              </template>

              <div class="space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                      >Run A (baseline)</label
                    >
                    <USelectMenu v-model="compareRunA" :items="runOptions" placeholder="Select run A..." />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                      >Run B (comparison)</label
                    >
                    <USelectMenu v-model="compareRunB" :items="runOptions" placeholder="Select run B..." />
                  </div>
                </div>

                <!-- Loading -->
                <div v-if="compareLoading" class="text-center py-8 text-gray-500">
                  <UIcon name="i-lucide-loader-2" class="animate-spin mr-2" />
                  Loading run data…
                </div>

                <!-- Comparison results -->
                <div v-else-if="compareRunA && compareRunB && comparisonData.length > 0" class="space-y-4">
                  <div class="space-y-2">
                    <div class="flex flex-wrap gap-4 text-sm">
                      <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1"
                        >Status changes</span
                      >
                      <UBadge v-if="comparisonSummary.newFailures > 0" color="error" variant="soft" size="lg">
                        {{ comparisonSummary.newFailures }} new failure{{
                          comparisonSummary.newFailures > 1 ? 's' : ''
                        }}
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
                      <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1"
                        >Duration changes</span
                      >
                      <UBadge v-if="comparisonSummary.regressed > 0" color="error" variant="soft" size="lg">
                        {{ comparisonSummary.regressed }} regressed
                      </UBadge>
                      <UBadge v-if="comparisonSummary.improved > 0" color="success" variant="soft" size="lg">
                        {{ comparisonSummary.improved }} improved
                      </UBadge>
                      <UBadge color="neutral" variant="soft" size="lg">
                        {{ comparisonSummary.unchanged }} unchanged
                      </UBadge>
                    </div>
                  </div>

                  <UTable
                    :data="comparisonData"
                    :columns="comparisonColumns"
                    :ui="{
                      base: 'table-fixed border-separate border-spacing-0',
                      thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                      tbody: '[&>tr]:last:[&>td]:border-b-0',
                      th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                      td: 'border-b border-default',
                    }"
                  >
                    <template #statusA-cell="{ row }">
                      <span v-if="!row.original.statusA" class="text-gray-400">&mdash;</span>
                      <UBadge
                        v-else
                        :color="getStatusColor(row.original.statusA)"
                        variant="subtle"
                        class="capitalize"
                        >{{ row.original.statusA }}</UBadge
                      >
                    </template>
                    <template #statusB-cell="{ row }">
                      <span v-if="!row.original.statusB" class="text-gray-400">&mdash;</span>
                      <UBadge
                        v-else
                        :color="getStatusColor(row.original.statusB)"
                        variant="subtle"
                        class="capitalize"
                        >{{ row.original.statusB }}</UBadge
                      >
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
                </div>

                <div v-else-if="!compareRunA || !compareRunB" class="text-center py-8 text-gray-500">
                  Select two runs to compare test results.
                </div>

                <div v-else class="text-center py-8 text-gray-500">
                  No overlapping test cases found between the selected runs.
                </div>
              </div>
            </UCard>
          </template>

          <!-- SPEC HEALTH TAB -->
          <template #spec-health>
            <SpecHealthTable :project-id="String(projectId)" />
          </template>

          <template #ai-steps>
            <AiStepCoverage :project-id="String(projectId)" />
          </template>

          <!-- QUARANTINE TAB -->
          <template #quarantine>
            <QuarantineTable :project-id="String(projectId)" :project-name="project?.name" />
          </template>

          <!-- MEMBERS TAB -->
          <template #members>
            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <p class="text-sm text-gray-600 inline-flex items-center gap-1">
                    Users with access to this project
                    <HelpHint topic="project.members" />
                  </p>
                  <UButton
                    label="Save changes"
                    icon="i-lucide-check"
                    size="sm"
                    :disabled="!membersChanged"
                    @click="handleSaveMembers"
                  />
                </div>
              </template>

              <div v-if="mergedMembers.length > 0" class="space-y-2">
                <div
                  v-for="member in mergedMembers"
                  :key="member.id"
                  class="flex items-center justify-between rounded-lg border border-default px-4 py-3"
                >
                  <div>
                    <div class="font-medium text-sm">{{ member.name || member.username }}</div>
                    <div class="text-xs text-muted flex items-center gap-2">
                      <span>@{{ member.username }}</span>
                      <UBadge
                        :color="
                          member.role === 'administrator' ? 'primary' : member.role === 'reporter' ? 'info' : 'neutral'
                        "
                        variant="subtle"
                        size="xs"
                      >
                        {{ member.role }}
                      </UBadge>
                      <span v-if="member.global" class="italic">Global access</span>
                    </div>
                  </div>
                  <UCheckbox
                    v-if="member.role !== 'administrator'"
                    :model-value="selectedMemberIds.includes(member.id)"
                    :disabled="member.global"
                    :title="member.global ? 'Has global access — remove global assignment first' : ''"
                    @change="toggleMemberSelection(member.id)"
                  />
                  <span v-else class="text-xs text-muted italic">Admin</span>
                </div>
              </div>
              <div v-else class="text-center py-8 text-muted text-sm">Loading members…</div>
            </UCard>
          </template>

          <!-- TIMELINE TAB -->
          <template #timeline>
            <ProjectTimeline
              :project-id="Number(projectId)"
              :markers="markers"
              :environments="availableEnvironments"
              :can-edit="canEditMarkers"
              :focus-marker-id="focusMarkerId"
              @changed="refreshMarkers"
              @clear-focus="focusMarkerId = null"
            />
          </template>
        </UTabs>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Delete Project Modal -->
  <ClientOnly>
    <UModal
      :open="showDeleteProjectModal"
      title="Delete project"
      @update:open="
        (val) => {
          if (!val) showDeleteProjectModal = false;
        }
      "
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            This will permanently delete <strong>{{ project?.label || project?.name }}</strong> and all its test runs,
            reports, traces, and failure clusters. This action cannot be undone.
          </p>
          <div>
            <label class="block text-sm font-medium mb-1">
              Type the project key <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ project?.name }}</code> to
              confirm:
            </label>
            <UInput
              v-model="deleteProjectConfirmInput"
              :placeholder="project?.name"
              autofocus
              @keydown.enter="handleDeleteProject"
            />
          </div>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="showDeleteProjectModal = false" />
        <UButton
          color="error"
          label="Delete project"
          icon="i-lucide-trash-2"
          :disabled="!deleteProjectConfirmValid"
          :loading="deletingProject"
          @click="handleDeleteProject"
        />
      </template>
    </UModal>
  </ClientOnly>

  <!-- Delete Run Confirm Dialog -->
  <ClientOnly>
    <UModal
      :open="confirmDeleteRunId !== null"
      title="Delete test run"
      @update:open="
        (val) => {
          if (!val) confirmDeleteRunId = null;
        }
      "
    >
      <template #body>
        <p>
          Are you sure you want to delete <strong>Run #{{ confirmDeleteRunId }}</strong
          >? This will also remove all associated test results, reports, and traces. This action cannot be undone.
        </p>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmDeleteRunId = null" />
        <UButton
          color="error"
          label="Delete"
          icon="i-lucide-trash-2"
          :loading="deletingRunId === confirmDeleteRunId"
          @click="handleDeleteRun(confirmDeleteRunId!)"
        />
      </template>
    </UModal>
  </ClientOnly>
</template>
