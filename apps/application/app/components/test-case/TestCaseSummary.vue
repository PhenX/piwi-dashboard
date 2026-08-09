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
  /** Piwi project id/name, threaded into `OpenInIdeLink` for workspace overrides. */
  projectKey?: number | string;
  projectName?: string;
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

const showCiGroup = computed(() => !!(props.ciInfo || props.environment));

/** Per-attempt outcomes `{ retry, status, duration, startedAt }`, oldest first. */
const attempts = computed(() => props.testCase?.attempts ?? null);

function attemptColor(status: string): 'success' | 'error' | 'neutral' {
  if (status === 'passed') return 'success';
  if (status === 'failed' || status === 'timedout' || status === 'timedOut') return 'error';
  return 'neutral';
}

function attemptTitle(a: { retry: number; status: string; duration: number; startedAt: number | null }): string {
  const when = a.startedAt ? ` at ${new Date(a.startedAt).toLocaleString()}` : '';
  return `Attempt ${a.retry + 1}: ${a.status} (${Math.round(a.duration)} ms)${when}`;
}
</script>

<template>
  <FoldableSummary storage-key="test-case">
    <template #folded>
      <StatusChip :status="testCase?.status ?? ''" size="sm" />
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
    <div class="@container">
      <UCard class="shadow-xs" :ui="{ footer: 'px-4 py-2.5 sm:px-4 bg-muted/30' }">
        <div class="space-y-3">
          <!-- Identity row. The right padding keeps the fold chevron clear. -->
          <div class="flex items-start gap-2.5 pr-8">
            <StatusChip :status="testCase?.status ?? ''" class="mt-0.5" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h2 class="text-base font-bold truncate max-w-full">
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
                <TestMetaBadges :tags="testCase?.tags" :meta="testCase?.testMeta" />
              </div>
              <p class="text-xs text-gray-500 mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                <OpenInIdeLink
                  v-if="testCase?.location"
                  :location="testCase.location"
                  :project-key="projectKey"
                  :project-name="projectName"
                />
                <ClientOnly>
                  <span v-if="startedAtMs" class="text-gray-400" :title="new Date(startedAtMs).toLocaleString()">
                    started {{ formatRelativeTime(startedAtMs) }}
                  </span>
                </ClientOnly>
                <span v-if="historicalTiming">
                  Avg <DurationValue :ms="historicalTiming.avg" /> &middot;
                  <span :class="historicalTiming.diff > 0 ? 'text-red-600' : 'text-green-600'">
                    {{ historicalTiming.diff > 0 ? '+' : '' }}{{ historicalTiming.pct }}%
                  </span>
                </span>
              </p>
            </div>
          </div>

          <StatTileGrid>
            <StatTile label="Duration">
              <DurationValue :ms="testCase?.duration" />
            </StatTile>
            <StatTile label="Attempts" size="sm">
              <template v-if="attempts && attempts.length > 1">
                <div class="flex items-center gap-1 flex-wrap">
                  <UBadge
                    v-for="a in attempts"
                    :key="a.retry"
                    :color="attemptColor(a.status)"
                    variant="soft"
                    size="sm"
                    class="font-mono"
                    :title="attemptTitle(a)"
                  >
                    {{ a.retry + 1 }}/{{ attempts.length }}
                    <UIcon :name="a.status === 'passed' ? 'i-lucide-check' : 'i-lucide-x'" class="w-3 h-3" />
                  </UBadge>
                </div>
              </template>
              <!-- One attempt, or a row recorded before attempts were stored:
                   show the count, which is one more than the retry index. -->
              <template v-else>{{ attempts?.length ?? (testCase?.retries ?? 0) + 1 }}</template>
            </StatTile>
            <StatTile label="Steps" :value="stepsCount" />
            <StatTile label="Worker" :value="testCase?.workerIndex ?? '—'" />
          </StatTileGrid>

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

        <template #footer>
          <SummaryMetaStrip>
            <MetaStripGroup v-if="scmInfo" label="Source" icon="i-lucide-git-branch">
              <span v-if="scmInfo.branch" class="font-medium">{{ scmInfo.branch }}</span>
              <code
                v-if="scmInfo.commit"
                class="text-xs font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded"
                :title="scmInfo.commit"
                >{{ scmInfo.commit.length >= 8 ? scmInfo.commit.substring(0, 8) : scmInfo.commit }}</code
              >
              <span v-if="scmInfo.author" class="text-muted">{{ scmInfo.author }}</span>
              <span
                v-if="scmInfo.commitMessage"
                class="text-xs text-dimmed truncate max-w-[40ch]"
                :title="scmInfo.commitMessage"
                >{{ scmInfo.commitMessage }}</span
              >
            </MetaStripGroup>

            <MetaStripGroup v-if="showCiGroup" label="CI & environment" icon="i-lucide-cloud" help="run.ci-env">
              <span v-if="environment" class="rounded-full border border-default px-2 py-0.5 text-xs bg-elevated/60">{{
                environment
              }}</span>
              <span v-if="ciInfo?.provider">{{ ciInfo.provider }}</span>
              <template v-if="ciInfo?.buildNumber || ciInfo?.buildUrl">
                <span class="text-dimmed">·</span>
                <a
                  v-if="ciInfo?.buildUrl"
                  :href="ciInfo.buildUrl"
                  target="_blank"
                  class="text-primary hover:underline"
                  >{{ ciInfo?.buildNumber ? `Build #${ciInfo.buildNumber}` : 'View build' }}</a
                >
                <span v-else>Build #{{ ciInfo.buildNumber }}</span>
              </template>
              <template v-if="ciInfo?.workflow || ciInfo?.jobName">
                <span class="text-dimmed">·</span>
                <span class="text-muted">
                  <template v-if="ciInfo?.workflow">{{ ciInfo.workflow }}</template>
                  <template v-if="ciInfo?.workflow && ciInfo?.jobName"> · </template>
                  <template v-if="ciInfo?.jobName">{{ ciInfo.jobName }}</template>
                </span>
              </template>
            </MetaStripGroup>

            <MetaStripGroup v-if="browser" label="Browser">
              <BrowserBadge :browser="{ ...browser, viewport: undefined }" size="sm" />
              <span v-if="browser.viewport" class="tabular-nums text-muted">
                {{ browser.viewport.width }}×{{ browser.viewport.height }}
                <span v-if="browser.deviceScaleFactor && browser.deviceScaleFactor !== 1" class="text-dimmed"
                  >@{{ browser.deviceScaleFactor }}x</span
                >
              </span>
            </MetaStripGroup>

            <MetaStripGroup label="Links" icon="i-lucide-link">
              <EntityLinks
                v-if="testCase?.executionId"
                entity-type="test_case"
                :entity-id="testCase.executionId"
                :links="stableLinks ?? null"
                @updated="$emit('refresh')"
              />
            </MetaStripGroup>
          </SummaryMetaStrip>
        </template>
      </UCard>
    </div>
  </FoldableSummary>
</template>
