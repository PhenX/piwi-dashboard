<script setup lang="ts">
/**
 * A filmstrip of the page *before* each step, from this run's trace screen
 * snapshots (Playwright 1.63 `snapshots.screen`). One thumbnail per step in
 * order, the failing step marked. Renders nothing when the trace carries no
 * screen snapshots.
 */
import { useTraceSnapshots } from '~/composables/useTraceSnapshots';

const props = defineProps<{ testRunsCaseId: number }>();

const { steps, hasScreen, snapshotUrl } = useTraceSnapshots(() => props.testRunsCaseId);

// One frame per step that recorded a before screenshot, in trace order.
const frames = computed(() =>
  steps.value.filter((s) => s.screen.before).map((s) => ({ ...s, src: snapshotUrl(s.callId, 'screen', 'before') })),
);
</script>

<template>
  <section v-if="hasScreen && frames.length" aria-label="Filmstrip of the page before each step" class="space-y-1.5">
    <div class="flex items-center gap-1.5 text-[11px] font-medium text-muted">
      <UIcon name="i-lucide-film" class="size-3.5" />
      <span>Before each step</span>
    </div>
    <ol class="flex gap-2 overflow-x-auto pb-1">
      <li v-for="(frame, i) in frames" :key="frame.callId" class="shrink-0">
        <figure class="w-40 space-y-1">
          <img
            :src="frame.src"
            :alt="`Page before step ${i + 1}: ${frame.title}`"
            loading="lazy"
            class="h-24 w-40 rounded border object-cover object-top"
            :class="frame.failed ? 'border-red-500 ring-1 ring-red-500' : 'border-default'"
          />
          <figcaption
            class="truncate text-[11px]"
            :class="frame.failed ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted'"
          >
            <span class="tabular-nums">{{ i + 1 }}.</span> {{ frame.title }}
            <span v-if="frame.failed" class="ml-0.5" aria-label="failed">✗</span>
          </figcaption>
        </figure>
      </li>
    </ol>
  </section>
</template>
