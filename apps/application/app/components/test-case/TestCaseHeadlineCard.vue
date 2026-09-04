<script setup lang="ts">
/**
 * The first thing on a failing execution: the one-line headline that explains
 * the failure, in large type with the locator as code, then one row of facts —
 * why it failed, since when and on which commit, the cluster it shares with
 * other tests in the run (with its triage status), and who owns the test. The
 * raw error is a *Show raw error* disclosure at the bottom of the card: the
 * first error line is the label, verbatim ANSI-rendered output on expand.
 *
 * The facts row is a `#facts` slot so another surface (the cluster or run
 * header) can supply its own; `provenance` prints a line under the headline.
 */
import { renderAnsi } from '~/utils';
import { condenseErrorText } from '#shared/error-fingerprint';
import { DIAGNOSIS_SECTION_SHORT } from '#shared/diagnosis-sections';
import { useClusterSectionLocator } from '~/composables/useClusterSectionLocator';
import type { FailureVerdict, FailureWhy } from '#shared/failure-verdict';
import type { FailureClue } from '#shared/failure-clues';

const props = defineProps<{
  verdict: FailureVerdict;
  topClue?: FailureClue | null;
  /** The cluster's triage status, shown in brackets after the cluster link. */
  clusterTriageStatus?: string | null;
  /** The raw error, verbatim — revealed by the *Show raw error* disclosure. */
  error?: string | null;
  /** A provenance label rendered under the headline (e.g. "first occurrence, run #70"). */
  provenance?: string | null;
}>();

const emit = defineEmits<{ copyFailure: [] }>();

const locator = useClusterSectionLocator();

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

function citationLabel(section: string): string {
  return DIAGNOSIS_SECTION_SHORT[section] ?? section;
}

// ── Show raw error ──────────────────────────────────────────────────────────
const showRaw = ref(false);

/** The first non-empty line of the error, ANSI stripped — the disclosure label. */
const firstErrorLine = computed(() => {
  if (!props.error) return '';
  // eslint-disable-next-line no-control-regex
  const stripped = props.error.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  return (
    stripped
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? ''
  );
});

// A clue or diagnosis citation to the error reveals and scrolls to it.
const rootEl = ref<HTMLElement | null>(null);
defineExpose({
  revealError: () => {
    showRaw.value = true;
    nextTick(() => rootEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  },
});
</script>

<template>
  <div ref="rootEl" class="scroll-mt-4">
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
          <p v-if="provenance" class="text-xs text-dimmed">{{ provenance }}</p>

          <!-- The strongest deterministic clue, in one line — the Other clues card lists the rest. -->
          <div v-if="topClue" class="space-y-1">
            <p class="flex items-start gap-1.5 text-sm text-toned">
              <UBadge :color="STRENGTH_COLOR[topClue.strength]" variant="subtle" size="sm" class="mt-0.5 shrink-0">
                The one clue
              </UBadge>
              <span class="min-w-0"
                ><span class="font-medium text-highlighted">{{ topClue.title }}</span> — {{ topClue.detail }}</span
              >
            </p>
            <div v-if="topClue.citations.length" class="flex flex-wrap items-center gap-1 pl-1">
              <template v-for="(cite, i) in topClue.citations" :key="i">
                <UButton
                  v-if="locator.canLocate(cite.section)"
                  size="xs"
                  variant="soft"
                  color="neutral"
                  icon="i-lucide-arrow-down-to-line"
                  :label="citationLabel(cite.section)"
                  :title="`Show the ${citationLabel(cite.section)} evidence`"
                  @click="locator.open(cite.section)"
                />
                <UBadge v-else size="sm" variant="soft" color="neutral">{{ citationLabel(cite.section) }}</UBadge>
              </template>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
            <slot name="facts">
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
                <span v-if="clusterTriageStatus" class="text-muted shrink-0"
                  >({{ formatTriageStatus(clusterTriageStatus) }})</span
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
            </slot>
          </div>

          <!-- Show raw error: collapsed by default, the first error line as its label. -->
          <div v-if="error" class="pt-1">
            <button
              type="button"
              class="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 min-w-0 max-w-full"
              :aria-expanded="showRaw"
              @click="showRaw = !showRaw"
            >
              <UIcon :name="showRaw ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 shrink-0" />
              <span class="shrink-0">Show raw error</span>
              <span v-if="!showRaw && firstErrorLine" class="font-mono text-gray-400 truncate min-w-0">
                — {{ firstErrorLine }}
              </span>
            </button>
            <div v-if="showRaw" class="mt-2 space-y-1">
              <div class="flex justify-end">
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-clipboard"
                  aria-label="Copy failure"
                  title="Copy failure"
                  @click="emit('copyFailure')"
                >
                  Copy failure
                </UButton>
              </div>
              <div
                class="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto rounded bg-red-50 dark:bg-red-950/20 p-3"
                v-html="renderAnsi(condenseErrorText(error))"
              />
            </div>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
