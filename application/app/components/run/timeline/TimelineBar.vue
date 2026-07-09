<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineItem } from '~/composables/useTimelineModel';
import {
  TIMELINE_LAYOUT,
  TIMELINE_WAIT_COLORS,
  timelineStatusHex,
  timelineHookFill,
  timelineHookStroke,
  formatTimelineTime,
} from '~/utils/timeline';

const props = defineProps<{
  item: TimelineItem;
  x: number;
  y: number;
  width: number;
  /** True when another bar is hovered, so this one dims. */
  dimmed: boolean;
}>();

const emit = defineEmits<{
  select: [id: number];
  hover: [item: TimelineItem, event: MouseEvent];
  move: [event: MouseEvent];
  leave: [];
}>();

const { barHeight } = TIMELINE_LAYOUT;

/** Setup steps render like hooks; they just aren't tied to a test case. */
const isHookLike = computed(() => ['setup', 'hook', 'fixture'].includes(props.item.kind));

/** Every bar with an owning test case clicks through to it (suite setup has none). */
const clickable = computed(() => props.item.testCaseId != null);
const cursorClass = computed(() => (clickable.value ? 'cursor-pointer' : 'cursor-default'));

function onClick(): void {
  if (props.item.testCaseId != null) emit('select', props.item.testCaseId);
}
</script>

<template>
  <g @mouseenter="emit('hover', item, $event)" @mousemove="emit('move', $event)" @mouseleave="emit('leave')">
    <template v-if="isHookLike">
      <rect
        :x="x"
        :y="y"
        :width="width"
        :height="barHeight"
        :rx="3"
        :ry="3"
        :fill="timelineHookFill(item.status)"
        :stroke="timelineHookStroke(item.status)"
        stroke-width="1"
        stroke-dasharray="3,2"
        class="transition-opacity duration-100"
        :class="[dimmed ? 'opacity-40' : 'opacity-80', cursorClass]"
        @click="onClick"
      />
      <text
        v-if="width > 60"
        :x="x + 4"
        :y="y + barHeight / 2 + 4"
        class="fill-gray-600 dark:fill-gray-300 text-[9px] font-medium pointer-events-none"
      >
        {{ item.title }}
      </text>
    </template>
    <template v-else-if="item.kind === 'wait'">
      <!-- slightly taller bar, offset into the row gap above/below -->
      <rect
        :x="x"
        :y="y - 3"
        :width="width"
        :height="barHeight + 6"
        :rx="2"
        :ry="2"
        :fill="TIMELINE_WAIT_COLORS.fill"
        fill-opacity="0.28"
        :stroke="TIMELINE_WAIT_COLORS.stroke"
        stroke-width="1.5"
        class="transition-opacity duration-100"
        :class="[dimmed ? 'opacity-40' : 'opacity-90', cursorClass]"
        @click="onClick"
      />
      <line
        v-if="width > 4"
        :x1="x + 1"
        :y1="y - 3"
        :x2="x + width - 1"
        :y2="y + barHeight + 3"
        :stroke="TIMELINE_WAIT_COLORS.stroke"
        stroke-width="1"
        stroke-opacity="0.25"
        class="pointer-events-none"
      />
      <line
        v-if="width > 4"
        :x1="x + width - 1"
        :y1="y - 3"
        :x2="x + 1"
        :y2="y + barHeight + 3"
        :stroke="TIMELINE_WAIT_COLORS.stroke"
        stroke-width="1"
        stroke-opacity="0.25"
        class="pointer-events-none"
      />
      <text
        v-if="width > 50"
        :x="x + 4"
        :y="y + barHeight / 2 + 4"
        class="fill-yellow-800 dark:fill-yellow-200 text-[9px] font-bold pointer-events-none"
      >
        wasted {{ formatTimelineTime(item.duration) }}
      </text>
    </template>
    <template v-else-if="item.status === 'running'">
      <circle
        :cx="x + 6"
        :cy="y + barHeight / 2"
        r="3"
        fill="#2563eb"
        filter="url(#glow)"
        class="cursor-pointer"
        :class="dimmed ? 'opacity-40' : 'opacity-90'"
        @click="onClick"
      />
      <circle
        :cx="x + 6"
        :cy="y + barHeight / 2"
        r="5"
        fill="none"
        stroke="#2563eb"
        stroke-width="1.5"
        stroke-opacity="0.4"
        filter="url(#glow)"
        class="cursor-pointer"
        :class="dimmed ? 'opacity-40' : 'opacity-90'"
        @click="onClick"
      />
    </template>
    <template v-else>
      <rect
        :x="x"
        :y="y"
        :width="width"
        :height="barHeight"
        :rx="3"
        :ry="3"
        :fill="timelineStatusHex(item.status)"
        class="transition-opacity duration-100 cursor-pointer"
        :class="dimmed ? 'opacity-40' : 'opacity-90'"
        @click="onClick"
      />
      <text
        v-if="width > 40"
        :x="x + 4"
        :y="y + barHeight / 2 + 4"
        class="fill-white text-[10px] font-medium pointer-events-none"
      >
        {{ formatTimelineTime(item.duration) }}
      </text>
    </template>
  </g>
</template>
