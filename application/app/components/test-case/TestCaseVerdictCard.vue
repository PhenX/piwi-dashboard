<script setup lang="ts">
/**
 * "What am I looking at" card for a failing test-run case. Turns the raw status +
 * regression signals + recent history into a one-glance verdict: is this a new
 * regression or a flaky test, did it retry, and how long has it been failing —
 * with a clickable status strip to jump to sibling executions.
 */
import type { TestCaseHistoryPoint } from '~~/types/api';

const props = defineProps<{
  testCase: {
    status?: string | null;
    retries?: number | null;
    isNewRegression?: boolean | null;
    isNewFlaky?: boolean | null;
  } | null;
  history: TestCaseHistoryPoint[];
  /** The current execution's test-run-case id — highlighted in the strip. */
  currentId: number;
}>();

const isFail = (s?: string | null) => s === 'failed' || s === 'timedOut';

interface Chip {
  label: string;
  color: 'error' | 'warning' | 'neutral' | 'info';
  icon: string;
  title: string;
}

const chips = computed<Chip[]>(() => {
  const tc = props.testCase;
  if (!tc) return [];
  const out: Chip[] = [];
  if (tc.isNewRegression)
    out.push({
      label: 'New regression',
      color: 'error',
      icon: 'i-lucide-git-pull-request-arrow',
      title: 'Passed in the baseline run, failing here — likely fallout from the latest change',
    });
  if (tc.isNewFlaky)
    out.push({
      label: 'New flaky',
      color: 'warning',
      icon: 'i-lucide-shuffle',
      title: 'Newly started passing only on retry — intermittent failure',
    });
  if (tc.status === 'timedOut')
    out.push({
      label: 'Timed out',
      color: 'warning',
      icon: 'i-lucide-timer-off',
      title: 'The test exceeded its timeout',
    });
  if ((tc.retries ?? 0) > 0)
    out.push({
      label: tc.status === 'passed' ? `Passed on retry ${tc.retries}` : `Retried ${tc.retries}×`,
      color: tc.status === 'passed' ? 'warning' : 'neutral',
      icon: 'i-lucide-refresh-cw',
      title: `This execution retried ${tc.retries} time${tc.retries === 1 ? '' : 's'}`,
    });
  return out;
});

/** Oldest → newest, capped, for the status strip. */
const strip = computed(() => props.history.slice(0, 24).slice().reverse());

/** Newest-first failing streak + the most recent green run. */
const verdict = computed(() => {
  const h = props.history; // desc by run start (newest first), includes the current execution
  if (!h.length) return null;
  let streak = 0;
  for (const p of h) {
    if (isFail(p.status)) streak++;
    else break;
  }
  const lastPass = h.find((p) => p.status === 'passed') ?? null;
  return { streak, lastPass, total: h.length };
});

const squareClass = (status: string) => ({
  'bg-red-500 hover:bg-red-600': isFail(status),
  'bg-green-500 hover:bg-green-600': status === 'passed',
  'bg-yellow-500 hover:bg-yellow-600': status === 'skipped',
  'bg-gray-400 hover:bg-gray-500': !['passed', 'failed', 'timedOut', 'skipped'].includes(status),
});
</script>

<template>
  <SectionCard icon="i-lucide-clipboard-check" icon-class="text-amber-500" title="Verdict" help="case.verdict">
    <div class="space-y-3">
      <!-- Signal chips -->
      <div v-if="chips.length" class="flex flex-wrap gap-1.5">
        <UBadge
          v-for="chip in chips"
          :key="chip.label"
          :color="chip.color"
          variant="subtle"
          size="sm"
          :title="chip.title"
          class="inline-flex items-center gap-1"
        >
          <UIcon :name="chip.icon" class="size-3 shrink-0" />
          {{ chip.label }}
        </UBadge>
      </div>

      <!-- Verdict sentence -->
      <p v-if="verdict" class="text-sm text-gray-600 dark:text-gray-400">
        <template v-if="verdict.streak >= 1">
          Failing for
          <strong class="text-gray-800 dark:text-gray-200">{{ verdict.streak }}</strong>
          consecutive run{{ verdict.streak === 1 ? '' : 's' }}.
          <template v-if="verdict.lastPass">
            Last passed in
            <NuxtLink :to="`/test-run-cases/${verdict.lastPass.id}`" class="text-primary hover:underline">
              run #{{ verdict.lastPass.runId }}
            </NuxtLink>
            ({{ formatRelativeTime(verdict.lastPass.startTime) }}).
          </template>
          <template v-else-if="verdict.total > 1"> No passing run in the last {{ verdict.total }} recorded. </template>
          <template v-else> First recorded run of this test. </template>
        </template>
        <template v-else-if="testCase?.status === 'passed'"> This execution passed. </template>
      </p>

      <!-- Clickable recent-status strip -->
      <div v-if="strip.length > 1">
        <p class="text-xs text-gray-400 mb-1">Recent runs (oldest → newest)</p>
        <div class="flex items-center gap-1 flex-wrap">
          <UTooltip
            v-for="point in strip"
            :key="point.id"
            :text="`Run #${point.runId}: ${point.status}`"
          >
            <NuxtLink
              :to="`/test-run-cases/${point.id}`"
              class="size-3.5 rounded-sm inline-block transition-colors"
              :class="[squareClass(point.status), point.id === currentId ? 'ring-2 ring-offset-1 ring-primary' : '']"
            />
          </UTooltip>
        </div>
      </div>
    </div>
  </SectionCard>
</template>
