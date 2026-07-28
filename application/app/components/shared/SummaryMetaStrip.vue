<script setup lang="ts">
 /**
 * Footer strip for detail summary cards: a wrapping row of `MetaStripGroup`
 * facts (CI, source, versions, links…). Groups flow onto new lines as the
 * card narrows instead of competing for fixed grid columns.
 */
</script>

<template>
  <div class="flex flex-wrap items-center gap-y-1 text-sm min-w-0">
    <slot />
  </div>
</template>
