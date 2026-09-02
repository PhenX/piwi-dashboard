/**
 * Decide, from a Playwright error's text, whether the failing locator ever
 * resolved. Locator healing (replacement locators) only helps when it did not:
 * the element was never found, matched nothing, or matched several elements.
 * A locator that resolved and then failed an action or an assertion is a
 * different problem, and rewriting it would be a harmful edit.
 *
 * Pure text analysis, shared by the server ladder, the run's failure groups and
 * the demo. Playwright's call log is the evidence: a `waiting for <locator>`
 * line followed by `locator resolved to …` means the locator worked.
 */
import { extractLeafSelector, stripAnsi } from '#shared/error-fingerprint';

export type LocatorResolutionKind =
  /** `waiting for <locator>` with no later `locator resolved to` line. */
  | 'never-resolved'
  /** An explicit `resolved to 0 elements`. */
  | 'zero-elements'
  /** A strict-mode violation — the locator matched several elements. */
  | 'strict-mode'
  /** The locator resolved; the action or assertion failed afterwards. */
  | 'resolved'
  /** A navigation error (`page.goto`, `waitForURL`, `net::ERR_*`). */
  | 'navigation'
  /** No locator expression in the error text. */
  | 'no-locator'
  /** A locator is named but the text carries no call log to judge from. */
  | 'unknown';

export interface LocatorResolutionVerdict {
  kind: LocatorResolutionKind;
  /** True when a replacement locator can address the failure. */
  applicable: boolean;
  /** One sentence for the UI when healing does not apply; null otherwise. */
  reason: string | null;
}

const NAVIGATION_RE =
  /\b(?:page|frame)\.(?:goto|waitForURL|waitForNavigation|reload|goBack|goForward)\b|net::ERR_|NS_ERROR_|Navigation failed|navigating to "/i;

/** The call-log line naming the locator being waited for. */
const WAITING_FOR_LOCATOR_RE = /waiting for (?:\w+\.)?(?:getBy\w+|locator|frameLocator)\(/;

/**
 * Evidence that the locator matched at least one element: Playwright prints
 * `locator resolved to …` (an element, a count, a visibility state), or moves
 * on to an action phase that needs a resolved element.
 */
const RESOLVED_RE =
  /\bresolved to (?!0 elements)\S|element is not (?:enabled|visible|stable|editable|attached)|intercepts pointer events|attempting \w+ action/;

/** Drop the JS stack frames so a helper named `goto` in a path never reads as a navigation. */
function withoutStackFrames(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s+at /.test(line))
    .join('\n');
}

export function classifyLocatorResolution(error: string | null | undefined): LocatorResolutionVerdict {
  const text = error ? withoutStackFrames(stripAnsi(error)) : '';
  if (!text.trim()) {
    return { kind: 'no-locator', applicable: false, reason: 'No locator in the error; nothing to heal.' };
  }

  if (/strict mode violation/i.test(text)) return { kind: 'strict-mode', applicable: true, reason: null };

  if (NAVIGATION_RE.test(text)) {
    return {
      kind: 'navigation',
      applicable: false,
      reason: 'The page failed to navigate before any locator ran; this is not a locator problem.',
    };
  }

  if (!extractLeafSelector(text)) {
    return { kind: 'no-locator', applicable: false, reason: 'No locator in the error; nothing to heal.' };
  }

  if (/resolved to 0 elements/i.test(text)) return { kind: 'zero-elements', applicable: true, reason: null };

  const waiting = WAITING_FOR_LOCATOR_RE.exec(text);
  const afterWaiting = waiting ? text.slice(waiting.index) : text;
  if (RESOLVED_RE.test(afterWaiting)) {
    return { kind: 'resolved', applicable: false, reason: 'The locator resolved; this is not a locator problem.' };
  }

  if (waiting) return { kind: 'never-resolved', applicable: true, reason: null };
  return { kind: 'unknown', applicable: true, reason: null };
}

/**
 * The AI-context line for a healing result the gate rejected, so the model is
 * told not to propose a replacement locator. Null when healing applies.
 */
export function healingNotApplicableMarkdown(healing: { applicable?: boolean; reason?: string | null }): string | null {
  if (healing.applicable !== false) return null;
  return `## Alternative Locators (Locator Healing)\nNot applicable — ${healing.reason ?? 'this is not a locator problem.'} Do not propose a replacement locator.`;
}
