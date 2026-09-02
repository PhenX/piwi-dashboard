<script setup lang="ts">
/**
 * The failure timeline: one SVG time axis that places this execution's steps,
 * console entries, network requests and backend log entries on the same clock,
 * with the moment of failure marked and a default window around the failed step.
 * Below the axis, the same items read as one chronological list ("what happened
 * in this window") — a click on any line reveals its section on the page. The
 * card hides itself when the timeline has fewer than two placed items.
 *
 * The data comes pre-built from `/timeline` (the pure `buildFailureTimeline`);
 * this component only draws it. Times shown are relative to the failure moment
 * (`t+0`), so the axis and the list read against the same anchor.
 */
import type { FailureTimeline, TimelineItem, TimelineLane } from '#shared/failure-timeline';
import { useClusterSectionLocator } from '~/composables/useClusterSectionLocator';
import SectionCard from '../shared/SectionCard.vue';
import ChartTooltip from '../shared/ChartTooltip.vue';
import ChartLegend from '../shared/ChartLegend.vue';
import OpenInIdeLink from '../shared/OpenInIdeLink.vue';

const props = defineProps<{
  testRunsCaseId: number;
  /** Whether a trace exists — enables the "View trace" affordance in the header. */
  hasTrace?: boolean;
  /** Piwi project id/name — passed to the open-in-IDE links for call sites. */
  projectKey?: string | number | null;
  projectName?: string | null;
}>();

const { data } = await useFetch<FailureTimeline>(`/api/test-run-cases/${props.testRunsCaseId}/timeline`);

const locator = useClusterSectionLocator();

// The page section a timeline item's ref maps to. Backend log lines live under
// the network card, so they reveal it too; steps switch to the Steps tab.
const SECTION_ACTION: Record<TimelineItem['ref']['section'], string> = {
  steps: 'steps',
  console: 'console',
  networkRequests: 'networkRequests',
  backendLogs: 'networkRequests',
};

// ── Placed items and lanes ───────────────────────────────────────────────────
const LANE_ORDER: TimelineLane[] = ['steps', 'network', 'console', 'backend'];
const LANE_LABEL: Record<TimelineLane, string> = {
  steps: 'Steps',
  network: 'Network',
  console: 'Console',
  backend: 'Backend',
};

const allItems = computed<TimelineItem[]>(() => {
  const tl = data.value;
  if (!tl) return [];
  return LANE_ORDER.flatMap((lane) => tl.lanes[lane]);
});

const placedCount = computed(() => allItems.value.length);
const visibleLanes = computed<TimelineLane[]>(() =>
  data.value ? LANE_ORDER.filter((lane) => data.value!.lanes[lane].length > 0) : [],
);

// ── Window mode ──────────────────────────────────────────────────────────────
type WindowMode = 'around' | 'whole';
const mode = ref<WindowMode>('around');
const span = computed(() => (data.value ? Math.max(1, data.value.end - data.value.origin) : 1));
const domain = computed<{ start: number; end: number }>(() => {
  const tl = data.value;
  if (!tl) return { start: 0, end: 1 };
  if (mode.value === 'whole') return { start: 0, end: span.value };
  // A degenerate window (no failed step, or zero-width) falls back to the whole run.
  const w = tl.window;
  return w.end > w.start ? { start: w.start, end: w.end } : { start: 0, end: span.value };
});

// ── SVG geometry ─────────────────────────────────────────────────────────────
const LABEL_W = 62;
const PAD_R = 12;
const TOP = 8;
const LANE_H = 22;
const AXIS_H = 18;

const CALL_BAND_H = 16;

const wrapper = ref<HTMLElement | null>(null);
const { width } = useElementSize(wrapper);
const svgWidth = computed(() => Math.max(0, width.value));
const plotLeft = LABEL_W;
const plotRight = computed(() => Math.max(plotLeft + 1, svgWidth.value - PAD_R));
const plotWidth = computed(() => plotRight.value - plotLeft);
// The "Calls" band sits above the lanes when at least one step has a call site.
const hasCallBand = computed(() => (data.value?.lanes.steps ?? []).some((s) => s.origin != null || s.group != null));
const bandH = computed(() => (hasCallBand.value ? CALL_BAND_H : 0));
const lanesTop = computed(() => TOP + bandH.value);
const lanesHeight = computed(() => visibleLanes.value.length * LANE_H);
const marksBottom = computed(() => lanesTop.value + lanesHeight.value);
const svgHeight = computed(() => marksBottom.value + AXIS_H);

function xOf(at: number): number {
  const { start, end } = domain.value;
  const t = end > start ? (at - start) / (end - start) : 0;
  return plotLeft + Math.max(0, Math.min(1, t)) * plotWidth.value;
}

/** Clamped {x, w} for a bar spanning [at, at+dur], never spilling past the plot. */
function barRect(at: number, dur: number): { x: number; w: number } {
  const x = xOf(at);
  const end = xOf(at + Math.max(0, dur));
  return { x, w: Math.max(2, end - x) };
}

function laneY(lane: TimelineLane): number {
  return lanesTop.value + visibleLanes.value.indexOf(lane) * LANE_H;
}

const failureX = computed(() => (data.value ? xOf(data.value.failureAt) : 0));
const windowShade = computed(() => {
  const tl = data.value;
  if (!tl || mode.value !== 'whole' || tl.window.end <= tl.window.start) return null;
  const x = xOf(tl.window.start);
  return { x, w: Math.max(1, xOf(tl.window.end) - x) };
});

// ── Axis ticks (relative to the failure moment) ──────────────────────────────
function formatRel(at: number): string {
  const failureAt = data.value?.failureAt ?? 0;
  const d = (at - failureAt) / 1000;
  if (Math.abs(d) < 0.05) return 't+0';
  return `t${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(1)}s`;
}

const ticks = computed(() => {
  const { start, end } = domain.value;
  const count = 5;
  return Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1));
});

// ── Marks and colors ─────────────────────────────────────────────────────────
function consoleClass(status?: string): string {
  if (status === 'error') return 'fill-red-500';
  if (status === 'warning') return 'fill-amber-500';
  return 'fill-gray-400 dark:fill-gray-500';
}
function backendClass(status?: string): string {
  if (status === 'error' || status === 'fatal') return 'fill-red-500';
  if (status === 'warn' || status === 'warning') return 'fill-amber-500';
  return 'fill-violet-500';
}
function stepClass(item: TimelineItem): string {
  return item.failed ? 'fill-red-500' : 'fill-gray-300 dark:fill-gray-600';
}
function networkClass(item: TimelineItem): string {
  return item.failed ? 'fill-red-400 dark:fill-red-500' : 'fill-sky-400/80 dark:fill-sky-500/70';
}

const legendItems = computed(() => {
  const items: { color: string; label: string }[] = [];
  if (hasCallBand.value) items.push({ color: 'rgb(129, 140, 248)', label: 'Calls' });
  if (visibleLanes.value.includes('steps')) {
    items.push({ color: 'rgb(239, 68, 68)', label: 'Failed step' });
    items.push({ color: 'rgb(156, 163, 175)', label: 'Step' });
  }
  if (visibleLanes.value.includes('network')) items.push({ color: 'rgb(56, 189, 248)', label: 'Request' });
  if (visibleLanes.value.includes('console')) items.push({ color: 'rgb(245, 158, 11)', label: 'Console' });
  if (visibleLanes.value.includes('backend')) items.push({ color: 'rgb(139, 92, 246)', label: 'Backend' });
  return items;
});

// ── Tooltip ──────────────────────────────────────────────────────────────────
const { data: hovered, pos, show, move, hide } = useChartTooltip<TimelineItem>();

// ── "What happened in this window" list ──────────────────────────────────────
const windowItems = computed<TimelineItem[]>(() => {
  const { start, end } = domain.value;
  return allItems.value
    .filter((item) => {
      const itemEnd = item.at + (item.duration ?? 0);
      return itemEnd >= start && item.at <= end;
    })
    .sort((a, b) => a.at - b.at || (a.failed ? -1 : 0));
});

function kindTag(item: TimelineItem): string {
  if (item.kind === 'console') return `console ${item.status ?? ''}`.trim();
  if (item.kind === 'backend') return `backend ${item.status ?? ''}`.trim();
  return '';
}

// ── Call context (which method / test.step each action came from) ─────────────
function basename(file: string): string {
  const parts = file.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? file;
}
/** The band/group key: the method or test.step title, else the call-site file. */
function callKey(item: TimelineItem): string | null {
  return item.group ?? item.origin?.file ?? null;
}
function callLabel(item: TimelineItem): string {
  return item.group ?? (item.origin ? basename(item.origin.file) : '');
}
/** A header names a method when its group is that method's function name. */
function isMethodHeader(item: TimelineItem): boolean {
  return item.origin?.function != null && item.origin.function === item.group;
}

/** Runs of consecutive steps that share a call site, drawn as one span in the band. */
const callSpans = computed(() => {
  const steps = data.value?.lanes.steps ?? [];
  const spans: Array<{
    id: string;
    key: string;
    label: string;
    start: number;
    end: number;
    origin: TimelineItem['origin'];
  }> = [];
  let cur: (typeof spans)[number] | null = null;
  for (const step of steps) {
    const key = callKey(step);
    if (key == null) {
      cur = null;
      continue;
    }
    const end = step.at + (step.duration ?? 0);
    if (cur && cur.key === key) {
      cur.end = Math.max(cur.end, end);
    } else {
      cur = { id: step.id, key, label: callLabel(step), start: step.at, end, origin: step.origin ?? null };
      spans.push(cur);
    }
  }
  return spans;
});

function bandTitle(span: { label: string; origin: TimelineItem['origin'] }): string {
  const where = span.origin ? ` · ${span.origin.file}:${span.origin.line}` : '';
  return `${span.label}${where}`;
}

/** The window list, with a header row before each run of same-origin actions. */
type WindowRow = { kind: 'header'; item: TimelineItem } | { kind: 'item'; item: TimelineItem; indented: boolean };
const windowRows = computed<WindowRow[]>(() => {
  const out: WindowRow[] = [];
  let curKey: string | null = null;
  for (const item of windowItems.value) {
    const key = item.kind === 'step' ? (item.group ?? null) : null;
    if (key !== curKey) {
      curKey = key;
      if (key != null) out.push({ kind: 'header', item });
    }
    // A `test.step` entry is shown as the group header, not as an event line too.
    if (item.kind === 'step' && item.category === 'test.step') continue;
    out.push({ kind: 'item', item, indented: key != null });
  }
  return out;
});

function revealItem(item: TimelineItem) {
  const sectionId = SECTION_ACTION[item.ref.section];
  if (locator.canLocate(sectionId)) locator.open(sectionId);
}

function onViewTrace() {
  // The bundled viewer has no time deep-link, so this reveals the evidence card
  // that holds the trace and its "View trace" button.
  if (locator.canLocate('tracePointers')) locator.open('tracePointers');
}
</script>

<template>
  <SectionCard v-if="data && placedCount >= 2" icon="i-lucide-activity" title="Failure timeline" help="case.timeline">
    <template #actions>
      <ChartLegend :items="legendItems" class="mr-1" />
      <UButton
        v-if="hasTrace"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-film"
        label="View trace"
        @click="onViewTrace"
      />
    </template>

    <div class="space-y-3">
      <!-- Window controls -->
      <div class="flex items-center gap-1">
        <UButton
          size="xs"
          :variant="mode === 'around' ? 'solid' : 'soft'"
          :color="mode === 'around' ? 'primary' : 'neutral'"
          label="Around the failure"
          @click="mode = 'around'"
        />
        <UButton
          size="xs"
          :variant="mode === 'whole' ? 'solid' : 'soft'"
          :color="mode === 'whole' ? 'primary' : 'neutral'"
          label="Whole test"
          @click="mode = 'whole'"
        />
      </div>

      <!-- SVG axis -->
      <div ref="wrapper" class="w-full">
        <svg v-if="plotWidth > 0" :width="svgWidth" :height="svgHeight" class="block">
          <!-- Default-window shade (only meaningful in whole-test view) -->
          <rect
            v-if="windowShade"
            :x="windowShade.x"
            :y="TOP"
            :width="windowShade.w"
            :height="marksBottom - TOP"
            class="fill-gray-400/10 dark:fill-gray-300/5"
          />

          <!-- Calls band: which method / test.step each run of actions came from -->
          <g v-if="hasCallBand">
            <text
              :x="0"
              :y="TOP + CALL_BAND_H / 2"
              dominant-baseline="middle"
              class="fill-gray-500 dark:fill-gray-400 text-[10px]"
            >
              Calls
            </text>
            <g v-for="span in callSpans" :key="span.id">
              <rect
                :x="barRect(span.start, span.end - span.start).x"
                :y="TOP + 2"
                :width="barRect(span.start, span.end - span.start).w"
                :height="CALL_BAND_H - 4"
                rx="2"
                class="fill-indigo-400/70 dark:fill-indigo-500/60"
              >
                <title>{{ bandTitle(span) }}</title>
              </rect>
              <text
                v-if="barRect(span.start, span.end - span.start).w > 44"
                :x="barRect(span.start, span.end - span.start).x + 4"
                :y="TOP + CALL_BAND_H / 2"
                dominant-baseline="middle"
                class="fill-white text-[9px] pointer-events-none"
                :style="{ clipPath: `inset(0 0 0 0)` }"
              >
                {{
                  span.label.length > Math.floor((barRect(span.start, span.end - span.start).w - 8) / 5.5)
                    ? span.label.slice(
                        0,
                        Math.max(1, Math.floor((barRect(span.start, span.end - span.start).w - 8) / 5.5) - 1),
                      ) + '…'
                    : span.label
                }}
              </text>
            </g>
          </g>

          <!-- Lane rows -->
          <g v-for="lane in visibleLanes" :key="lane">
            <text
              :x="0"
              :y="laneY(lane) + LANE_H / 2"
              dominant-baseline="middle"
              class="fill-gray-500 dark:fill-gray-400 text-[10px]"
            >
              {{ LANE_LABEL[lane] }}
            </text>
            <line
              :x1="plotLeft"
              :x2="plotRight"
              :y1="laneY(lane) + LANE_H"
              :y2="laneY(lane) + LANE_H"
              class="stroke-gray-100 dark:stroke-gray-800"
            />
          </g>

          <!-- Step bars -->
          <template v-for="item in data.lanes.steps" :key="item.id">
            <rect
              :x="barRect(item.at, item.duration ?? 0).x"
              :y="laneY('steps') + 4"
              :width="barRect(item.at, item.duration ?? 0).w"
              :height="LANE_H - 8"
              rx="2"
              class="cursor-pointer"
              :class="stepClass(item)"
              @click="revealItem(item)"
              @mouseenter="show($event, item)"
              @mousemove="move($event)"
              @mouseleave="hide()"
            />
          </template>

          <!-- Network bars -->
          <template v-for="item in data.lanes.network" :key="item.id">
            <rect
              :x="barRect(item.at, item.duration ?? 0).x"
              :y="laneY('network') + 4"
              :width="barRect(item.at, item.duration ?? 0).w"
              :height="LANE_H - 8"
              rx="2"
              class="cursor-pointer"
              :class="networkClass(item)"
              @click="revealItem(item)"
              @mouseenter="show($event, item)"
              @mousemove="move($event)"
              @mouseleave="hide()"
            />
          </template>

          <!-- Console marks -->
          <template v-for="item in data.lanes.console" :key="item.id">
            <circle
              :cx="xOf(item.at)"
              :cy="laneY('console') + LANE_H / 2"
              r="4"
              class="cursor-pointer"
              :class="consoleClass(item.status)"
              @click="revealItem(item)"
              @mouseenter="show($event, item)"
              @mousemove="move($event)"
              @mouseleave="hide()"
            />
          </template>

          <!-- Backend marks -->
          <template v-for="item in data.lanes.backend" :key="item.id">
            <circle
              :cx="xOf(item.at)"
              :cy="laneY('backend') + LANE_H / 2"
              r="4"
              class="cursor-pointer"
              :class="backendClass(item.status)"
              @click="revealItem(item)"
              @mouseenter="show($event, item)"
              @mousemove="move($event)"
              @mouseleave="hide()"
            />
          </template>

          <!-- Failure marker line -->
          <line
            :x1="failureX"
            :x2="failureX"
            :y1="TOP"
            :y2="marksBottom"
            class="stroke-red-500"
            stroke-width="1.5"
            stroke-dasharray="4 3"
          />

          <!-- Axis ticks -->
          <g>
            <text
              v-for="(tick, i) in ticks"
              :key="i"
              :x="Math.max(plotLeft, Math.min(plotRight, xOf(tick)))"
              :y="marksBottom + 12"
              :text-anchor="i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'"
              class="fill-gray-400 dark:fill-gray-500 text-[10px] tabular-nums"
            >
              {{ formatRel(tick) }}
            </text>
          </g>
        </svg>
      </div>

      <!-- Estimated-positions note -->
      <p v-if="data.estimated" class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
        <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
        Step positions are derived from durations — this run’s reporter did not record step start times.
      </p>

      <!-- What happened in this window -->
      <div>
        <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">What happened in this window</h4>
        <ul class="space-y-0.5">
          <template v-for="row in windowRows" :key="(row.kind === 'header' ? 'h-' : 'i-') + row.item.id">
            <!-- Group header: the method or test.step a run of actions came from -->
            <li
              v-if="row.kind === 'header'"
              class="text-xs font-mono px-1.5 pt-1.5 flex items-baseline gap-1 flex-wrap"
            >
              <span class="text-gray-400 dark:text-gray-500">↳</span>
              <template v-if="isMethodHeader(row.item) && row.item.origin">
                <span class="text-gray-600 dark:text-gray-300">in {{ row.item.origin.function }}()</span>
                <span class="text-gray-400">·</span>
                <OpenInIdeLink
                  :location="`${row.item.origin.file}:${row.item.origin.line}`"
                  :project-key="projectKey"
                  :project-name="projectName"
                />
                <template v-if="row.item.origin.chain[0]">
                  <span class="text-gray-400">←</span>
                  <OpenInIdeLink
                    :location="`${row.item.origin.chain[0].file}:${row.item.origin.chain[0].line}`"
                    :project-key="projectKey"
                    :project-name="projectName"
                  />
                </template>
              </template>
              <span v-else class="text-gray-600 dark:text-gray-300">{{ row.item.group }}</span>
            </li>

            <!-- One event line -->
            <li v-else>
              <button
                type="button"
                class="w-full text-left text-xs font-mono px-1.5 py-1 rounded flex items-baseline gap-2 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                :class="[row.item.failed ? 'bg-red-50 dark:bg-red-950/30' : '', row.indented ? 'pl-5' : '']"
                @click="revealItem(row.item)"
              >
                <span class="tabular-nums text-gray-400 dark:text-gray-500 shrink-0 w-14">{{
                  formatRel(row.item.at)
                }}</span>
                <span class="min-w-0 break-words">
                  <template v-if="row.item.kind === 'network'">
                    <span class="text-gray-700 dark:text-gray-300">{{ row.item.label }}</span>
                    <span class="text-gray-500"> → {{ row.item.status }}</span>
                    <span v-if="row.item.duration != null" class="text-gray-400">
                      ({{ Math.round(row.item.duration) }} ms)</span
                    >
                  </template>
                  <template v-else-if="row.item.kind === 'step'">
                    <span
                      :class="
                        row.item.failed
                          ? 'text-red-600 dark:text-red-400 font-medium'
                          : 'text-gray-700 dark:text-gray-300'
                      "
                      >{{ row.item.label }}</span
                    >
                    <span v-if="row.item.failed" class="text-red-500"> failed</span>
                    <!-- Reporter-only call site (no method group): a muted file:line suffix -->
                    <span v-if="!row.indented && row.item.origin" class="text-gray-400 dark:text-gray-500">
                      · {{ basename(row.item.origin.file) }}:{{ row.item.origin.line }}</span
                    >
                  </template>
                  <template v-else>
                    <span class="text-gray-500">{{ kindTag(row.item) }} · </span>
                    <span class="text-gray-700 dark:text-gray-300">“{{ row.item.label }}”</span>
                  </template>
                </span>
              </button>
            </li>
          </template>
        </ul>
      </div>

      <!-- What is not (yet) placed -->
      <p class="text-xs text-gray-400 dark:text-gray-500">
        Not placed on this axis yet: Web Vitals and screenshots (no capture time is recorded for them)<template
          v-if="data.unplaced.length"
          >, and {{ data.unplaced.length }} captured {{ data.unplaced.length === 1 ? 'item' : 'items' }} with no usable
          timestamp</template
        >.
      </p>
    </div>

    <Teleport to="body">
      <ChartTooltip v-if="hovered" :pos="pos">
        <p class="tabular-nums text-gray-500 dark:text-gray-400">{{ formatRel(hovered.at) }}</p>
        <p class="font-mono break-words">{{ hovered.label }}</p>
        <p v-if="hovered.kind === 'network'" class="text-gray-500">
          → {{ hovered.status }}<span v-if="hovered.duration != null"> · {{ Math.round(hovered.duration) }} ms</span>
        </p>
        <p v-else-if="hovered.kind === 'step' && hovered.duration != null" class="text-gray-500">
          {{ Math.round(hovered.duration) }} ms<span v-if="hovered.failed" class="text-red-500"> · failed</span>
        </p>
        <p v-else-if="hovered.status" class="text-gray-500">{{ hovered.status }}</p>
      </ChartTooltip>
    </Teleport>
  </SectionCard>
</template>
