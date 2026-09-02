<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { TestCaseResult, SetupStepEvent } from '~~/types/api';
import { useTimelineModel, type TimelineItem, type TimelineItemKind } from '~/composables/useTimelineModel';
import { useTimelineViewport } from '~/composables/useTimelineViewport';

const props = defineProps<{
  testCases: TestCaseResult[];
  setupSteps?: SetupStepEvent[] | null;
  shardTotal?: number | null;
  live?: boolean;
  /** Allowlist of glob patterns classifying which waits count as wasted time. */
  wastedPatterns?: string[] | null;
}>();

const emit = defineEmits<{
  selectTestCase: [id: number];
}>();

const { timelineData, workerRows, shardGroups, maxTime } = useTimelineModel(props);

const containerRef = ref<HTMLElement | null>(null);
const rowCount = computed(() => workerRows.value.length);
const hasData = computed(() => timelineData.value.length > 0);

const {
  panX,
  isPanning,
  contentWidth,
  contentHeight,
  getBarX,
  getBarWidth,
  getBarTop,
  tickMarks,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  resetView,
} = useTimelineViewport({ containerRef, maxTime, rowCount, hasData, live: () => props.live });

// Header counts (tests vs. hook/fixture/setup segments vs. wasted waits).
const testCount = computed(() => timelineData.value.filter((d) => d.kind === 'test').length);
const hookCount = computed(() => timelineData.value.filter((d) => d.kind !== 'test' && d.kind !== 'wait').length);
const waitCount = computed(() => timelineData.value.filter((d) => d.kind === 'wait').length);

// Span kinds the timeline can draw, toggled from the header dropdown. Only the
// kinds actually present in the run are offered.
const SPAN_KIND_ORDER: TimelineItemKind[] = ['test', 'setup', 'hook', 'fixture', 'wait'];
const SPAN_KIND_LABELS: Record<TimelineItemKind, string> = {
  test: 'Tests',
  setup: 'Setup (beforeAll/afterAll)',
  hook: 'Hooks',
  fixture: 'Fixtures',
  wait: 'Wasted waits',
};

// Stores only the kinds explicitly hidden; everything defaults to visible.
const hiddenKinds = ref<Partial<Record<TimelineItemKind, boolean>>>({});
const visibleItems = computed(() => timelineData.value.filter((item) => !hiddenKinds.value[item.kind]));

const spanTypeItems = computed(() => {
  const present = new Set(timelineData.value.map((item) => item.kind));
  return SPAN_KIND_ORDER.filter((k) => present.has(k)).map((k) => ({
    key: k,
    label: SPAN_KIND_LABELS[k],
    checked: !hiddenKinds.value[k],
  }));
});

function toggleSpanKind(key: string, visible: boolean) {
  hiddenKinds.value = { ...hiddenKinds.value, [key]: !visible };
}

// Tooltip state — driven by hover events from the bars.
const hoveredItem = ref<TimelineItem | null>(null);
const tooltipPos = ref({ x: 0, y: 0 });

// Re-resolve the hovered item by key when the data changes: a removed bar
// fires no mouseleave (span-type toggled off, live update dropped it), which
// would otherwise strand the tooltip; a replaced bar carries fresh data the
// tooltip should reflect.
watch(visibleItems, (items) => {
  if (!hoveredItem.value) return;
  hoveredItem.value = items.find((item) => item.key === hoveredItem.value!.key) ?? null;
});

function onBarEnter(item: TimelineItem, event: MouseEvent) {
  hoveredItem.value = item;
  tooltipPos.value = { x: event.clientX, y: event.clientY };
}

function onBarMove(event: MouseEvent) {
  tooltipPos.value = { x: event.clientX, y: event.clientY };
}

function onBarLeave() {
  hoveredItem.value = null;
}
</script>

<template>
  <div v-if="timelineData.length > 0" class="relative select-none" data-shot="run-timeline">
    <TimelineHeader
      :worker-count="workerRows.length"
      :shard-total="shardTotal"
      :test-count="testCount"
      :hook-count="hookCount"
      :wait-count="waitCount"
      :span-types="spanTypeItems"
      :live="live"
      @toggle-span="toggleSpanKind"
      @reset="resetView"
    />

    <div
      ref="containerRef"
      class="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 touch-pan-y"
      :class="{ 'cursor-grab': !isPanning, 'cursor-grabbing': isPanning }"
      :style="{ height: contentHeight + 'px' }"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <svg
        class="overflow-visible"
        :style="{ transform: `translateX(${panX}px)` }"
        :width="contentWidth"
        :height="contentHeight"
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <TimelineGrid
          :worker-rows="workerRows"
          :shard-groups="shardGroups"
          :tick-marks="tickMarks"
          :content-width="contentWidth"
          :shard-total="shardTotal"
        />

        <TimelineBar
          v-for="item in visibleItems"
          :key="item.key"
          :item="item"
          :x="getBarX(item)"
          :y="getBarTop(item)"
          :width="getBarWidth(item)"
          @select="emit('selectTestCase', $event)"
          @hover="onBarEnter"
          @move="onBarMove"
          @leave="onBarLeave"
        />
      </svg>
    </div>

    <TimelineTooltip :item="hoveredItem" :pos="tooltipPos" />
  </div>
  <EmptyState v-else icon="i-lucide-rows-3" text="No worker data available for this run." />
</template>

<style>
/*
 * Hover-dimming for timeline bars is plain CSS rather than a Vue-bound
 * `dimmed` prop: with hundreds of bars, driving it through reactive props
 * made every bar re-render on each hover change. `:has()` lets the browser
 * do it in one style recalc with no Vue/JS involved.
 */
svg:has(.timeline-bar-group:hover) .timeline-bar-group:not(:hover) .timeline-bar-shape {
  opacity: 0.4;
}
</style>
