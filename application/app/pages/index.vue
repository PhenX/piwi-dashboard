<script setup lang="ts">
import type { HomeFilterState } from '~/components/home/HomeFilters.vue';
import type { ProjectOverview, TestRunForChart } from '~~/types/api';
import { errorMessage } from '~/utils';

useHead({ title: 'Piwi Dashboard' });

const {
  data: overview,
  error: overviewError,
  refresh: refreshOverview,
} = await useFetch<ProjectOverview[]>('/api/projects/overview', {
  default: () => [] as ProjectOverview[],
});
const {
  data: recentTestRuns,
  error: recentRunsError,
  refresh: refreshRecentRuns,
} = await useFetch<TestRunForChart[]>('/api/test-runs/recent');

useRunStream(() => Promise.all([refreshOverview(), refreshRecentRuns()]));

// A failed load must never be mistaken for "no projects yet" — that would
// render the onboarding wizard over what's actually a broken DB/API.
const loadError = computed(() => overviewError.value || recentRunsError.value);

function retryLoad(): void {
  refreshOverview();
  refreshRecentRuns();
}

// ── Filters (persisted to cookie, SSR-safe — no hydration flicker) ───────────

const filters = useCookie<HomeFilterState>('piwi-home-filters', {
  default: () => ({ environments: [], fullRunsOnly: true }),
  encode: (v) => JSON.stringify(v),
  decode: (v) => {
    try {
      return v ? (JSON.parse(v) as HomeFilterState) : { environments: [], fullRunsOnly: true };
    } catch {
      return { environments: [], fullRunsOnly: true };
    }
  },
});

const availableEnvironments = computed(() => {
  const envSet = new Set<string>();
  for (const run of recentTestRuns.value ?? []) {
    if (run.environment) envSet.add(run.environment);
  }
  for (const project of overview.value ?? []) {
    for (const run of project.recentRuns) {
      if (run.environment) envSet.add(run.environment);
    }
  }
  return [...envSet].sort();
});

// ── Filtered data ─────────────────────────────────────────────────────────────

function matchesEnv(env: string | null | undefined): boolean {
  if (filters.value.environments.length === 0) return true;
  return !!env && filters.value.environments.includes(env);
}

const filteredRecentRuns = computed(() => {
  let runs = recentTestRuns.value ?? [];
  if (filters.value.fullRunsOnly) runs = runs.filter((r) => r.isFullRun);
  if (filters.value.environments.length > 0) runs = runs.filter((r) => matchesEnv(r.environment));
  return runs;
});

const filteredOverview = computed(() => {
  let projects = overview.value ?? [];
  if (filters.value.environments.length > 0) {
    projects = projects
      .map((p) => ({
        ...p,
        recentRuns: p.recentRuns.filter((r) => matchesEnv(r.environment)),
      }))
      .filter((p) => p.recentRuns.length > 0);
  }
  return projects;
});

// ── Stat strip ────────────────────────────────────────────────────────────────

const overviewStats = computed(() => {
  const projects = filteredOverview.value;
  const totalProjects = projects.length;
  const failingNow = projects.filter((p) => p.tendency === 'failing').length;
  const flakyNow = projects.filter((p) => p.tendency === 'flaky').length;

  let totalPassed = 0;
  let totalTests = 0;
  for (const p of projects) {
    if (p.latestFullRun) {
      totalPassed += p.latestFullRun.passedTests;
      totalTests += p.latestFullRun.totalTests;
    }
  }
  const avgPassRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : null;

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const runs24h = filteredRecentRuns.value.filter((r) => new Date(r.startTime).getTime() > oneDayAgo).length;

  return { totalProjects, failingNow, flakyNow, avgPassRate, runs24h };
});

// ── Recent activity ───────────────────────────────────────────────────────────

const RUNNING_STATUSES = new Set(['running', 'initialising', 'finalizing']);
const ACTIVITY_PREVIEW_LIMIT = 6;

const activityExpanded = ref(false);

const allActivity = computed(() => {
  const runs = [...filteredRecentRuns.value];
  // Running runs first, then by start time desc
  return runs.sort((a, b) => {
    const aR = RUNNING_STATUSES.has(a.status) ? 0 : 1;
    const bR = RUNNING_STATUSES.has(b.status) ? 0 : 1;
    if (aR !== bR) return aR - bR;
    return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
  });
});

const visibleActivity = computed(() =>
  activityExpanded.value ? allActivity.value : allActivity.value.slice(0, ACTIVITY_PREVIEW_LIMIT),
);

const hasMoreActivity = computed(() => allActivity.value.length > ACTIVITY_PREVIEW_LIMIT);

const hasActivity = computed(() => filteredRecentRuns.value.length > 0);
const hasProjects = computed(() => (overview.value?.length ?? 0) > 0);

// Runs that exist (within the environment filter) but are hidden by "Full runs
// only" — without this, a project's very first (partial) run reads as if
// nothing arrived: 0 runs today, no recent activity, "No full runs" everywhere.
const hiddenPartialRunsCount = computed(() => {
  if (!filters.value.fullRunsOnly) return 0;
  const runs = recentTestRuns.value ?? [];
  const envScoped = runs.filter((r) => matchesEnv(r.environment));
  return envScoped.filter((r) => !r.isFullRun).length;
});

function showPartialRuns(): void {
  filters.value = { ...filters.value, fullRunsOnly: false };
}

// ── Pass rate helper (for activity list) ─────────────────────────────────────

function passRate(run: { passedTests: number; totalTests: number }): number {
  return run.totalTests > 0 ? Math.round((run.passedTests / run.totalTests) * 100) : 0;
}

function passRateClass(run: { passedTests: number; totalTests: number }): string {
  const rate = passRate(run);
  if (rate >= 90) return 'text-green-600 dark:text-green-400';
  if (rate >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function statusBorderClass(status: string): string {
  if (RUNNING_STATUSES.has(status)) return 'border-l-blue-400';
  if (status === 'passed') return 'border-l-green-500';
  if (status === 'failed' || status === 'timedout' || status === 'interrupted') return 'border-l-red-500';
  return 'border-l-gray-300 dark:border-l-gray-600';
}

// ── Feature highlights (empty state) ─────────────────────────────────────────

const featureHighlights = [
  {
    icon: 'i-lucide-radio',
    tagline: 'Watch your CI run live',
    title: 'Live streaming',
    description:
      'Follow test execution in real time. Investigate failures while the suite is still running — no waiting for the CI job to finish.',
  },
  {
    icon: 'i-lucide-layers',
    tagline: '10 failures, 2 root causes',
    title: 'Failure clustering',
    description:
      'Tests sharing the same error are grouped automatically. Triage one cluster instead of scrolling through unrelated failures.',
  },
  {
    icon: 'i-lucide-brain-circuit',
    tagline: 'Diagnosis grounded in your code',
    title: 'AI diagnosis',
    description:
      'AI analyzes failure clusters using your actual SCM diff, trace files, and run history — not a generic prompt.',
  },
  {
    icon: 'i-lucide-archive',
    tagline: 'Every run, forever',
    title: 'Permanent test intelligence',
    description:
      'Test results, traces, and HTML reports stored permanently. Compare runs, track flakiness trends, and never lose a CI result again.',
  },
] as const;
</script>

<template>
  <UDashboardPanel id="home">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb :items="[{ label: 'Home', icon: 'i-lucide-house', to: '/' }]" />
        </template>
        <template v-if="hasProjects" #trailing>
          <HomeFilters v-model="filters" :available-environments="availableEnvironments" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="loadError" class="p-6">
        <ErrorState :text="`Couldn't load the dashboard: ${errorMessage(loadError)}`">
          <template #action>
            <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="retryLoad">
              Retry
            </UButton>
          </template>
        </ErrorState>
      </div>

      <div v-else class="p-6 space-y-8">
        <!-- Partial runs hidden by the "Full runs only" filter — without this, a
             project's first (partial) run reads as if nothing arrived. -->
        <UAlert
          v-if="hiddenPartialRunsCount > 0"
          icon="i-lucide-info"
          color="primary"
          variant="subtle"
          :title="
            hiddenPartialRunsCount === 1
              ? '1 partial run is hidden'
              : `${hiddenPartialRunsCount} partial runs are hidden`
          "
          description="The “Full runs only” filter hides runs that only cover part of the suite (e.g. a single spec or --grep)."
          :actions="[{ label: 'Show them', color: 'primary', variant: 'solid', size: 'xs', onClick: showPartialRuns }]"
        />

        <!-- Compact stat strip (full-run-aware) -->
        <div
          v-if="hasProjects"
          class="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-6 py-4 bg-gray-50 dark:bg-gray-900/50"
        >
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-folder" class="size-4 text-primary shrink-0" />
            <span class="font-semibold tabular-nums">{{ overviewStats.totalProjects }}</span>
            <span class="text-gray-500">projects</span>
          </div>

          <div class="flex items-center gap-1.5">
            <div
              class="w-2 h-2 rounded-full shrink-0"
              :class="overviewStats.failingNow > 0 ? 'bg-red-500' : 'bg-green-500'"
            />
            <span
              class="font-semibold tabular-nums"
              :class="overviewStats.failingNow > 0 ? 'text-red-600 dark:text-red-400' : ''"
              >{{ overviewStats.failingNow }}</span
            >
            <span class="text-gray-500">failing now</span>
          </div>

          <div class="flex items-center gap-1.5">
            <div
              class="w-2 h-2 rounded-full shrink-0"
              :class="overviewStats.flakyNow > 0 ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600'"
            />
            <span
              class="font-semibold tabular-nums"
              :class="overviewStats.flakyNow > 0 ? 'text-amber-600 dark:text-amber-400' : ''"
              >{{ overviewStats.flakyNow }}</span
            >
            <span class="text-gray-500">flaky</span>
          </div>

          <div v-if="overviewStats.avgPassRate !== null" class="flex items-center gap-1.5">
            <UIcon name="i-lucide-check-circle" class="size-4 text-green-500 shrink-0" />
            <span class="font-semibold tabular-nums">{{ overviewStats.avgPassRate }}%</span>
            <span class="text-gray-500">avg pass rate</span>
          </div>

          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-play-circle" class="size-4 text-primary shrink-0" />
            <span class="font-semibold tabular-nums">{{ overviewStats.runs24h }}</span>
            <span class="text-gray-500">runs today</span>
          </div>
        </div>

        <!-- Per-project trend table + Recent activity side by side on wide screens -->
        <div v-if="hasProjects || hasActivity" class="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <div class="xl:col-span-2">
            <ProjectTrendTable v-if="hasProjects" :projects="filteredOverview" />
          </div>

          <!-- Recent activity -->
          <SectionCard v-if="hasActivity" icon="i-lucide-activity" title="Recent activity">
            <template #actions>
              <UButton
                v-if="hasMoreActivity && !activityExpanded"
                variant="ghost"
                size="sm"
                trailing-icon="i-lucide-chevron-down"
                @click="activityExpanded = true"
              >
                Show all {{ allActivity.length }}
              </UButton>
              <UButton
                v-else-if="activityExpanded"
                variant="ghost"
                size="sm"
                trailing-icon="i-lucide-chevron-up"
                @click="activityExpanded = false"
              >
                Show less
              </UButton>
            </template>

            <div class="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
              <NuxtLink
                v-for="run in visibleActivity"
                :key="run.id"
                :to="`/test-runs/${run.id}`"
                class="flex items-center gap-3 py-3 pl-3 border-l-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-r transition-colors"
                :class="statusBorderClass(run.status)"
              >
                <RunStatusBadge :status="run.status" />
                <div class="flex-1 min-w-0">
                  <div class="font-medium truncate">{{ run.projectLabel || run.projectName }}</div>
                  <div class="text-xs text-gray-400">Run #{{ run.id }} · {{ formatRelativeTime(run.startTime) }}</div>
                </div>
                <div class="text-right tabular-nums shrink-0">
                  <div :class="passRateClass(run)">{{ passRate(run) }}%</div>
                  <div v-if="run.duration" class="text-xs text-gray-400">{{ formatDuration(run.duration) }}</div>
                </div>
              </NuxtLink>
            </div>
          </SectionCard>
        </div>

        <!-- Empty state when projects exist but all filtered out -->
        <div
          v-if="hasProjects && !hasActivity && filteredOverview.length === 0"
          class="text-center py-12 text-gray-500 dark:text-gray-400"
        >
          <UIcon name="i-lucide-filter-x" class="size-8 mx-auto mb-2 opacity-40" />
          <p>No runs match the current filters.</p>
        </div>

        <!-- Empty state: setup wizard first (the actionable step), feature highlights after -->
        <template v-if="!hasProjects">
          <GetStartedWizard />

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <UCard v-for="feature in featureHighlights" :key="feature.title" class="flex flex-col">
              <div class="flex flex-col gap-3 h-full">
                <div class="p-2 bg-primary/10 rounded-lg w-fit">
                  <UIcon :name="feature.icon" class="size-5 text-primary" />
                </div>
                <div>
                  <p class="text-xs font-semibold uppercase tracking-wide text-primary mb-1">{{ feature.tagline }}</p>
                  <h3 class="font-semibold mb-1">{{ feature.title }}</h3>
                  <p class="text-sm text-gray-600 dark:text-gray-400">{{ feature.description }}</p>
                </div>
              </div>
            </UCard>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
