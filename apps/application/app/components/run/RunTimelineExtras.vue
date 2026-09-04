<script setup lang="ts">
/**
 * The two summaries that sit beneath the workers timeline: the ten slowest
 * executions in the run (as the shared TestRow) and how the run's tests spread
 * across parallel workers, with a note when one worker carried far more than
 * another. Both read the run's own executions — no baseline, so they render for
 * any finished run.
 */
import { computed } from 'vue';
import type { TestCaseResult } from '~~/types/api';

const props = defineProps<{
  testCases: TestCaseResult[];
  clusterMeta?: Record<number, { name: string; status: string | null }>;
  projectKey?: string | number | null;
  projectName?: string | null;
}>();

const slowest = computed(() =>
  [...props.testCases]
    .filter((tc) => tc.duration != null)
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, 10),
);

const workerCounts = computed(() => {
  const counts = new Map<number, number>();
  for (const tc of props.testCases) {
    if (tc.workerIndex != null && tc.workerIndex >= 0) {
      counts.set(tc.workerIndex, (counts.get(tc.workerIndex) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([workerIndex, count]) => ({ workerIndex, count }))
    .sort((a, b) => a.workerIndex - b.workerIndex);
});

const maxWorkerCount = computed(() => Math.max(1, ...workerCounts.value.map((w) => w.count)));

// One worker doing far more than another points at poor parallelization.
const imbalanceWarning = computed<string | null>(() => {
  const counts = workerCounts.value;
  if (counts.length < 2) return null;
  const max = Math.max(...counts.map((w) => w.count));
  const min = Math.min(...counts.map((w) => w.count));
  if (min > 0 && max >= min * 1.5) {
    const maxW = counts.find((w) => w.count === max)?.workerIndex;
    const minW = counts.find((w) => w.count === min)?.workerIndex;
    const ratio = Math.round((max / min) * 10) / 10;
    return `Worker W${maxW} ran ${ratio}× more tests than worker W${minW}`;
  }
  return null;
});

function clusterName(tc: TestCaseResult): string | null {
  return tc.failureClusterId != null ? (props.clusterMeta?.[tc.failureClusterId]?.name ?? null) : null;
}
</script>

<template>
  <div class="space-y-4">
    <SectionCard v-if="slowest.length > 0" icon="i-lucide-clock" icon-class="text-amber-500" title="Slowest tests">
      <div class="-m-4">
        <TestRow
          v-for="tc in slowest"
          :key="tc.executionId"
          :test-case="tc"
          :cluster-name="clusterName(tc)"
          :project-key="projectKey"
          :project-name="projectName"
        />
      </div>
    </SectionCard>

    <SectionCard
      v-if="workerCounts.length > 1"
      icon="i-lucide-users"
      icon-class="text-gray-500"
      title="Worker distribution"
    >
      <div v-if="imbalanceWarning" class="flex items-center gap-1.5 text-xs text-amber-600 mb-3">
        <UIcon name="i-lucide-alert-triangle" class="size-3.5 shrink-0" />
        <span>{{ imbalanceWarning }}</span>
      </div>
      <div class="flex items-end gap-2 h-20">
        <div v-for="w in workerCounts" :key="w.workerIndex" class="flex-1 flex flex-col items-center gap-1">
          <span class="text-xs text-muted tabular-nums">{{ w.count }}</span>
          <div
            class="w-full bg-blue-400 rounded-t"
            :style="{ height: Math.max(4, (w.count / maxWorkerCount) * 60) + 'px' }"
          />
          <span class="text-xs text-muted">W{{ w.workerIndex }}</span>
        </div>
      </div>
    </SectionCard>
  </div>
</template>
