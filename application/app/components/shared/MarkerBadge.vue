<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui';
import type { MarkerInfo } from '~~/types/api';
import { getMarkerCategory } from '#shared/marker-categories';

const props = withDefaults(
  defineProps<{
    marker: MarkerInfo;
    size?: BadgeProps['size'];
    /** Show the category label instead of the marker label. */
    categoryOnly?: boolean;
  }>(),
  { size: 'sm', categoryOnly: false },
);

const category = computed(() => getMarkerCategory(props.marker.category));
</script>

<template>
  <UBadge :color="category.color" :size="size" variant="subtle" class="gap-1 items-center max-w-full">
    <UIcon :name="category.icon" class="size-3 shrink-0" />
    <span class="truncate">{{ categoryOnly ? category.label : marker.label }}</span>
    <UIcon
      v-if="marker.source === 'auto'"
      name="i-lucide-sparkles"
      class="size-3 shrink-0 opacity-70"
      title="Automatically detected"
    />
  </UBadge>
</template>
