import { gunzipSync } from 'node:zlib';
import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Fixtures,
  Locator,
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  Request,
  TestInfo,
  TestType,
} from '@playwright/test';
import {
  generateAlternatives,
  extractAccessibleName,
  approximateAccessibleName,
  captureCallerLocation,
  dedupeSnapshotsByLocation,
  resolveAriaRole,
  suggestLocatorsFromAria,
  LOCATOR_METHODS,
  CHAIN_METHODS,
  ACTION_METHODS,
  LOCATOR_CREATING_CHAINS,
  CAPTURED_ATTRIBUTES,
  TAG_TO_ROLE,
  INPUT_TYPE_TO_ROLE,
  type LocatorSnapshot,
  type FailedLocatorInfo,
} from './locator-healing.js';
import { ATTACHMENT_NAMES, LOCATOR_SUGGESTION_ANNOTATION, USER_PICK_ANNOTATION } from './attachments.js';
import {
  environmentalSkipReason,
  inspectionGateFromTestInfo,
  pauseForInspection,
  shouldInspectOnFailure,
} from './inspect-on-failure.js';
import { applyPickToSnapshots, runLocatorPicker, type UserPickResult } from './pick-on-failure.js';

/** A Playwright fixture's `use` callback — hands the fixture value to the test. */
type UseFn<T> = (value: T) => Promise<void>;

// Playwright constrains `TestType`'s args to its internal `KeyValue`
// (`{ [key: string]: any }`) — mirror it so real `test` objects satisfy the
// bound (their args are index-signature-free interfaces) while a non-test
// argument is still rejected by the `TestType` parameter type.
type FixtureArgs = { [key: string]: any };

/** Shape returned by the in-page element probe (see `wrapLocator`). */
interface CapturedAttrs {
  tagName: string;
  attributes: Record<string, string | null>;
  textContent: string;
  center: { x: number; y: number };
  /** True when the element has an associated <label> — gates getByLabel. */
  hasLabel: boolean;
  /** querySelectorAll match counts for candidate selectors (uniqueness probe). */
  selectorCounts: {
    testId?: number;
    id?: number;
    name?: number;
    classes?: Record<string, number>;
  };
  /** Position among same-role elements, document-wide (null when the element has no role). */
  rolePosition: { role: string; count: number; index: number; levelCount?: number } | null;
  /** Anchor-worthy ancestors, nearest first (empty when none found or probing failed). */
  ancestors: Array<{
    tag: string;
    depth: number;
    testId: string | null;
    id: string | null;
    role: string | null;
    ariaLabel: string | null;
    scopedRoleCount?: number;
    testIdCount?: number;
    idCount?: number;
    roleCount?: number;
  }>;
}

/** Shape returned by the in-page web-vitals probe (see `flushSink`). */
interface WebVitals {
  navigation: {
    url: string;
    ttfb: number;
    domInteractive: number;
    domContentLoaded: number;
    loadComplete: number;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
  } | null;
  paint: Record<string, number>;
  /**
   * Core Web Vitals from buffered PerformanceObserver entries. Chromium-only —
   * Firefox/WebKit don't expose these entry types, so each value is null there.
   * `inp` is null when the test produced no interactions (common in short tests).
   */
  vitals: {
    lcp: number | null;
    cls: number | null;
    inp: number | null;
  } | null;
}

/** Plain-object projection of a performance entry, shipped out of the page. */
export interface RawVitalEntry {
  startTime?: number;
  value?: number;
  hadRecentInput?: boolean;
  interactionId?: number;
  duration?: number;
}

/**
 * Aggregate buffered performance entries into LCP/CLS/INP. Pure and Node-side
 * so it is unit-testable; the in-page evaluate only ships raw entry projections.
 * A null entry list means the entry type is unsupported (non-Chromium) — the
 * metric is null rather than 0 so absence is distinguishable from "no shifts".
 */
export function computeCoreVitals(
  lcpEntries: RawVitalEntry[] | null,
  shiftEntries: RawVitalEntry[] | null,
  eventEntries: RawVitalEntry[] | null,
): { lcp: number | null; cls: number | null; inp: number | null } | null {
  // The last LCP candidate is the final LCP.
  const lastLcp = lcpEntries && lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1] : null;
  const lcp = lastLcp && typeof lastLcp.startTime === 'number' ? Math.round(lastLcp.startTime) : null;

  // Simple sum over shifts without recent input. The spec's session-window
  // grouping matters for long sessions; a test's page lifetime is short enough
  // that the plain sum tracks it closely.
  let cls: number | null = null;
  if (shiftEntries) {
    const sum = shiftEntries.reduce(
      (acc, e) => acc + (e.hadRecentInput ? 0 : typeof e.value === 'number' ? e.value : 0),
      0,
    );
    cls = Math.round(sum * 10000) / 10000;
  }

  // Worst interaction latency: max duration per interactionId, then the p98
  // interaction when there are many (mirrors the INP definition, simplified).
  let inp: number | null = null;
  if (eventEntries && eventEntries.length > 0) {
    const byInteraction = new Map<number, number>();
    for (const e of eventEntries) {
      if (typeof e.interactionId !== 'number' || e.interactionId <= 0) continue;
      const duration = typeof e.duration === 'number' ? e.duration : 0;
      const prev = byInteraction.get(e.interactionId) ?? 0;
      if (duration > prev) byInteraction.set(e.interactionId, duration);
    }
    const durations = [...byInteraction.values()].sort((a, b) => a - b);
    if (durations.length > 0) {
      const index = durations.length > 50 ? Math.floor(durations.length * 0.98) : durations.length - 1;
      inp = Math.round(durations[Math.min(index, durations.length - 1)]!);
    }
  }

  if (lcp === null && cls === null && inp === null) return null;
  return { lcp, cls, inp };
}

/**
 * Per-test capture buffers. One sink is created per test and stashed in the
 * module-level `currentSink` while that test runs; page/locator instrumentation
 * reads `currentSink` live so events route to whichever test is executing.
 */
interface CaptureSink {
  networkRequests: Array<Record<string, unknown>>;
  consoleEntries: Array<Record<string, unknown>>;
  pendingHandlers: Promise<void>[];
  capturedLocators: LocatorSnapshot[];
  capturePromises: Promise<void>[];
  failedLocators: FailedLocatorInfo[];
  // Most-recently-touched instrumented page — used at teardown for the failure
  // ARIA snapshot and web-vitals read when a test drives several pages.
  lastActivePage: Page | null;
  // The running test's info, so close wrappers can see its status mid-teardown.
  testInfo: TestInfo | null;
  // Page-dependent teardown reads, taken by the close wrappers while the page
  // was still open. The auto capture fixture tears down AFTER the built-in
  // page/context fixtures, so by the time flushSink runs the standard test
  // page is already closed and can no longer be read live.
  stashedWebVitals: WebVitals | null;
  stashedPageState: PageState | null;
  stashedAria: string | null;
  // The failing page was already handed to the Inspector once this test —
  // several close wrappers can fire for the same teardown.
  inspected: boolean;
  // The locator picker was already offered once this test (same reason).
  pickOffered: boolean;
  // A replacement locator the human confirmed in the failure-time picker.
  userPick: UserPickResult | null;
}

function createSink(): CaptureSink {
  return {
    networkRequests: [],
    consoleEntries: [],
    pendingHandlers: [],
    capturedLocators: [],
    capturePromises: [],
    failedLocators: [],
    lastActivePage: null,
    testInfo: null,
    stashedWebVitals: null,
    stashedPageState: null,
    stashedAria: null,
    inspected: false,
    pickOffered: false,
    userPick: null,
  };
}

/**
 * The capture sink for the test currently running in this worker. Playwright
 * runs a worker's tests sequentially, so a single "current" sink is unambiguous.
 * It is null between tests and during `beforeAll`/`afterAll` — activity outside a
 * test (auth setup, teardown) is intentionally not captured.
 */
let currentSink: CaptureSink | null = null;

/**
 * Element probes whose protocol call is still in flight. Closing a page,
 * context, or browser while a probe is mid-flight makes Playwright's
 * connection dispatcher throw a global "Object with guid handle@… was not
 * bound in the connection" error, which fails whichever test happens to be
 * running. The close wrappers drain this set (bounded) before closing.
 */
const PENDING_PROBES = new Set<Promise<unknown>>();

async function drainPendingProbes(capMs: number): Promise<void> {
  if (PENDING_PROBES.size === 0) return;
  let cap: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(PENDING_PROBES),
    new Promise((resolve) => {
      cap = setTimeout(resolve, capMs);
    }),
  ]);
  clearTimeout(cap);
}

function isPageClosed(page: Page): boolean {
  try {
    return typeof page.isClosed === 'function' ? page.isClosed() : false;
  } catch {
    return false;
  }
}

function pageContext(page: Page): BrowserContext | null {
  try {
    return typeof page.context === 'function' ? page.context() : null;
  } catch {
    return null;
  }
}

/** The evaluate's raw result: navigation/paint plus raw core-vitals entries. */
interface WebVitalsProbeResult {
  navigation: WebVitals['navigation'];
  paint: Record<string, number>;
  lcpEntries: RawVitalEntry[] | null;
  shiftEntries: RawVitalEntry[] | null;
  eventEntries: RawVitalEntry[] | null;
}

/** Read navigation/paint timings and core-vitals entries — null when unavailable or the page is gone. */
async function readWebVitals(page: Page): Promise<WebVitals | null> {
  try {
    // Runs in the browser, so the perf-entry reads stay `any` (no DOM lib);
    // the callback return type pins the result. Aggregation happens Node-side
    // in computeCoreVitals so the in-page code stays a thin projection.
    const probe = await page.evaluate(async (): Promise<WebVitalsProbeResult | null> => {
      const navEntries = performance.getEntriesByType('navigation' as any);
      const paintEntries = performance.getEntriesByType('paint' as any);
      const nav = navEntries[0] as any;
      const navigation = nav
        ? {
            url: nav.name,
            ttfb: Math.round(nav.responseStart - nav.fetchStart),
            domInteractive: Math.round(nav.domInteractive - nav.fetchStart),
            domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.fetchStart),
            loadComplete: Math.round(nav.loadEventEnd - nav.fetchStart),
            transferSize: nav.transferSize || 0,
            encodedBodySize: nav.encodedBodySize || 0,
            decodedBodySize: nav.decodedBodySize || 0,
          }
        : null;

      const paint: Record<string, number> = {};
      for (const entry of paintEntries) {
        const key = (entry as any).name.replace(/-([a-z])/g, (_: string, l: string) => l.toUpperCase());
        paint[key] = Math.round((entry as any).startTime);
      }

      // Buffered-observer read of an entry type. Returns null when the type is
      // unsupported (non-Chromium); [] when supported but nothing recorded.
      // Buffered entries are dispatched in a queued task, so wait one macrotask
      // before draining with takeRecords().
      const readBuffered = (type: string, extra?: Record<string, unknown>): Promise<any[] | null> =>
        new Promise((resolve) => {
          try {
            const PO = (globalThis as any).PerformanceObserver;
            if (!PO || !(PO.supportedEntryTypes || []).includes(type)) return resolve(null);
            const out: any[] = [];
            const po = new PO((list: any) => out.push(...list.getEntries()));
            po.observe({ type, buffered: true, ...extra });
            setTimeout(() => {
              try {
                out.push(...po.takeRecords());
                po.disconnect();
              } catch {
                // Entries gathered so far still count.
              }
              resolve(out);
            }, 0);
          } catch {
            resolve(null);
          }
        });

      const [lcpRaw, shiftRaw, eventRaw, firstInputRaw] = await Promise.all([
        readBuffered('largest-contentful-paint'),
        readBuffered('layout-shift'),
        // durationThreshold 40 mirrors the web-vitals library — captures every
        // interaction slow enough to matter without flooding the buffer.
        readBuffered('event', { durationThreshold: 40 }),
        readBuffered('first-input'),
      ]);

      const project = (entries: any[] | null): RawVitalEntry[] | null =>
        entries === null
          ? null
          : entries.map((e: any) => ({
              startTime: e.startTime,
              value: e.value,
              hadRecentInput: e.hadRecentInput,
              interactionId: e.interactionId,
              duration: e.duration,
            }));

      const interactionEntries =
        eventRaw === null && firstInputRaw === null ? null : [...(eventRaw ?? []), ...(firstInputRaw ?? [])];

      return {
        navigation,
        paint,
        lcpEntries: project(lcpRaw),
        shiftEntries: project(shiftRaw),
        eventEntries: project(interactionEntries),
      };
    });

    if (!probe) return null;
    const vitals = computeCoreVitals(probe.lcpEntries, probe.shiftEntries, probe.eventEntries);
    if (!probe.navigation && Object.keys(probe.paint).length === 0 && !vitals) return null;
    return { navigation: probe.navigation, paint: probe.paint, vitals };
  } catch {
    return null;
  }
}

/** Page state captured at test end. Storage values and cookie values are NEVER included. */
export interface PageState {
  url: string;
  hash: string | null;
  /** `history.state` as JSON, capped and token-masked. */
  historyState: string | null;
  /** Key names + value lengths only. */
  localStorage: Array<{ key: string; length: number }>;
  sessionStorage: Array<{ key: string; length: number }>;
  /** Cookie names + flags only (values are never read). */
  cookies: Array<{
    name: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: string;
    expires?: number;
  }>;
}

/** Raw in-page reads shipped out of the evaluate (see `readPageState`). */
export interface RawPageState {
  url: string;
  hash: string | null;
  historyState: string | null;
  localStorage: Array<{ key: string; length: number }>;
  sessionStorage: Array<{ key: string; length: number }>;
}

const PAGE_STATE_MAX_STORAGE_KEYS = 50;
const PAGE_STATE_MAX_COOKIES = 30;
const PAGE_STATE_HISTORY_CAP = 2048;
const TOKEN_MASK_RES = [/\beyJ[\w-]{10,}\.[\w-]{5,}\.[\w-]{5,}\b/g, /\b[0-9a-f]{32,}\b/gi];

/**
 * Assemble the wire page-state from the in-page reads and the context cookies.
 * Pure and Node-side so the sanitization (token masking, caps, value-free
 * cookies) is unit-testable.
 */
export function buildPageState(raw: RawPageState, cookies: Array<Record<string, unknown>> | null): PageState {
  let historyState = raw.historyState;
  if (historyState) {
    for (const re of TOKEN_MASK_RES) historyState = historyState.replace(re, '[masked]');
    if (historyState.length > PAGE_STATE_HISTORY_CAP) {
      historyState = historyState.slice(0, PAGE_STATE_HISTORY_CAP) + '…';
    }
  }
  const capStorage = (entries: Array<{ key: string; length: number }>) =>
    (Array.isArray(entries) ? entries : []).slice(0, PAGE_STATE_MAX_STORAGE_KEYS).map((e) => ({
      key: String(e.key).slice(0, 200),
      length: typeof e.length === 'number' ? e.length : 0,
    }));

  return {
    url: raw.url,
    hash: raw.hash || null,
    historyState: historyState || null,
    localStorage: capStorage(raw.localStorage),
    sessionStorage: capStorage(raw.sessionStorage),
    cookies: (cookies ?? []).slice(0, PAGE_STATE_MAX_COOKIES).map((c) => ({
      name: String(c.name ?? ''),
      domain: String(c.domain ?? ''),
      path: String(c.path ?? ''),
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      ...(c.sameSite !== undefined ? { sameSite: String(c.sameSite) } : {}),
      ...(typeof c.expires === 'number' ? { expires: c.expires } : {}),
    })),
  };
}

/** Read the page's state — null when unavailable or the page is gone. */
async function readPageState(page: Page): Promise<PageState | null> {
  try {
    const raw = await page.evaluate((): RawPageState => {
      // Key names + value lengths only — values never leave the page.
      const listStorage = (s: any): Array<{ key: string; length: number }> => {
        const out: Array<{ key: string; length: number }> = [];
        try {
          for (let i = 0; i < s.length; i++) {
            const key = s.key(i);
            if (key != null) out.push({ key, length: (s.getItem(key) ?? '').length });
          }
        } catch {
          // Storage access can throw in sandboxed/opaque-origin pages.
        }
        return out;
      };
      const g = globalThis as any;
      let historyState: string | null = null;
      try {
        historyState = g.history?.state == null ? null : JSON.stringify(g.history.state);
      } catch {
        // Unserializable history state.
      }
      return {
        url: g.location.href,
        hash: g.location.hash || null,
        historyState,
        localStorage: listStorage((globalThis as any).localStorage),
        sessionStorage: listStorage((globalThis as any).sessionStorage),
      };
    });
    if (!raw) return null;

    // Cookie flags are only reachable from the context API, never document.cookie.
    let cookies: Array<Record<string, unknown>> | null = null;
    try {
      cookies = ((await pageContext(page)?.cookies()) as Array<Record<string, unknown>> | undefined) ?? null;
    } catch {
      cookies = null;
    }

    return buildPageState(raw, cookies);
  } catch {
    return null;
  }
}

/**
 * Take the page-dependent teardown reads (web vitals; page state; ARIA
 * snapshot when the test failed) while the last active page is still open.
 * Called by the close wrappers just before a close that would take that page
 * with it — flushSink runs too late for a live read on the standard test page.
 */
async function stashPageState(sink: CaptureSink, closing: { page?: Page; context?: BrowserContext }): Promise<void> {
  const page = sink.lastActivePage;
  if (!page || isPageClosed(page)) return;
  const belongsToClosing =
    closing.page === page || (closing.context !== undefined && pageContext(page) === closing.context);
  if (!belongsToClosing) return;

  const vitals = await readWebVitals(page);
  if (vitals) sink.stashedWebVitals = vitals;

  if (process.env.PIWI_CAPTURE_PAGE_STATE !== 'false') {
    const pageState = await readPageState(page);
    if (pageState) sink.stashedPageState = pageState;
  }

  const status = sink.testInfo?.status;
  if (status === 'failed' || status === 'timedOut' || status === 'interrupted') {
    const aria = await ariaSnapshotBestEffort(page.locator(':root'), 1000);
    if (aria) sink.stashedAria = aria;
  }
}

/**
 * Hand the failing page to the Playwright Inspector before it closes, when
 * failure-time inspection is enabled (see `inspect-on-failure.ts` for the
 * gate: opt-in, headed, never in CI, final attempt only). Runs after
 * `stashPageState` so the captured failure evidence reflects the page as the
 * test left it, not as the human poked at it.
 */
async function maybeInspectOnFailure(
  sink: CaptureSink,
  closing: { page?: Page; context?: BrowserContext },
): Promise<void> {
  if (sink.inspected) return;
  const page = sink.lastActivePage;
  const testInfo = sink.testInfo;
  if (!page || !testInfo || isPageClosed(page)) return;
  const belongsToClosing =
    closing.page === page || (closing.context !== undefined && pageContext(page) === closing.context);
  if (!belongsToClosing) return;
  if (!shouldInspectOnFailure(inspectionGateFromTestInfo(testInfo))) return;
  sink.inspected = true;
  await pauseForInspection(page, testInfo);
}

/**
 * Offer the failure-time locator picker on the failing page before it closes
 * (see `pick-on-failure.ts`; gated like inspection, but armed by
 * `PIWI_PICK_LOCATOR_ON_FAIL` and only when a locator action actually failed).
 * A confirmed pick is folded into the captured snapshots so it rides the
 * normal `piwi-locators` attachment; flushSink attaches the pick itself.
 */
async function maybePickOnFailure(
  sink: CaptureSink,
  closing?: { page?: Page; context?: BrowserContext },
): Promise<void> {
  if (sink.pickOffered) return;
  const page = sink.lastActivePage;
  const testInfo = sink.testInfo;
  if (!page || !testInfo || isPageClosed(page)) return;
  if (closing) {
    const belongsToClosing =
      closing.page === page || (closing.context !== undefined && pageContext(page) === closing.context);
    if (!belongsToClosing) return;
  }
  if (!shouldInspectOnFailure(inspectionGateFromTestInfo(testInfo, process.env.PIWI_PICK_LOCATOR_ON_FAIL))) return;
  // Gate passed — this is the one shot at the picker for this test.
  sink.pickOffered = true;
  const failed = sink.failedLocators[sink.failedLocators.length - 1];
  if (!failed) {
    console.log(
      '[piwi] locator picker: this failure was not a locator action (e.g. an `expect(...)` assertion), so there is ' +
        'no failed locator to replace. Use the trace viewer’s "Pick locator" tool on the dashboard for these.',
    );
    return;
  }
  const pick = await runLocatorPicker(page, testInfo, failed, { fn: probeElementAttrs, arg: CAPTURED_ATTRS_ARG });
  if (!pick) return;
  sink.userPick = pick;
  applyPickToSnapshots(sink.capturedLocators, pick);
}

// Idempotency guards: a page/context/browser can be reached through several
// paths (browser patch, context patch, the `page` fixture, popup events), and
// must be wrapped exactly once.
const INSTRUMENTED_PAGES = new WeakSet<Page>();
const INSTRUMENTED_CONTEXTS = new WeakSet<BrowserContext>();
const PATCHED_BROWSERS = new WeakSet<Browser>();

// O(1) membership for the proxy `get` trap below, which runs on every property
// access of every wrapped locator. The source arrays from locator-healing are
// turned into Sets once here.
const CHAIN_METHOD_SET = new Set(CHAIN_METHODS);
const ACTION_METHOD_SET = new Set(ACTION_METHODS);
const FORM_FIELD_TAGS = new Set(['input', 'select', 'textarea']);

/**
 * Everything the in-page probe needs, serialized into the browser on every
 * action. `tagRoles`/`inputRoles` are the shared role maps (single source of
 * truth in `locator-healing.ts`), and `roleSources` is the CSS selector for
 * every element the probe can resolve a role for — all derived from the map so
 * nothing is hand-maintained twice. Exported so the dogfood mirror
 * (`application/tests/fixtures.ts`) reuses the same assembled object.
 */
export interface ProbeArg {
  keep: string[];
  tagRoles: Record<string, string>;
  inputRoles: Record<string, string>;
  roleSources: string;
}

/** Built once — passed verbatim into evaluate() on every action. */
export const CAPTURED_ATTRS_ARG: ProbeArg = {
  keep: [...CAPTURED_ATTRIBUTES],
  tagRoles: TAG_TO_ROLE,
  inputRoles: INPUT_TYPE_TO_ROLE,
  // '[role]' plus every tag the maps can resolve (input/select are handled by
  // special-cased logic in the probe, so add them explicitly).
  roleSources: [...new Set(['[role]', 'input', 'select', ...Object.keys(TAG_TO_ROLE)])].join(','),
};

/**
 * ARIA snapshot that tolerates every Playwright version the reporter supports,
 * returning null instead of throwing so a capture can never fail the test. The
 * options validator runs client-side in the user's installed Playwright, so an
 * unsupported key surfaces as a rejected promise (not a synchronous throw):
 *   - ≥ 1.59: `mode: 'ai'` yields the ref-annotated AI snapshot (the ideal);
 *     `ref` is unknown and silently stripped.
 *   - 1.52: `mode: 'ai'` fails validation (only 'raw'/'regex' are accepted) and
 *     rejects; the `{ ref: true }` fallback then yields a ref-annotated snapshot.
 *   - 1.53–1.58: neither `ref` nor `mode` exists — unknown keys are stripped
 *     server-side, so the first call already returns a plain flat snapshot.
 *   - < 1.49: `locator.ariaSnapshot` does not exist — returns null up front.
 */
export async function ariaSnapshotBestEffort(target: Locator, timeout?: number): Promise<string | null> {
  // Playwright < 1.49 predates locator.ariaSnapshot entirely.
  if (typeof target.ariaSnapshot !== 'function') return null;
  try {
    return await target.ariaSnapshot({
      ...(timeout != null ? { timeout } : {}),
      mode: 'ai',
    } as Parameters<Locator['ariaSnapshot']>[0]);
  } catch {
    // 1.52 rejects `mode: 'ai'`; retry with the `ref` flag that release accepts.
    try {
      return await target.ariaSnapshot({
        ...(timeout != null ? { timeout } : {}),
        ref: true,
      } as Parameters<Locator['ariaSnapshot']>[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Runs inside the browser via `evaluate()` — probes a captured element for its
 * attributes, geometry, label association, and selector-uniqueness counts.
 * Must stay a fully self-contained function (no references to this module's
 * closure): Playwright serializes it and executes it in the page, browser-side.
 * `el` is browser-context (no DOM lib in this Node package), hence `any`.
 * Exported for unit testing; still passed directly to `evaluate()` below.
 */
export function probeElementAttrs(el: any, arg: ProbeArg): CapturedAttrs {
  const { keep, tagRoles, inputRoles, roleSources } = arg;
  const attrMap: Record<string, string | null> = {};
  for (const key of keep) {
    const v = el.getAttribute(key) ?? el[key];
    attrMap[key] = typeof v === 'string' ? v.slice(0, 200) : v ? String(v).slice(0, 200) : null;
  }
  const r = el.getBoundingClientRect();
  // Uniqueness probe: how many elements each candidate selector matches. A
  // count > 1 marks the alternative as ambiguous (strict-mode violation) so
  // generateAlternatives drops it. All DOM/CSS access goes through `el` (no
  // DOM lib here).
  const selectorCounts: CapturedAttrs['selectorCounts'] = {};
  try {
    const doc = el.ownerDocument;
    const cssEsc = (s: string): string => doc.defaultView.CSS.escape(s);
    const count = (sel: string): number | undefined => {
      try {
        return doc.querySelectorAll(sel).length;
      } catch {
        return undefined;
      }
    };
    if (attrMap['data-testid']) {
      selectorCounts.testId = count(`[data-testid=${JSON.stringify(attrMap['data-testid'])}]`);
    }
    if (attrMap['id']) selectorCounts.id = count(`#${cssEsc(attrMap['id'])}`);
    if (attrMap['name']) selectorCounts.name = count(`[name=${JSON.stringify(attrMap['name'])}]`);
    const classList = (attrMap['class'] || '')
      .split(/\s+/)
      .filter((c: string) => c.length > 1)
      .slice(0, 10);
    if (classList.length > 0) {
      const classCounts: Record<string, number> = {};
      for (const cls of classList) {
        const n = count(`.${cssEsc(cls)}`);
        if (n !== undefined) classCounts[cls] = n;
      }
      selectorCounts.classes = classCounts;
    }
  } catch {
    // Uniqueness probing is best-effort — never fail the capture.
  }
  // Structural probe: the element's position among same-role elements plus
  // anchor-worthy ancestors — powers name-free and ancestor-scoped
  // alternatives that survive accessible-name renames. Role resolution reuses
  // the shared maps passed in via `arg` (see roleOf below).
  let rolePosition: CapturedAttrs['rolePosition'] = null;
  const ancestors: CapturedAttrs['ancestors'] = [];
  try {
    const doc = el.ownerDocument;
    const cssEsc = (s: string): string => doc.defaultView.CSS.escape(s);
    const count = (sel: string): number | undefined => {
      try {
        return doc.querySelectorAll(sel).length;
      } catch {
        return undefined;
      }
    };
    // Role resolution on live DOM nodes, mirroring the Node-side resolveAriaRole
    // branching. The role maps are passed in (arg.tagRoles/inputRoles) so this
    // serialized-into-page function shares the single source of truth in
    // locator-healing.ts rather than re-declaring it.
    const roleOf = (n: any): string | null => {
      const explicit = n.getAttribute('role');
      if (explicit) return explicit;
      const tag = (n.tagName || '').toLowerCase();
      if (tag === 'input') return inputRoles[(n.getAttribute('type') || 'text').toLowerCase()] ?? 'textbox';
      if (tag === 'select') return n.getAttribute('multiple') != null ? 'listbox' : 'combobox';
      if (tag === 'a') return n.getAttribute('href') != null ? 'link' : null;
      return tagRoles[tag] ?? null;
    };
    const levelOf = (n: any): number | null => {
      const m = /^h([1-6])$/.exec((n.tagName || '').toLowerCase());
      if (m) return Number(m[1]);
      const al = n.getAttribute('aria-level');
      return al && /^\d+$/.test(al) ? Number(al) : null;
    };
    const targetRole = roleOf(el);
    const targetLevel = targetRole === 'heading' ? levelOf(el) : null;

    if (targetRole) {
      const nodes = doc.querySelectorAll(roleSources);
      // A truncated scan would produce wrong counts/indexes — skip instead.
      if (nodes.length <= 4000) {
        let roleCountAll = 0;
        let index = -1;
        let levelCount = 0;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (roleOf(n) !== targetRole) continue;
          if (n === el) index = roleCountAll;
          roleCountAll++;
          if (targetLevel != null && levelOf(n) === targetLevel) levelCount++;
        }
        if (index !== -1) {
          rolePosition = {
            role: targetRole,
            count: roleCountAll,
            index,
            ...(targetLevel != null ? { levelCount } : {}),
          };
        }

        // Anchor-worthy ancestors: a stable hook (test id, id, explicit role,
        // aria-label) or a container/landmark tag, nearest first. Counts are
        // computed here so alternative generation never guesses uniqueness.
        const CONTAINER_TAGS = ['form', 'nav', 'main', 'article', 'section', 'dialog', 'table'];
        const docRoleCount = (role: string): number => {
          let c = 0;
          for (let i = 0; i < nodes.length; i++) if (roleOf(nodes[i]) === role) c++;
          return c;
        };
        let node = el.parentElement;
        let depth = 0;
        while (node && depth < 12 && ancestors.length < 4) {
          depth++;
          const tag = (node.tagName || '').toLowerCase();
          if (tag === 'body' || tag === 'html') break;
          const testId = node.getAttribute('data-testid');
          const id = node.getAttribute('id');
          const explicitRole = node.getAttribute('role');
          const ariaLabel = node.getAttribute('aria-label');
          const anchorRole = explicitRole || (CONTAINER_TAGS.includes(tag) ? tagRoles[tag] : null) || null;
          if (testId || id || anchorRole || ariaLabel) {
            // The leaf-role match count within this ancestor (level-scoped for
            // headings — the emitted chained locator is level-scoped too).
            const scoped = node.querySelectorAll(roleSources);
            let scopedRoleCount = 0;
            if (scoped.length <= 2000) {
              for (let i = 0; i < scoped.length; i++) {
                const n = scoped[i];
                if (roleOf(n) !== targetRole) continue;
                if (targetLevel != null && levelOf(n) !== targetLevel) continue;
                scopedRoleCount++;
              }
            } else {
              scopedRoleCount = -1; // truncated — unusable
            }
            ancestors.push({
              tag,
              depth,
              testId: testId || null,
              id: id || null,
              role: explicitRole || null,
              ariaLabel: ariaLabel || null,
              ...(scopedRoleCount >= 0 ? { scopedRoleCount } : {}),
              ...(testId ? { testIdCount: count(`[data-testid=${JSON.stringify(testId)}]`) } : {}),
              ...(id ? { idCount: count(`#${cssEsc(id)}`) } : {}),
              ...(anchorRole ? { roleCount: docRoleCount(anchorRole) } : {}),
            });
          }
          node = node.parentElement;
        }
      }
    }
  } catch {
    // Structural probing is best-effort — never fail the capture.
  }
  return {
    tagName: el.tagName?.toLowerCase?.() ?? 'unknown',
    attributes: attrMap,
    // Collapse whitespace so multi-line text can't produce a getByText
    // suggestion with literal newlines in it.
    textContent: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    center: {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    },
    hasLabel: !!(el.labels && el.labels.length > 0),
    selectorCounts,
    rolePosition,
    ancestors,
  };
}

// Chain methods that take args and define a new locator scope (not just narrow).
// Origin method/args update to the chain call, e.g. .locator('.item') → locator('.item').
// Positional/filter chains that narrow but don't change locator identity.
// Origin stays from the page-level call, e.g. .first(), .nth(2), .filter(...).
function wrapLocator(page: Page, locator: Locator, originMethod: string, originArgs: unknown[]): Locator {
  return new Proxy(locator, {
    get(target, prop) {
      const original = Reflect.get(target, prop) as unknown;
      if (typeof original !== 'function') return original;
      const fn = original as (...args: unknown[]) => unknown;

      if (CHAIN_METHOD_SET.has(prop as string)) {
        return (...args: unknown[]): Locator => {
          const next = fn.apply(target, args) as Locator;
          if (LOCATOR_CREATING_CHAINS.has(prop as string)) {
            return wrapLocator(page, next, String(prop), args);
          }
          return wrapLocator(page, next, originMethod, originArgs);
        };
      }

      if (!ACTION_METHOD_SET.has(prop as string)) return original;

      return async (...callArgs: unknown[]): Promise<unknown> => {
        // Bind to the sink active when the action starts so the async element
        // capture below writes back to the right test even across a boundary.
        const sink = currentSink;
        // Action outside a tracked test (e.g. during beforeAll) — run untouched.
        if (!sink) return fn.apply(target, callArgs);

        sink.lastActivePage = page;
        const seq = sink.capturedLocators.length;
        // Capture the test call-site now (sync) so the snapshot's location
        // matches the error stack's first user frame — independent of
        // pw:api step ordering, worker interleaving, or concurrent actions.
        const callerLocation = captureCallerLocation();
        // Built once, shared by the placeholder and the resolved snapshot below.
        const used = {
          method: originMethod,
          args: originArgs,
          raw: `${originMethod}(${JSON.stringify(originArgs)})`,
        };

        // Push a placeholder immediately — DOM capture runs async below
        sink.capturedLocators.push({
          location: callerLocation,
          used,
          element: null,
          alternatives: [],
        });

        // The placeholder is already pushed. If the action throws, record the
        // failed locator (so teardown can suggest a fresh one for the element's
        // current identity) and re-throw so the test still fails.
        let result: unknown;
        try {
          result = await fn.apply(target, callArgs);
        } catch (error) {
          sink.failedLocators.push({ method: originMethod, args: originArgs, location: callerLocation });
          throw error;
        }

        // Fire-and-forget: capture element data without blocking the test. The
        // snapshot wait below is bounded by a 500ms deadline (evaluate can hang
        // when the page navigates), but the probe's underlying protocol call is
        // tracked in PENDING_PROBES so the close wrappers can drain it — and in
        // capturePromises so flushSink outwaits it — even when the deadline
        // abandons it. An evaluate still in flight when its page closes crashes
        // the connection dispatcher with a global "not bound" error.
        const probe = target.evaluate(probeElementAttrs, CAPTURED_ATTRS_ARG);
        const settledProbe = probe.then(
          () => undefined,
          () => undefined,
        );
        PENDING_PROBES.add(settledProbe);
        settledProbe.then(() => PENDING_PROBES.delete(settledProbe));
        sink.capturePromises.push(settledProbe);

        const resolveAttrs = (async () => {
          let deadline: ReturnType<typeof setTimeout> | undefined;
          try {
            const attrs = await Promise.race([
              probe,
              new Promise<never>((_, reject) => {
                deadline = setTimeout(() => reject(new Error('locator capture timeout')), 500);
              }),
            ]);

            // The browser-computed accessible name only feeds role-based and
            // form-field alternatives, so only pay for the extra ARIA
            // snapshot when the element actually has a role or is a field.
            const role = resolveAriaRole({ ...attrs, accessibleName: null });
            const isFormField = FORM_FIELD_TAGS.has(attrs.tagName);
            // Bound with a timeout: without it, ariaSnapshot waits up to the
            // test timeout when the page is mid-navigation, which hangs the
            // teardown that drains these capture promises.
            // ariaSnapshotBestEffort adapts the options to the installed
            // Playwright version and never throws (see its doc comment).
            const aria = role || isFormField ? await ariaSnapshotBestEffort(target, 500) : null;

            const accessibleName =
              extractAccessibleName(aria) || approximateAccessibleName({ ...attrs, accessibleName: null });

            sink.capturedLocators[seq] = {
              location: callerLocation,
              used,
              // hasLabel/selectorCounts inform alternative generation only —
              // keep the stored element to the wire shape. rolePosition and
              // ancestors ARE wire fields: the server's renamed-element match
              // uses them at heal time.
              element: {
                tagName: attrs.tagName,
                attributes: attrs.attributes,
                textContent: attrs.textContent,
                accessibleName,
                center: attrs.center,
                ...(attrs.rolePosition ? { rolePosition: attrs.rolePosition } : {}),
                ...(attrs.ancestors && attrs.ancestors.length > 0 ? { ancestors: attrs.ancestors } : {}),
              },
              alternatives: generateAlternatives({ ...attrs, accessibleName }),
            };
          } catch {
            // element detached or timeout — keep the placeholder
          } finally {
            clearTimeout(deadline);
          }
        })();

        sink.capturePromises.push(resolveAttrs);

        return result;
      };
    },
  });
}

/**
 * Instrument a single page: wrap its locator-building methods for healing
 * capture and attach console/network listeners. Idempotent — safe to call on a
 * page already reached through another path (browser patch, `page` fixture).
 */
function instrumentPage(page: Page): void {
  if (!page || INSTRUMENTED_PAGES.has(page)) return;
  INSTRUMENTED_PAGES.add(page);

  // A page reached through the `page` fixture safety net may live in a context
  // the browser patch never saw — instrument it so its close is wrapped too.
  const ctx = pageContext(page);
  if (ctx) instrumentContext(ctx);

  // Drain in-flight probes before a user-initiated close (the guard tolerates
  // page-like test fakes without a close method), and preserve the
  // page-dependent teardown reads while the page can still serve them.
  if (typeof page.close === 'function') {
    const originalClose = page.close.bind(page);
    page.close = async (...args: Parameters<Page['close']>): Promise<void> => {
      await drainPendingProbes(1000);
      const sink = currentSink;
      if (sink) {
        await stashPageState(sink, { page });
        await maybePickOnFailure(sink, { page });
        await maybeInspectOnFailure(sink, { page });
      }
      return originalClose(...args);
    };
  }

  // Opt-out: skipped when PIWI_CAPTURE_LOCATORS=false (set automatically when
  // the reporter's collectPerformanceMetrics / captureLocators is disabled),
  // so the per-action DOM read + ARIA snapshot cost is never paid when unused.
  const captureLocators = process.env.PIWI_CAPTURE_LOCATORS !== 'false';

  if (captureLocators) {
    // Locator factories are accessed by dynamic name, so a string-indexed view
    // of the page is the cleanest local escape hatch from the static surface.
    const factories = page as unknown as Record<string, (...args: unknown[]) => Locator>;
    for (const method of LOCATOR_METHODS) {
      const original = factories[method]!.bind(page);
      factories[method] = (...args: unknown[]): Locator => {
        // Touching a page's locator factory marks it the active page even for
        // assertion-only tests that never call an action method.
        if (currentSink) currentSink.lastActivePage = page;
        return wrapLocator(page, original(...args), method, args);
      };
    }
  }

  page.on('console', (msg: ConsoleMessage) => {
    const sink = currentSink;
    if (!sink) return;
    const type = msg.type();
    if (['warning', 'error', 'assert'].includes(type)) {
      const location = msg.location();
      sink.consoleEntries.push({
        type,
        text: msg.text(),
        timestamp: Date.now(),
        location: location ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : null,
      });
    }
  });

  page.on('requestfinished', (request: Request) => {
    const sink = currentSink;
    if (!sink) return;
    sink.lastActivePage = page;
    const p = (async () => {
      try {
        const url = request.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return;
        const timing = request.timing();
        const response = await request.response();
        const resourceType = request.resourceType();

        // Only keep API/document requests; skip static assets (scripts, styles, fonts, images, media)
        if (!['fetch', 'xhr', 'document', 'other'].includes(resourceType)) return;

        const entry: Record<string, unknown> = {
          method: request.method(),
          url,
          status: response ? response.status() : 0,
          duration: timing.responseEnd > 0 ? Math.round(timing.responseEnd - timing.requestStart) : 0,
          startTime: timing.startTime,
          resourceType,
        };

        if (response) {
          const headers = response.headers();
          // Response content type (without charset/boundary params) — relevant
          // per-request metadata for distinguishing API/JSON vs document/HTML calls.
          const contentType = headers['content-type'];
          if (contentType) entry.contentType = contentType.split(';')[0]!.trim();

          const logHeader = headers['x-piwi-logs'];
          if (logHeader) {
            try {
              entry.serverLogs = JSON.parse(gunzipSync(Buffer.from(logHeader, 'base64')).toString('utf-8'));
            } catch {
              /* ignore malformed header */
            }
          }
        }

        sink.networkRequests.push(entry);
      } catch {
        /* ignore */
      }
    })();
    sink.pendingHandlers.push(p);
  });
}

/**
 * Instrument a browser context so every page it opens — via `newPage()` or as a
 * popup/`window.open` — is captured. Idempotent.
 */
function instrumentContext(context: BrowserContext): void {
  if (!context || INSTRUMENTED_CONTEXTS.has(context)) return;
  INSTRUMENTED_CONTEXTS.add(context);

  const originalNewPage = context.newPage.bind(context);
  context.newPage = async (...args: Parameters<BrowserContext['newPage']>): Promise<Page> => {
    const page = await originalNewPage(...args);
    instrumentPage(page);
    return page;
  };

  // The built-in context fixture closes here at test teardown — BEFORE the
  // auto capture fixture flushes. Drain in-flight probes (an evaluate crossing
  // the close crashes the connection with a global "not bound" error) and take
  // the page-dependent reads (web vitals, failure ARIA snapshot) while the
  // test's page is still open.
  if (typeof context.close === 'function') {
    const originalClose = context.close.bind(context);
    context.close = async (...args: Parameters<BrowserContext['close']>): Promise<void> => {
      await drainPendingProbes(1000);
      const sink = currentSink;
      if (sink) {
        await stashPageState(sink, { context });
        await maybePickOnFailure(sink, { context });
        await maybeInspectOnFailure(sink, { context });
      }
      return originalClose(...args);
    };
  }

  // Popups and pages the context opens on its own (idempotent with the above).
  context.on('page', (page: Page) => instrumentPage(page));
}

/**
 * Patch a browser so any page or context created directly from it is
 * instrumented. This is what makes capture work for suites that build their own
 * pages from the worker-scoped `browser` (e.g. `browser.newPage()` /
 * `browser.newContext().newPage()`) instead of using the `page` fixture.
 * Idempotent.
 */
function patchBrowser(browser: Browser): void {
  if (!browser || PATCHED_BROWSERS.has(browser)) return;
  PATCHED_BROWSERS.add(browser);

  const originalNewPage = browser.newPage.bind(browser);
  browser.newPage = async (...args: Parameters<Browser['newPage']>): Promise<Page> => {
    const page = await originalNewPage(...args);
    instrumentPage(page);
    return page;
  };

  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args: Parameters<Browser['newContext']>): Promise<BrowserContext> => {
    const context = await originalNewContext(...args);
    instrumentContext(context);
    return context;
  };

  // Worker shutdown closes the browser; a probe still in flight would crash
  // the connection dispatcher.
  if (typeof browser.close === 'function') {
    const originalClose = browser.close.bind(browser);
    browser.close = async (...args: Parameters<Browser['close']>): Promise<void> => {
      await drainPendingProbes(1000);
      return originalClose(...args);
    };
  }
}

/**
 * Drain in-flight capture work and attach the collected `piwi-*` data
 * to the test. Mirrors the per-test teardown the `page` fixture used to do, but
 * sourced from the sink so it works regardless of how the test's pages were made.
 */
async function flushSink(sink: CaptureSink, testInfo: TestInfo): Promise<void> {
  // Wait for all in-flight requestfinished handlers before snapshotting
  // networkRequests — the last request (often the one that failed the test)
  // races with teardown and its serverLogs would otherwise be lost.
  await Promise.allSettled(sink.pendingHandlers);

  // ── Attach locator snapshots ──────────────────────────────────────────
  // Cap the drain so a stuck capture (e.g. a navigation in flight) can never
  // hang teardown past the test timeout; per-action evaluate/ariaSnapshot are
  // already bounded, this is a backstop.
  let drainDeadline: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(sink.capturePromises),
    new Promise((resolve) => {
      drainDeadline = setTimeout(resolve, 2000);
    }),
  ]);
  clearTimeout(drainDeadline);

  const page = sink.lastActivePage;
  const pageReadable = page !== null && !isPageClosed(page);

  // A page the test left open (e.g. a raw browser.newPage) never passes
  // through the close wrappers — offer the picker here instead, before the
  // snapshots are attached (a confirmed pick is folded into them).
  if (pageReadable) await maybePickOnFailure(sink);

  if (sink.capturedLocators.length > 0) {
    await testInfo.attach(ATTACHMENT_NAMES.locators, {
      contentType: 'application/json',
      // Repeated call sites (loops) keep only their latest capture — the
      // server stores one row per location anyway, so shipping every
      // iteration is pure payload bloat.
      body: Buffer.from(JSON.stringify(dedupeSnapshotsByLocation(sink.capturedLocators))),
    });
  }

  if (testInfo.status !== 'passed' && testInfo.status !== 'skipped') {
    try {
      // Prefer a live read; fall back to the snapshot the close wrappers
      // stashed — the standard test page is already closed when this auto
      // fixture tears down.
      const snapshot = (pageReadable ? await ariaSnapshotBestEffort(page.locator(':root')) : null) ?? sink.stashedAria;
      if (snapshot) {
        await testInfo.attach(ATTACHMENT_NAMES.ariaSnapshot, {
          contentType: 'text/plain',
          body: snapshot,
        });

        // Suggest a fresh locator for the failed action from the current page.
        // When the element was renamed/moved, the pre-captured alternatives
        // describe the old element, so this points at where it went now — as a
        // Playwright annotation (shown in the report + trace) and an attachment
        // (shown in the trace viewer). It does NOT change the locator.
        const failed = sink.failedLocators[sink.failedLocators.length - 1];
        const suggestion = failed ? suggestLocatorsFromAria(failed, snapshot) : null;
        if (suggestion) {
          testInfo.annotations.push({
            type: LOCATOR_SUGGESTION_ANNOTATION,
            description: `${suggestion.failing} matched nothing on the failing page — the element may have been renamed or moved. Suggested: ${suggestion.suggestions.join('  |  ')}`,
          });
          await testInfo.attach(ATTACHMENT_NAMES.locatorSuggestion, {
            contentType: 'application/json',
            body: Buffer.from(JSON.stringify(suggestion)),
          });
        }
      }
    } catch {
      /* ignore */
    }

    // A page the test left open (e.g. a raw browser.newPage) never passes
    // through the close wrappers — offer it to the Inspector here instead.
    if (pageReadable && !sink.inspected && shouldInspectOnFailure(inspectionGateFromTestInfo(testInfo))) {
      sink.inspected = true;
      await pauseForInspection(page, testInfo);
    }
  }

  // A confirmed picker choice — attach it and surface it in the report. The
  // snapshot write-back already happened at pick time (applyPickToSnapshots).
  if (sink.userPick) {
    const pick = sink.userPick;
    testInfo.annotations.push({
      type: USER_PICK_ANNOTATION,
      description:
        `Replacement locator picked on the failing page for ${pick.failing.rendered}` +
        `${pick.failing.location ? ` at ${pick.failing.location}` : ''}: ${pick.picked.locator}`,
    });
    try {
      await testInfo.attach(ATTACHMENT_NAMES.userPick, {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(pick)),
      });
    } catch {
      /* ignore */
    }
  } else if (!sink.inspected) {
    // Neither tool ran on this failure. If one was *enabled* but the gate
    // refused for an environmental reason (headless / CI), say so — a silent
    // no-op after opting in is baffling. The picker's gate wins the message
    // when both are enabled (it is the more specific tool).
    const reason =
      environmentalSkipReason(inspectionGateFromTestInfo(testInfo, process.env.PIWI_PICK_LOCATOR_ON_FAIL)) ??
      environmentalSkipReason(inspectionGateFromTestInfo(testInfo));
    if (reason) console.log(`[piwi] failure-time locator tools enabled but skipped: ${reason}`);
  }

  if (sink.consoleEntries.length > 0) {
    await testInfo.attach(ATTACHMENT_NAMES.console, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(sink.consoleEntries)),
    });
  }

  if (sink.networkRequests.length > 0) {
    await testInfo.attach(ATTACHMENT_NAMES.network, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(sink.networkRequests)),
    });
  }

  // Live read when the page still exists (e.g. a browser.newPage the test left
  // open); otherwise the vitals the close wrappers stashed before the page went.
  const webVitals = (pageReadable ? await readWebVitals(page) : null) ?? sink.stashedWebVitals;
  if (webVitals) {
    await testInfo.attach(ATTACHMENT_NAMES.webVitals, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(webVitals)),
    });
  }

  // Page state at test end (pass AND fail — the pass side is the diff baseline).
  if (process.env.PIWI_CAPTURE_PAGE_STATE !== 'false') {
    const pageState = (pageReadable ? await readPageState(page) : null) ?? sink.stashedPageState;
    if (pageState) {
      await testInfo.attach(ATTACHMENT_NAMES.pageState, {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(pageState)),
      });
    }
  }
}

/**
 * The fixtures `piwiFixtures` / `extendPiwiFixtures` contribute. The single
 * added fixture is `piwiCapture`: an auto, test-scoped teardown hook that
 * attaches the collected `piwi-*` data. Its name is **reserved** — a user
 * fixture of the same name replaces the capture teardown and silently disables
 * all capture. Exported so `piwiFixtures` and the extended `test` carry it in
 * their types (and a collision surfaces to the type checker).
 */
export interface PiwiFixtures {
  piwiCapture: void;
}

/**
 * Playwright fixtures that collect network requests, console entries,
 * web vitals, ARIA snapshots, and locator interaction data during a test.
 *
 * Capture is wired at the `browser` level, so it works whether a test uses the
 * standard `page` fixture or builds its own pages from `browser` /
 * `browser.newContext()`. Collected data is attached as `piwi-*`
 * test-info attachments which the Piwi Dashboard reporter parses on `onTestEnd`.
 */
export const piwiFixtures: Fixtures<
  PiwiFixtures,
  {},
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = {
  // Worker-scoped: patch the shared browser so every page/context created from
  // it — including by user fixtures that take `browser` directly — is captured.
  browser: [
    async ({ browser }: PlaywrightWorkerArgs, use: UseFn<Browser>) => {
      patchBrowser(browser);
      await use(browser);
    },
    { scope: 'worker' },
  ],

  // Safety net for the standard `page` fixture, in case its page is created
  // through an internal path the browser patch doesn't see. Idempotent, so it
  // never double-wraps a page the browser patch already instrumented.
  page: async ({ page }: PlaywrightTestArgs, use: UseFn<Page>) => {
    instrumentPage(page);
    await use(page);
  },

  // Auto, test-scoped: open a capture sink for the running test and flush it
  // (attach the collected data) at teardown. Runs for every test without being
  // requested, so suites that never destructure `page` are still captured.
  piwiCapture: [
    async ({}, use: UseFn<void>, testInfo: TestInfo) => {
      const sink = createSink();
      sink.testInfo = testInfo;
      currentSink = sink;
      try {
        await use();
      } finally {
        currentSink = null;
        await flushSink(sink, testInfo);
      }
    },
    { auto: true },
  ],
};

/**
 * Extend a Playwright `test` object with the Piwi capture fixtures. The
 * returned `test` carries the existing fixtures plus {@link PiwiFixtures}.
 *
 * Use this instead of importing `@playwright/test` directly from this package
 * to avoid the "Requiring @playwright/test second time" error caused by
 * duplicate module resolution.
 *
 * @example
 * ```ts
 * import { test as base } from '@playwright/test';
 * import { extendPiwiFixtures } from '@piwitests/reporter';
 *
 * export const test = extendPiwiFixtures(base);
 * ```
 */
export function extendPiwiFixtures<TestArgs extends FixtureArgs, WorkerArgs extends FixtureArgs>(
  test: TestType<TestArgs, WorkerArgs>,
): TestType<TestArgs & PiwiFixtures, WorkerArgs> {
  return (
    test as unknown as { extend: (f: typeof piwiFixtures) => TestType<TestArgs & PiwiFixtures, WorkerArgs> }
  ).extend(piwiFixtures);
}
