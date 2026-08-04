/**
 * Wire contract — the **external** shapes sent to / received from the Piwi
 * Dashboard server.
 *
 * The small leaf shapes (`SuiteConfigEntry`, `TestAnnotation`, `FilterDetails`,
 * `BrowserConfig`, `TestStepEvent`) come from `@piwitests/core` (bundled at build
 * time, shared with the app). The per-case `WireTestCase` and the stream-event
 * union below are the reporter's own producer shapes; they stay structurally
 * compatible with the server's `TestCasePayload` / `StreamEventPayload` (pinned by
 * the dashboard's wire drift-guard test). **Any change here is a server-contract change.**
 *
 * For the in-process collection model (never sent verbatim), see `./collected.ts`.
 */
import type {
  BrowserConfig,
  FilterDetails,
  SuiteConfigEntry,
  TestAnnotation,
  TestMetadata,
  TestSourceFrame,
  TestStepEvent,
} from '@piwitests/core/wire';

export type {
  BrowserConfig,
  FilterDetails,
  SuiteConfigEntry,
  TestAnnotation,
  TestMetadata,
  TestSourceFrame,
  TestStepEvent,
};

// ── Per-case wire shape ──────────────────────────────────────────────────────

/**
 * The per-case wire shape that `toWireTestCase` produces and the server
 * receives. Structurally compatible with `TestCasePayload` and the per-event
 * `StreamEventPayload`.
 */
export interface WireTestCase {
  type?: 'begin' | 'complete' | 'step-begin' | 'step-end';
  title: string;
  location: string;
  status?: string;
  duration?: number;
  /** Effective per-test timeout in ms (`TestCase.timeout`); `0` means unbounded. */
  timeout?: number | null;
  error?: string | null;
  retries?: number;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  steps?: unknown;
  stepEvents?: TestStepEvent[] | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  wastedTimeMs?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  pageState?: unknown;
  aiUsage?: unknown;
  consoleLogs?: unknown;
  ariaSnapshot?: unknown;
  testSource?: string | null;
  testSourceFrames?: TestSourceFrame[] | null;
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
  testAnnotations?: TestAnnotation[] | null;
  /** Normalized `TestCase.tags`, `@` stripped. */
  tags?: string[] | null;
  /** Ownership metadata parsed from `piwi:` annotations. */
  testMeta?: TestMetadata | null;
  /** Step-event discriminant (only for `step-begin`/`step-end` events). */
  stepCategory?: string | null;
  parentTitle?: string | null;
  /** Per-element locator snapshots with ranked alternatives (transient — not stored per-run). */
  locatorSnapshots?: unknown;
}

// ── Stream events (discriminated union) ──────────────────────────────────────

export interface BeginStreamEvent {
  type: 'begin';
  title: string;
  location: string;
  workerIndex: number | null;
  shardIndex: number | null;
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
}

export interface CompleteStreamEvent {
  type: 'complete';
  title: string;
  location: string;
  status: string;
  duration: number;
  timeout?: number | null;
  error: string | null;
  retries: number;
  workerIndex: number | null;
  shardIndex: number | null;
  startedAt: number | null;
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
  testAnnotations?: TestAnnotation[] | null;
  tags?: string[] | null;
  testMeta?: TestMetadata | null;
  steps?: unknown;
  stepEvents?: TestStepEvent[] | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  pageState?: unknown;
  aiUsage?: unknown;
  consoleLogs?: unknown;
  ariaSnapshot?: unknown;
  testSource?: string | null;
  testSourceFrames?: TestSourceFrame[] | null;
  locatorSnapshots?: unknown;
}

export interface StepBeginStreamEvent {
  type: 'step-begin';
  title: string;
  location: string;
  /** Playwright step category (`hook`, `fixture`, `pw:api`, `pw:expect`, …). */
  stepCategory: string;
  parentTitle: string | null;
  workerIndex: number | null;
  startedAt: number | null;
}

export interface StepEndStreamEvent {
  type: 'step-end';
  title: string;
  location: string;
  status: string;
  duration: number;
  /** Playwright step category (`hook`, `fixture`, `pw:api`, `pw:expect`, …). */
  stepCategory: string;
  parentTitle: string | null;
  workerIndex: number | null;
  startedAt: number | null;
}

/** Discriminated union of events queued to `StreamManager` and persisted by `StreamBuffer`. */
export type StreamEvent = BeginStreamEvent | CompleteStreamEvent | StepBeginStreamEvent | StepEndStreamEvent;

// ── Suite-level setup steps (beforeAll/afterAll timeline) ─────────────────────

export interface SetupStep {
  title: string;
  category: string;
  startedAt: number;
  duration: number;
  status: string;
  location?: string | null;
  workerIndex?: number | null;
}
