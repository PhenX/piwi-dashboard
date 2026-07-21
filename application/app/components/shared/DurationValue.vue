<script setup lang="ts">
// Compact duration: the numeric value followed by its unit (ms/s/m) in a faded
// color, with no space between them. Backed by the shared `splitDuration` util.
const props = withDefaults(
  defineProps<{
    /** Duration in milliseconds. */
    ms?: number | null;
    /** Text shown when `ms` is null/undefined. */
    fallback?: string;
    /** Tailwind classes for the faded unit. */
    unitClass?: string;
  }>(),
  {
    ms: null,
    fallback: '—',
    unitClass: 'text-gray-400/70 dark:text-gray-500/70',
  },
);

const parts = computed(() => splitDuration(props.ms));
</script>

<template>
  <span class="tabular-nums">
    <template v-if="parts"
      >{{ parts.value }}<span :class="unitClass">{{ parts.unit }}</span></template
    ><template v-else>{{ fallback }}</template>
  </span>
</template>
