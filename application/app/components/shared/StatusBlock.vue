<script setup lang="ts">
defineProps<{
  status: string;
  size?: 'sm' | 'md';
}>();
</script>

<template>
  <div class="flex items-center gap-2.5">
    <div
      class="shrink-0 rounded-lg flex items-center justify-center"
      :class="[
        size === 'sm' ? 'size-7' : 'size-8',
        {
          'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400': status === 'passed',
          'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400':
            status === 'failed' || status === 'timedout',
          'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400':
            status === 'cancelled' || status === 'skipped',
          'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400': status === 'didnotrun',
          'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400':
            status === 'running' || status === 'initialising' || status === 'finalizing',
        },
      ]"
    >
      <UIcon
        :name="getStatusIcon(status)"
        :class="[size === 'sm' ? 'size-3.5' : 'size-4.5', { 'animate-spin': isStatusInFlight(status) }]"
      />
    </div>
    <UBadge :color="getStatusColor(status)" variant="subtle" class="capitalize gap-1 items-center">
      <UIcon v-if="isStatusInFlight(status)" name="i-lucide-loader-circle" class="size-3 animate-spin shrink-0" />
      {{ formatStatusLabel(status) }}
    </UBadge>
  </div>
</template>
