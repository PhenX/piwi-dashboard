<script setup lang="ts">
import { isPiwiAnnotation } from '@piwitests/core/test-meta';
import type { TestCaseResult, EntityLinkInfo, TestRunScmMetadata, TestRunCiMetadata } from '~~/types/api';
import type { BrowserConfig } from '#shared/types';

interface HistoricalTiming {
  avg: number;
  current: number;
  diff: number;
  pct: number;
}

const props = defineProps<{
  testCase: TestCaseResult | null;
  scmInfo: TestRunScmMetadata | null;
  ciInfo: TestRunCiMetadata | null;
  browser: BrowserConfig | null;
  environment: string | null | undefined;
  stepsCount: number;
  historicalTiming: HistoricalTiming | null;
  stableLinks?: EntityLinkInfo[] | null;
}>();

defineEmits<{
  refresh: [];
}>();

/** At-a-glance signal badges shown next to the title (regression / flaky / retry). */
const signalBadges = computed(() => {
  const tc = props.testCase;
  if (!tc) return [] as { label: string; color: 'error' | 'warning' | 'neutral'; title: string }[];
  const out: { label: string; color: 'error' | 'warning' | 'neutral'; title: string }[] = [];
  if (tc.isNewRegression)
    out.push({
      label: 'New regression',
      color: 'error',
      title: 'Passed in the baseline run, failing here',
    });
  if (tc.isNewFlaky) out.push({ label: 'New flaky', color: 'warning', title: 'Newly started passing only on retry' });
  if (tc.status === 'passed' && (tc.retries ?? 0) > 0)
    out.push({ label: 'Passed on retry', color: 'warning', title: 'This test failed then passed on a retry' });
  return out;
});

// Playwright test marks only — `piwi:` annotations become ownership badges.
const annotations = computed(() =>
  (props.testCase?.testAnnotations ?? []).filter((ann) => !isPiwiAnnotation(ann.type)),
);

const startedAtMs = computed<number | null>(() => props.testCase?.startedAt ?? null);

const { summaryColSpanClass, blockColSpanClass } = useDetailGrid(() => {
  let count = 0;
  if (props.scmInfo) count++;
  if (props.ciInfo || props.environment || props.browser) count++; // CI / Env / Browser (merged)
  count++; // Links card always visible
  return count;
});
</script>

<template>
  <FoldableSummary storage-key="test-case">
    <template #folded>
      <StatusBlock :status="testCase?.status ?? ''" size="sm" />
      <span class="text-sm font-semibold truncate min-w-0">{{ testCase?.title }}</span>
      <div class="flex items-center gap-3 ml-auto max-sm:hidden">
        <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          Dur:
          <DurationValue :ms="testCase?.duration" class="font-bold text-gray-700 dark:text-gray-300" />
        </span>
        <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          Retries: <strong class="text-gray-700 dark:text-gray-300">{{ testCase?.retries ?? 0 }}</strong>
        </span>
        <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          Steps: <strong class="text-gray-700 dark:text-gray-300">{{ stepsCount }}</strong>
        </span>
        <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          Worker: <strong class="text-gray-700 dark:text-gray-300">{{ testCase?.workerIndex ?? '—' }}</strong>
        </span>
        <span v-if="testCase?.shardIndex != null" class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          Shard: <strong class="text-gray-700 dark:text-gray-300">{{ testCase.shardIndex }}</strong>
        </span>
      </div>
      <BrowserBadge v-if="browser" :browser="browser" size="sm" class="shrink-0 max-sm:hidden" />
    </template>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <!-- Main summary card -->
      <div :class="summaryColSpanClass">
        <UCard class="shadow-xs h-full">
          <div class="space-y-3">
            <div class="flex items-start gap-3">
              <StatusBlock :status="testCase?.status ?? ''" size="md" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 class="text-base font-bold truncate">
                    {{ testCase?.title }}
                  </h2>
                  <UBadge
                    v-for="badge in signalBadges"
                    :key="badge.label"
                    :color="badge.color"
                    variant="subtle"
                    size="xs"
                    :title="badge.title"
                  >
                    {{ badge.label }}
                  </UBadge>
                  <UBadge
                    v-for="(ann, i) in annotations"
                    :key="`ann-${i}`"
                    color="neutral"
                    variant="soft"
                    size="xs"
                    class="font-mono"
                    :title="ann.description || ann.type"
                  >
                    @{{ ann.type }}
                  </UBadge>
                  <SharedTestMetaBadges :tags="testCase?.tags" :meta="testCase?.testMeta" />
                </div>
                <p class="text-xs text-gray-500 mt-0.5">
                  <span v-if="testCase?.location">{{ testCase.location }}</span>
                  <ClientOnly>
                    <span v-if="startedAtMs" class="ml-2 text-gray-400" :title="new Date(startedAtMs).toLocaleString()">
                      started {{ formatRelativeTime(startedAtMs) }}
                    </span>
                  </ClientOnly>
                  <span v-if="historicalTiming" class="ml-2">
                    Avg <DurationValue :ms="historicalTiming.avg" /> &middot;
                    <span :class="historicalTiming.diff > 0 ? 'text-red-600' : 'text-green-600'">
                      {{ historicalTiming.diff > 0 ? '+' : '' }}{{ historicalTiming.pct }}%
                    </span>
                  </span>
                </p>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</p>
                <p class="text-xl font-bold mt-0.5">
                  <DurationValue :ms="testCase?.duration" />
                </p>
              </div>
              <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Retries</p>
                <p class="text-xl font-bold mt-0.5">
                  {{ testCase?.retries ?? 0 }}
                </p>
              </div>
              <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Steps</p>
                <p class="text-xl font-bold mt-0.5">
                  {{ stepsCount }}
                </p>
              </div>
              <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Worker</p>
                <p class="text-xl font-bold mt-0.5">
                  {{ testCase?.workerIndex ?? '—' }}
                </p>
              </div>
            </div>

            <div v-if="testCase?.slowestStep" class="flex items-center gap-2 text-sm">
              <UIcon name="i-lucide-zap" class="size-4 text-amber-500 shrink-0" />
              <span class="font-medium text-amber-700 dark:text-amber-300">Slowest step:</span>
              <span class="text-gray-700 dark:text-gray-300 truncate">{{ testCase.slowestStep }}</span>
              <span v-if="testCase.slowestStepDuration" class="text-gray-500 shrink-0"
                >(<DurationValue :ms="testCase.slowestStepDuration" />)</span
              >
            </div>

            <div v-if="(testCase?.wastedTimeMs ?? 0) > 0" class="flex items-center gap-1.5 text-sm">
              <UIcon name="i-lucide-hourglass" class="size-4 text-amber-500 shrink-0" />
              <span class="font-medium text-amber-700 dark:text-amber-300">Wasted in fixed waits:</span>
              <DurationValue :ms="testCase?.wastedTimeMs" class="text-gray-700 dark:text-gray-300" />
              <HelpHint topic="case.wasted-time" />
            </div>
          </div>
        </UCard>
      </div>

      <!-- Source -->
      <SourceInfoCard v-if="scmInfo" :scm="scmInfo" :class="blockColSpanClass" />

      <!-- CI / Env / Browser -->
      <CiEnvCard
        v-if="ciInfo || environment || browser"
        :ci="ciInfo"
        :environment="environment"
        :browser="browser"
        :class="blockColSpanClass"
      />

      <!-- Links -->
      <BlockCard :class="blockColSpanClass" title="Links" icon="i-lucide-link">
        <EntityLinks
          v-if="testCase?.id"
          entity-type="test_case"
          :entity-id="testCase.id"
          :links="stableLinks ?? null"
        />
      </BlockCard>
    </div>
  </FoldableSummary>
</template>
