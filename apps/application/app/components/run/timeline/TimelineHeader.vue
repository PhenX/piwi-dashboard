<script setup lang="ts">
defineProps<{
  workerCount: number;
  shardTotal?: number | null;
  testCount: number;
  hookCount: number;
  waitCount: number;
  /** Whether the run has any setup/hook/fixture/wait spans to reveal. */
  hasNonTestSpans: boolean;
  /** Current state of the one span toggle. */
  showHooksAndWaits: boolean;
  live?: boolean;
}>();

defineEmits<{
  reset: [];
  toggleHooksAndWaits: [visible: boolean];
}>();
</script>

<template>
  <div class="flex items-center justify-between mb-2">
    <span class="text-xs text-gray-500 inline-flex items-center gap-1"
      ><span
        >{{ workerCount }} worker{{ workerCount > 1 ? 's' : '' }}
        <template v-if="shardTotal && shardTotal > 1">
          &middot; {{ shardTotal }} shard{{ shardTotal > 1 ? 's' : '' }}
        </template>
        &middot; {{ testCount }} tests
        <template v-if="hookCount > 0"> &middot; {{ hookCount }} hooks </template>
        <template v-if="waitCount > 0"> &middot; {{ waitCount }} waits </template></span
      >
      <HelpHint topic="run.timeline" />
    </span>
    <div class="flex items-center gap-1">
      <USwitch
        v-if="hasNonTestSpans"
        :model-value="showHooksAndWaits"
        label="Show hooks and waits"
        size="xs"
        class="mr-1"
        @update:model-value="$emit('toggleHooksAndWaits', $event === true)"
      />

      <UButton
        v-if="!live"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-rotate-ccw"
        @click="$emit('reset')"
      >
        Reset view
      </UButton>
    </div>
  </div>
</template>
