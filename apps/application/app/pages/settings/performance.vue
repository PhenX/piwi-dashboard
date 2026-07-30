<script setup lang="ts">
 /**
 * Performance — the two detectors that judge test timing live on one tab:
 * wasted-time patterns (which waits count as wasted) and timeout hygiene
 * (oversized per-test timeouts and stale `test.slow()` marks). Both feed the
 * project Performance tab and Analytics, so they are configured together.
 *
 * Each card owns its own fetch/save (`WastedTimeCard`, `TimeoutHygieneCard`),
 * so this page is just their layout.
 */
</script>

<template>
  <div class="space-y-6">
    <WastedTimeCard />
    <TimeoutHygieneCard />
  </div>
</template>
