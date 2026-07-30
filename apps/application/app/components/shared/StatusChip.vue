<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui';

/**
 * Status verdict for detail summaries: icon and label in a single subtle
 * badge. The icon spins while the status is in flight.
 */
defineProps<{
  status: string;
  size?: BadgeProps['size'];
}>();
</script>

<template>
  <UBadge
    :color="getStatusColor(status)"
    :size="size"
    variant="subtle"
    class="capitalize gap-1 items-center font-semibold shrink-0"
  >
    <UIcon
      :name="getStatusIcon(status)"
      class="size-3.5 shrink-0"
      :class="{ 'animate-spin': isStatusInFlight(status) }"
    />
    {{ formatStatusLabel(status) }}
  </UBadge>
</template>
