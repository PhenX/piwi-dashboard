/**
 * Cross-page action recording — the wire shapes and pure normalization for
 * turning a stream of captured DOM interactions into a `RecordedSession`
 * that `codegen.ts` (raw) and `function-match.ts` (catalog-aware) both
 * consume.
 *
 * The single source of truth for the extension's recorder (which builds
 * `RawCaptureEvent`s from real DOM events, one page/content-script instance
 * at a time) and, later, any server-side consumer of a recorded session.
 * Everything here is plain data plus pure functions — no DOM, no `node:*` —
 * so it stays inlineable everywhere `@piwitests/core` already is.
 */

/** The Playwright action a recorded step maps to. */
export type StepAction = 'goto' | 'click' | 'fill' | 'check' | 'uncheck' | 'selectOption' | 'press' | 'assertVisible';

/** One ranked locator alternative, trimmed to what codegen/matching need (mirrors `RankedLocator` minus scoring metadata not used here). */
export interface RecordedLocatorAlternative {
  locator: string;
  method: string;
  score: number;
}

/** The element a step acted on — enough to re-derive/re-rank a locator and to match it against a catalog's DOM pattern. */
export interface RecordedTarget {
  tagName: string;
  role: string | null;
  accessibleName: string | null;
  testId: string | null;
  /** Normalized, whitespace-collapsed visible text, truncated to 120 chars. */
  text: string | null;
  /** Ranked locator alternatives for this element, best first — computed once at capture time. */
  alternatives: RecordedLocatorAlternative[];
}

/** One recorded, already-normalized user action. */
export interface RecordedStep {
  action: StepAction;
  target: RecordedTarget | null;
  /** `fill`/`selectOption` value, or the key name for `press`. Never set for a password-type field — see `redacted`. */
  value: string | null;
  /** True when `value` was stripped because the source field was `type="password"` — codegen emits a placeholder instead. */
  redacted: boolean;
  pageUrl: string;
  timestamp: number;
}

export interface RecordedSession {
  steps: RecordedStep[];
  startedAt: number;
  /** The very first page's URL — the only step that becomes an explicit `page.goto(...)` in codegen. */
  startUrl: string;
}

/** A raw capture event, as built by the extension's DOM listeners — one per meaningful browser event, before coalescing. */
export interface RawCaptureEvent {
  kind: 'click' | 'input' | 'change' | 'keydown' | 'navigate';
  target: RecordedTarget | null;
  /** Current field value (input/change), the key pressed (keydown), or the new URL (navigate). */
  value: string | null;
  checked: boolean | null;
  inputType: string | null;
  isPasswordField: boolean;
  pageUrl: string;
  timestamp: number;
}

function sameTarget(a: RecordedTarget | null, b: RecordedTarget | null): boolean {
  if (!a || !b) return a === b;
  const ka = a.testId ?? `${a.tagName}|${a.role ?? ''}|${a.accessibleName ?? ''}`;
  const kb = b.testId ?? `${b.tagName}|${b.role ?? ''}|${b.accessibleName ?? ''}`;
  return ka === kb;
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Coalesce a stream of raw capture events into `RecordedStep`s:
 *  - a burst of `input` events on the same field collapses into one `fill`,
 *    committed once the field changes or the burst ends (the last value
 *    wins);
 *  - `change` on a checkbox/radio becomes `check`/`uncheck` from the
 *    resulting `checked` state, not a raw `click`;
 *  - `change` on a `<select>` becomes `selectOption`;
 *  - `Enter` on a text field becomes `press('Enter')`, replacing the click
 *    that would otherwise double up with it;
 *  - a plain `click` becomes a `click` step;
 *  - `navigate` events become `goto` steps only for the session's very first
 *    page — later navigations are implied by the click/press that caused
 *    them and are dropped (they still update `pageUrl` on later steps via
 *    the caller passing the current page's URL on each event).
 *  - password-field values are never carried through — `redacted: true`,
 *    `value: null`.
 */
export function normalizeSteps(events: RawCaptureEvent[]): RecordedStep[] {
  const steps: RecordedStep[] = [];
  let pendingFill: {
    target: RecordedTarget | null;
    value: string;
    pageUrl: string;
    timestamp: number;
    redacted: boolean;
  } | null = null;
  let sawFirstGoto = false;

  function flushPendingFill(): void {
    if (!pendingFill) return;
    steps.push({
      action: 'fill',
      target: pendingFill.target,
      value: pendingFill.redacted ? null : pendingFill.value,
      redacted: pendingFill.redacted,
      pageUrl: pendingFill.pageUrl,
      timestamp: pendingFill.timestamp,
    });
    pendingFill = null;
  }

  for (const ev of events) {
    if (ev.kind === 'navigate') {
      flushPendingFill();
      if (!sawFirstGoto) {
        sawFirstGoto = true;
        steps.push({
          action: 'goto',
          target: null,
          value: ev.value,
          redacted: false,
          pageUrl: ev.value ?? ev.pageUrl,
          timestamp: ev.timestamp,
        });
      }
      continue;
    }

    if (ev.kind === 'input') {
      if (pendingFill && sameTarget(pendingFill.target, ev.target)) {
        pendingFill.value = ev.value ?? '';
        pendingFill.timestamp = ev.timestamp;
        pendingFill.redacted = pendingFill.redacted || ev.isPasswordField;
        continue;
      }
      flushPendingFill();
      pendingFill = {
        target: ev.target,
        value: ev.value ?? '',
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
        redacted: ev.isPasswordField,
      };
      continue;
    }

    if (ev.kind === 'keydown') {
      if (ev.value !== 'Enter') continue;
      // Enter commits whatever field was mid-fill, then replaces the click that would otherwise follow it.
      flushPendingFill();
      steps.push({
        action: 'press',
        target: ev.target,
        value: 'Enter',
        redacted: false,
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
      });
      continue;
    }

    if (ev.kind === 'change') {
      flushPendingFill();
      if (ev.inputType === 'checkbox' || ev.inputType === 'radio') {
        steps.push({
          action: ev.checked ? 'check' : 'uncheck',
          target: ev.target,
          value: null,
          redacted: false,
          pageUrl: ev.pageUrl,
          timestamp: ev.timestamp,
        });
        continue;
      }
      if (ev.inputType === 'select') {
        steps.push({
          action: 'selectOption',
          target: ev.target,
          value: ev.value,
          redacted: false,
          pageUrl: ev.pageUrl,
          timestamp: ev.timestamp,
        });
        continue;
      }
      continue;
    }

    if (ev.kind === 'click') {
      flushPendingFill();
      // A checkbox/radio click that will also fire `change` is handled there; a plain click on anything else records here.
      if (ev.inputType === 'checkbox' || ev.inputType === 'radio') continue;
      steps.push({
        action: 'click',
        target: ev.target,
        value: null,
        redacted: false,
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
      });
      continue;
    }
  }

  flushPendingFill();
  return steps.map((s) =>
    s.target ? { ...s, target: { ...s.target, text: s.target.text ? normalizeText(s.target.text) : null } } : s,
  );
}

/** Builds a `RecordedSession` from a flat step list — `startUrl` is the first step's page, or the first `goto`'s value. */
export function buildSession(steps: RecordedStep[], startedAt: number): RecordedSession {
  const firstGoto = steps.find((s) => s.action === 'goto');
  const startUrl = firstGoto?.value ?? steps[0]?.pageUrl ?? '';
  return { steps, startedAt, startUrl };
}
