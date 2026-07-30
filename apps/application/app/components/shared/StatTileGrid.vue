<script setup lang="ts">
/**
 * Auto-fitting grid for `StatTile`s: tiles keep a minimum readable width and
 * the column count adapts to the available container width — 2 columns on
 * phones, more as space allows — with no per-page breakpoint tuning.
 */
withDefaults(
  defineProps<{
    /** Minimum tile width before the grid drops a column. */
    minTileWidth?: string;
  }>(),
  { minTileWidth: '8.5rem' },
);
</script>

<template>
  <div class="grid gap-3" :style="{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${minTileWidth}, 100%), 1fr))` }">
    <slot />
  </div>
</template>
