<script setup lang="ts">
import type { LiveStepInfo } from '~/utils/live-steps';

/**
 * The step a running test is executing right now, shown inline on its row.
 * Replaces the bare "In progress..." placeholder while step events stream in;
 * the outcome icon lingers on the last step until the next one begins.
 */
defineProps<{ step: LiveStepInfo }>();
</script>

<template>
  <span class="inline-flex items-center gap-1 min-w-0 text-xs text-info" data-testid="live-step">
    <UIcon
      v-if="step.status"
      :name="step.status === 'failed' ? 'i-lucide-x' : 'i-lucide-check'"
      :class="step.status === 'failed' ? 'text-rose-500' : 'text-emerald-500'"
      class="size-3 shrink-0"
    />
    <UIcon v-else name="i-lucide-loader-circle" class="size-3 shrink-0 animate-spin" />
    <span class="truncate" :title="step.title">{{ step.title }}</span>
  </span>
</template>
