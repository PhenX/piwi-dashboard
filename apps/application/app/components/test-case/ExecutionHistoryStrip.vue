<script setup lang="ts">
/**
 * The 24 most recent executions of this test as a row of clickable squares,
 * oldest to newest, colored by status, with the current execution ringed. Each
 * square links to its execution.
 */
import type { TestCaseHistoryPoint } from '~~/types/api';

const props = defineProps<{
  history: TestCaseHistoryPoint[];
  /** The current execution's id — ringed in the strip. */
  currentId: number;
}>();

const isFail = (s?: string | null) => s === 'failed' || s === 'timedOut' || s === 'timedout';

/** Oldest → newest, capped at 24. */
const strip = computed(() => props.history.slice(0, 24).slice().reverse());

const stripLabelId = useId();

const squareClass = (status: string) => ({
  'bg-red-500 hover:bg-red-600': isFail(status),
  'bg-green-500 hover:bg-green-600': status === 'passed',
  'bg-yellow-500 hover:bg-yellow-600': status === 'skipped',
  'bg-gray-400 hover:bg-gray-500': !isFail(status) && !['passed', 'skipped'].includes(status),
});
</script>

<template>
  <div v-if="strip.length">
    <p :id="stripLabelId" class="text-xs text-gray-400 mb-1">Recent executions of this test (oldest → newest)</p>
    <div class="flex items-center gap-1 flex-wrap" role="group" :aria-labelledby="stripLabelId">
      <UTooltip v-for="point in strip" :key="point.id" :text="`Execution in run #${point.runId}: ${point.status}`">
        <NuxtLink
          :to="`/test-run-cases/${point.id}`"
          :aria-label="`Execution in run #${point.runId}: ${formatStatusLabel(point.status)}`"
          :aria-current="point.id === currentId ? 'true' : undefined"
          class="size-3.5 rounded-sm inline-block transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="[squareClass(point.status), point.id === currentId ? 'ring-2 ring-offset-1 ring-primary' : '']"
        />
      </UTooltip>
    </div>
  </div>
</template>
