<script setup lang="ts">
/**
 * Streaming output pane for one local run: monospace lines, stderr in red,
 * pinned to the bottom while new lines arrive unless the user scrolled up.
 */
import type { LocalRunLine } from '~/composables/useDesktopLocalRuns';

const props = defineProps<{ lines: LocalRunLine[] }>();

const el = ref<HTMLElement | null>(null);
const pinned = ref(true);

function onScroll() {
  const node = el.value;
  if (!node) return;
  pinned.value = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
}

watch(
  () => props.lines.length,
  async () => {
    if (!pinned.value) return;
    await nextTick();
    el.value?.scrollTo({ top: el.value.scrollHeight });
  },
);

onMounted(() => {
  el.value?.scrollTo({ top: el.value.scrollHeight });
});
</script>

<template>
  <div ref="el" class="h-56 overflow-y-auto rounded-md bg-zinc-950 p-3" @scroll.passive="onScroll">
    <p
      v-for="(line, i) in lines"
      :key="i"
      class="font-mono text-xs whitespace-pre-wrap"
      :class="line.error ? 'text-red-400' : 'text-zinc-300'"
    >
      {{ line.text || ' ' }}
    </p>
    <p v-if="lines.length === 0" class="font-mono text-xs text-zinc-500">Waiting for output…</p>
  </div>
</template>
