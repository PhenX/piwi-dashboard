import { computed, type ComputedRef } from 'vue';
import type { TestCaseResult, TestStepEvent, SetupStepEvent } from '~~/types/api';
import { isWastedWait, DEFAULT_WASTED_WAIT_PATTERNS } from '#shared/utils/wasted-waits';

/** What a timeline bar represents; drives rendering, filtering and header counts. */
export type TimelineItemKind = 'test' | 'setup' | 'hook' | 'fixture' | 'wait';

/** A single drawable element on the timeline: a test bar, hook/fixture segment, suite setup step, or wasted wait. */
export interface TimelineItem {
  /** Unique, stable identity — the v-for key and the hover-dimming comparand. */
  key: string;
  kind: TimelineItemKind;
  /** DB id of the owning test case (click-through target); null for suite-level setup steps. */
  testCaseId: number | null;
  title: string;
  status: string;
  workerIndex: number;
  start: number;
  duration: number;
  rowIndex: number;
  /** Title of the test the segment belongs to (hooks/fixtures/waits only). */
  parentTitle?: string | null;
}

/** Shard group for rendering separators and labels. */
export interface ShardGroup {
  shardIndex: number | null;
  /** Row indices (0-based) within this shard's worker rows. */
  rowRange: [number, number];
}

/** Inputs the model derives its rows from (a subset of the component props). */
export interface TimelineModelInput {
  testCases: TestCaseResult[];
  setupSteps?: SetupStepEvent[] | null;
  /** Allowlist of glob patterns classifying which waits count as wasted time. */
  wastedPatterns?: string[] | null;
}

/** One worker lane: its identity plus the cases that ran on it. */
interface WorkerGroup {
  shardIndex: number | null;
  workerIndex: number;
  cases: TestCaseResult[];
}

/**
 * Group test cases into worker lanes keyed by (shardIndex, workerIndex) — two
 * shards may have overlapping worker indices (e.g. both Shard 1 and Shard 2
 * have a Worker 0). Cases without a usable worker index are skipped. Lanes are
 * ordered by shardIndex (shardless last), then workerIndex.
 */
function groupByWorker(testCases: TestCaseResult[]): WorkerGroup[] {
  const byKey = new Map<string, WorkerGroup>();
  for (const tc of testCases) {
    const workerIndex = tc.workerIndex;
    if (workerIndex == null || workerIndex < 0) continue;
    const shardIndex = tc.shardIndex ?? null;
    const key = `${shardIndex ?? 'null'}|${workerIndex}`;
    let group = byKey.get(key);
    if (!group) {
      group = { shardIndex, workerIndex, cases: [] };
      byKey.set(key, group);
    }
    group.cases.push(tc);
  }
  return [...byKey.values()].sort((a, b) => {
    const aShard = a.shardIndex ?? Infinity;
    const bShard = b.shardIndex ?? Infinity;
    if (aShard !== bShard) return aShard - bShard;
    return a.workerIndex - b.workerIndex;
  });
}

/**
 * Coerce a `startedAt` value to epoch milliseconds. Timestamps are numeric ms
 * end-to-end now (live SSE, REST, and both DB backends), so this is just a
 * finite-number guard. The Date/string fallbacks remain only to degrade
 * gracefully on any stray legacy value rather than yielding NaN — which would
 * collapse bars to the left edge and trigger the squished sequential fallback.
 */
function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v as string).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Map a step event to the timeline kind it renders as, or null when it should
 * not be drawn: non-wasted waits are framework noise already covered by the
 * test bar, and other categories (test.step/expect) are never rendered as
 * segments.
 */
function stepKind(step: TestStepEvent, patterns: readonly string[]): 'hook' | 'fixture' | 'wait' | null {
  if (step.category === 'wait') return isWastedWait(step, patterns) ? 'wait' : null;
  if (step.category === 'hook' || step.category === 'fixture') return step.category;
  return null;
}

/**
 * Derive the timeline's row model from the run's test cases. Returns the
 * drawable items, the ordered worker rows, the shard groupings, and the total
 * time span. Pure and free of DOM/viewport concerns so it can be unit-tested.
 */
export function useTimelineModel(props: TimelineModelInput): {
  timelineData: ComputedRef<TimelineItem[]>;
  workerRows: ComputedRef<Array<{ shardIndex: number | null; workerIndex: number }>>;
  shardGroups: ComputedRef<ShardGroup[]>;
  maxTime: ComputedRef<number>;
} {
  /** Effective wasted-wait patterns (falls back to the built-in default). */
  const wastedPatterns = computed<readonly string[]>(() =>
    props.wastedPatterns && props.wastedPatterns.length > 0 ? props.wastedPatterns : DEFAULT_WASTED_WAIT_PATTERNS,
  );

  const workerGroups = computed(() => groupByWorker(props.testCases));

  const timelineData = computed<TimelineItem[]>(() => {
    const workers = workerGroups.value;
    const patterns = wastedPatterns.value;

    // Anchor for absolute positioning: the earliest startedAt in the run. When
    // no case carries a usable timestamp, fall back to packing each worker's
    // cases sequentially.
    let minStartedAt = Infinity;
    for (const worker of workers) {
      for (const tc of worker.cases) {
        const sa = toMs(tc.startedAt);
        if (sa != null && sa > 0) minStartedAt = Math.min(minStartedAt, sa);
      }
    }
    const hasStartedAt = Number.isFinite(minStartedAt);
    const absoluteStart = (startedAt: unknown) => Math.max(0, (toMs(startedAt) ?? minStartedAt) - minStartedAt);

    const result: TimelineItem[] = [];
    // Per-worker end cursor; positions items in fallback mode and marks where
    // setup steps get appended.
    const rowEndByWorker = new Map<number, number>();

    workers.forEach((worker, rowIndex) => {
      const rowItems: TimelineItem[] = [];
      // Fallback mode packs cases in start order; absolute mode keeps the
      // incoming order and sorts the finished row by start instead.
      const cases = hasStartedAt
        ? worker.cases
        : [...worker.cases].sort((a, b) => (toMs(a.startedAt) ?? 0) - (toMs(b.startedAt) ?? 0));
      let cursor = 0;

      for (const tc of cases) {
        const duration = tc.duration ?? 1000;
        const start = hasStartedAt ? absoluteStart(tc.startedAt) : cursor;
        rowItems.push({
          key: `t${tc.id}`,
          kind: 'test',
          testCaseId: tc.id,
          title: tc.title,
          status: tc.status,
          workerIndex: worker.workerIndex,
          start,
          duration,
          rowIndex,
        });
        cursor = start + duration;

        const steps = (tc.stepEvents ?? []) as TestStepEvent[];
        steps.forEach((step, stepIndex) => {
          const kind = stepKind(step, patterns);
          if (!kind) return;
          const stepDuration = step.duration || 0;
          const stepStart = hasStartedAt ? absoluteStart(step.startedAt) : cursor;
          rowItems.push({
            key: `s${tc.id}:${stepIndex}`,
            kind,
            testCaseId: tc.id,
            title: step.title,
            status: step.status || 'passed',
            workerIndex: worker.workerIndex,
            start: stepStart,
            duration: stepDuration,
            rowIndex,
            parentTitle: tc.title,
          });
          cursor = stepStart + stepDuration;
        });
      }

      rowItems.sort((a, b) => a.start - b.start);
      result.push(...rowItems);
      // First shard wins, matching the setup-step row placement below.
      if (!rowEndByWorker.has(worker.workerIndex)) rowEndByWorker.set(worker.workerIndex, cursor);
    });

    // Suite-level setup steps (beforeAll/afterAll) carry only a workerIndex
    // (no shard), so place each on the first row with that worker index —
    // `workers` is ordered by shardIndex then workerIndex, so that's the first
    // shard (or the shardless lane). In absolute mode they sit at their own
    // startedAt; in fallback mode they're appended after the worker's cases,
    // since without timestamps we can't interleave them accurately.
    if (props.setupSteps && props.setupSteps.length > 0) {
      const rowIndexByWorker = new Map<number, number>();
      workers.forEach((worker, rowIndex) => {
        if (!rowIndexByWorker.has(worker.workerIndex)) rowIndexByWorker.set(worker.workerIndex, rowIndex);
      });

      props.setupSteps.forEach((step, setupIndex) => {
        const workerIndex = step.workerIndex;
        if (workerIndex == null || workerIndex < 0) return;
        const rowIndex = rowIndexByWorker.get(workerIndex);
        if (rowIndex == null) return;

        const duration = step.duration || 0;
        let start: number;
        if (hasStartedAt) {
          start = absoluteStart(step.startedAt);
        } else {
          start = rowEndByWorker.get(workerIndex) ?? 0;
          rowEndByWorker.set(workerIndex, start + duration);
        }

        result.push({
          key: `setup${workerIndex}:${setupIndex}`,
          kind: 'setup',
          testCaseId: null,
          title: `[Setup] ${step.title}`,
          status: step.status || 'passed',
          workerIndex,
          start,
          duration,
          rowIndex,
          parentTitle: null,
        });
      });
    }

    return result;
  });

  /** Ordered worker lanes; items with rowIndex i render on workerRows[i]. */
  const workerRows = computed(() =>
    workerGroups.value.map((worker) => ({ shardIndex: worker.shardIndex, workerIndex: worker.workerIndex })),
  );

  /** Shard group boundaries derived from workerRows */
  const shardGroups = computed<ShardGroup[]>(() => {
    const groups: ShardGroup[] = [];
    for (let ri = 0; ri < workerRows.value.length; ri++) {
      const row = workerRows.value[ri]!;
      const prev = groups[groups.length - 1];
      if (!prev || prev.shardIndex !== row.shardIndex) {
        groups.push({ shardIndex: row.shardIndex, rowRange: [ri, ri] });
      } else {
        prev.rowRange[1] = ri;
      }
    }
    return groups;
  });

  const maxTime = computed(() => {
    let max = 0;
    for (const item of timelineData.value) {
      max = Math.max(max, item.start + item.duration);
    }
    return max || 60000;
  });

  return { timelineData, workerRows, shardGroups, maxTime };
}
