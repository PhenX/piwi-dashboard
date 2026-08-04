<script setup lang="ts">
/**
 * Live activity strip for a running test run: one chip per worker showing the
 * step it is on right now, fed by the run stream's `step-begin`/`step-end`
 * events (transient — nothing is persisted from them).
 */

export interface LiveActivityStep {
  title: string;
  category?: string | null;
  status?: string | null;
}

const props = defineProps<{
  /** Worker index → the step the worker is currently on. */
  steps: Record<number, LiveActivityStep | undefined>;
}>();

const entries = computed(() =>
  Object.entries(props.steps)
    .filter((entry): entry is [string, LiveActivityStep] => !!entry[1])
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([worker, step]) => ({ worker: Number(worker), step })),
);
</script>

<template>
  <div class="flex items-center gap-1.5 flex-wrap text-sm" data-testid="live-activity">
    <span class="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ui-text-muted)]">
      <UIcon name="i-lucide-radio" class="w-3.5 h-3.5 text-blue-500 animate-pulse" />
      Live activity
    </span>
    <UBadge
      v-for="entry in entries"
      :key="entry.worker"
      color="info"
      variant="soft"
      size="sm"
      class="gap-1.5 font-mono"
    >
      <span class="text-[var(--ui-text-muted)]">W{{ entry.worker }}</span>
      <span class="truncate max-w-64 font-sans">{{ entry.step.title }}</span>
      <UIcon
        v-if="entry.step.status"
        :name="entry.step.status === 'failed' ? 'i-lucide-x' : 'i-lucide-check'"
        :class="entry.step.status === 'failed' ? 'text-rose-500' : 'text-emerald-500'"
        class="w-3 h-3 shrink-0"
      />
      <UIcon v-else name="i-lucide-loader-circle" class="w-3 h-3 animate-spin shrink-0" />
    </UBadge>
  </div>
</template>
