<script setup lang="ts">
/**
 * The first thing on a failing execution's Diagnosis tab: the one-line
 * headline that explains the failure, in large type with the locator as code,
 * then one row of facts — why it failed, since when and on which commit, the
 * cluster it shares with other tests in the run, and who owns the test. The
 * raw error stays verbatim in the Error card right below.
 */
import type { FailureVerdict, FailureWhy } from '#shared/failure-verdict';
import type { FailureClue } from '#shared/failure-clues';

const props = defineProps<{ verdict: FailureVerdict; topClue?: FailureClue | null }>();

const STRENGTH_COLOR: Record<FailureClue['strength'], 'error' | 'warning' | 'neutral'> = {
  strong: 'error',
  medium: 'warning',
  weak: 'neutral',
};

const WHY: Record<FailureWhy, { label: string; color: 'error' | 'warning' | 'neutral'; icon: string; title: string }> =
  {
    'new-regression': {
      label: 'New regression',
      color: 'error',
      icon: 'i-lucide-git-pull-request-arrow',
      title: 'Passed in the baseline run, failing here',
    },
    'passed-on-retry': {
      label: 'Passed on retry',
      color: 'warning',
      icon: 'i-lucide-refresh-cw',
      title: 'A later attempt of this test passed in the same run',
    },
    'new-flaky': {
      label: 'New flaky',
      color: 'warning',
      icon: 'i-lucide-shuffle',
      title: 'Newly started passing only on retry',
    },
    infrastructure: {
      label: 'Infrastructure',
      color: 'neutral',
      icon: 'i-lucide-server-crash',
      title: 'A navigation or browser failure rather than an assertion on the app',
    },
  };

const why = computed(() => (props.verdict.why ? WHY[props.verdict.why] : null));
const since = computed(() => props.verdict.since);
const commitTitle = computed(() => {
  const c = since.value.commit;
  if (!c) return undefined;
  return [c.message, c.branch ? `on ${c.branch}` : null].filter(Boolean).join(' — ') || undefined;
});
</script>

<template>
  <UCard data-shot="failure-headline">
    <div class="flex items-start gap-3">
      <UIcon name="i-lucide-message-square-warning" class="size-6 shrink-0 mt-0.5 text-red-500" />
      <div class="min-w-0 flex-1 space-y-2">
        <h2 class="text-lg sm:text-xl font-semibold leading-snug text-highlighted flex items-start gap-1">
          <FailureHeadline :parts="verdict.parts" />
          <HelpHint topic="case.headline" class="mt-1" />
        </h2>
        <p v-if="verdict.detail" class="font-mono text-xs text-muted truncate" :title="verdict.detail">
          {{ verdict.detail }}
        </p>

        <!-- The strongest deterministic clue, in one line — the CluesCard lists them all. -->
        <p v-if="topClue" class="flex items-start gap-1.5 text-sm text-toned">
          <UBadge :color="STRENGTH_COLOR[topClue.strength]" variant="subtle" size="sm" class="mt-0.5 shrink-0">
            The one clue
          </UBadge>
          <span class="min-w-0"
            ><span class="font-medium text-highlighted">{{ topClue.title }}</span> — {{ topClue.detail }}</span
          >
        </p>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
          <UBadge
            v-if="why"
            :color="why.color"
            variant="subtle"
            size="sm"
            :title="why.title"
            class="inline-flex items-center gap-1"
          >
            <UIcon :name="why.icon" class="size-3 shrink-0" />
            {{ why.label }}
          </UBadge>

          <span v-if="since.isFirstFailure" class="inline-flex items-center gap-1">
            <UIcon name="i-lucide-sparkle" class="size-3.5 shrink-0" />
            First failure in this run
          </span>
          <span v-else class="inline-flex items-center gap-1">
            <UIcon name="i-lucide-history" class="size-3.5 shrink-0" />
            Failing since
            <NuxtLink :to="`/test-runs/${since.firstFailingRunId}`" class="text-primary hover:underline">
              run #{{ since.firstFailingRunId }}
            </NuxtLink>
            <ClientOnly>
              <span v-if="since.firstFailingAt">({{ formatRelativeTime(since.firstFailingAt) }})</span>
            </ClientOnly>
          </span>

          <span v-if="since.commit" class="inline-flex items-center gap-1 min-w-0" :title="commitTitle">
            <UIcon name="i-lucide-git-commit-horizontal" class="size-3.5 shrink-0" />
            <code class="font-mono text-xs">{{ since.commit.shortSha }}</code>
            <span v-if="since.commit.author" class="truncate">by {{ since.commit.author }}</span>
          </span>

          <NuxtLink
            v-if="verdict.cluster && verdict.cluster.otherTestsInRun > 0"
            :to="`/failure-clusters/${verdict.cluster.id}`"
            class="inline-flex items-center gap-1 text-primary hover:underline min-w-0"
            :title="verdict.cluster.name"
          >
            <UIcon name="i-lucide-layers" class="size-3.5 shrink-0" />
            <span class="truncate"
              >Same failure in {{ verdict.cluster.otherTestsInRun }} other
              {{ verdict.cluster.otherTestsInRun === 1 ? 'test' : 'tests' }} in this run</span
            >
          </NuxtLink>

          <span
            v-if="verdict.owner"
            class="inline-flex items-center gap-1"
            :title="`Owner from ${verdict.owner.source}`"
          >
            <UIcon name="i-lucide-user-round" class="size-3.5 shrink-0" />
            Owner: <span class="text-highlighted">{{ verdict.owner.name }}</span>
          </span>
        </div>
      </div>
    </div>
  </UCard>
</template>
