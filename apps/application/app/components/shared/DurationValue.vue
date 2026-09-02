<script setup lang="ts">
// Compact duration: the numeric value followed by its unit (ms/s/m) in a faded
// color, with no space between them. Backed by the shared `splitDuration` util.
// The rounded display keeps dense rows on one line; the full, human-readable
// duration stays available on hover.
const props = withDefaults(
  defineProps<{
    /** Duration in milliseconds. */
    ms?: number | null;
    /** Text shown when `ms` is null/undefined. */
    fallback?: string;
    /** Tailwind classes for the faded unit. */
    unitClass?: string;
    /** Suppress the hover tooltip (e.g. when an ancestor already carries one). */
    noTitle?: boolean;
  }>(),
  {
    ms: null,
    fallback: '—',
    unitClass: 'text-gray-400/70 dark:text-gray-500/70',
    noTitle: false,
  },
);

const parts = computed(() => splitDuration(props.ms));

// Exact value on hover, per the UI convention for abbreviated durations.
const title = computed(() =>
  props.noTitle || props.ms === null || props.ms === undefined ? undefined : formatDuration(props.ms),
);
</script>

<template>
  <span class="tabular-nums whitespace-nowrap" :title="title">
    <template v-if="parts"
      >{{ parts.value }}<span :class="unitClass">{{ parts.unit }}</span></template
    ><template v-else>{{ fallback }}</template>
  </span>
</template>
