/**
 * Shared utilities for locator healing — pure functions that work in both
 * Node.js and browser (Web Crypto) environments.
 */
import type { RankedLocator, LocatorFixRecommendation } from './locator-healing.types';

/**
 * Method family for each locator method. The single recommended fix prefers an
 * alternative from the same family as the failing locator, so the edit stays
 * idiomatic to the developer's original style:
 *  - `semantic`: role + accessible name (and the equivalent aria-label form)
 *  - `text`:     visible text (`getByText`/`getByAltText`/`getByTitle`)
 *  - `label`:    form-field label (`getByLabel`/`getByPlaceholder`)
 *  - `testid`:   purpose-built test id (the usual escalation target)
 *  - `css`:      raw CSS/selector (`locator`)
 */
const LOCATOR_FAMILY: Record<string, string> = {
  getByTestId: 'testid',
  getByRole: 'semantic',
  getByLabel: 'label',
  getByPlaceholder: 'label',
  getByText: 'text',
  getByAltText: 'text',
  getByTitle: 'text',
  locator: 'css',
  'page.locator': 'css',
};

/**
 * Stability floor a same-family pick must clear to be recommended. Below this
 * the original style is too fragile to keep (e.g. a raw `locator('.btn-abc123')`),
 * so the recommendation escalates to the most stable alternative instead.
 */
export const CONVENTION_STABILITY_FLOOR = 50;

/**
 * Choose the single recommended fix from a stability-ranked alternative list,
 * keeping the developer's original locator style where it is stable enough.
 *
 * The full menu (`alternatives`) is still ranked by raw stability; this only
 * decides which one to surface as the "Top recommendation" / the AI's
 * `suggestedFix.code`. Ladder:
 *   1. same method, then same family — the most stable such pick that clears the floor;
 *   2. otherwise the most stable alternative overall (usually `getByTestId`);
 *   3. when even that is below the floor, flag that a `data-testid` should be added.
 *
 * `alternatives` MUST be sorted descending by score (as stored). Pure — runs at
 * read time, no capture change.
 */
export function recommendLocatorFix(
  failingMethod: string | null | undefined,
  alternatives: RankedLocator[],
  floor: number = CONVENTION_STABILITY_FLOOR,
): LocatorFixRecommendation {
  const durable = alternatives[0] ?? null;

  if (!durable) {
    return {
      recommended: null,
      durable: null,
      preservesConvention: false,
      hasDurableAlternative: false,
      suggestAddTestId: false,
    };
  }

  // Same method first, then same family — take the most stable pick (the list is
  // pre-sorted, so the first match is the strongest) that clears the floor.
  const family = failingMethod ? LOCATOR_FAMILY[failingMethod] : undefined;
  const conventionPick =
    (failingMethod ? alternatives.find((a) => a.method === failingMethod && a.score >= floor) : undefined) ??
    (family ? alternatives.find((a) => LOCATOR_FAMILY[a.method] === family && a.score >= floor) : undefined);

  // Escalate to the most stable alternative when nothing in the original family
  // is stable enough to keep.
  const recommended = conventionPick ?? durable;

  return {
    recommended,
    durable,
    preservesConvention: !!conventionPick,
    hasDurableAlternative: recommended.locator !== durable.locator,
    // Even the most stable alternative is fragile — recommend adding a test id.
    suggestAddTestId: durable.score < floor,
  };
}

async function sha256Hex(input: string): Promise<string> {
  // Use Web Crypto API — same API surface in Node 19+ and browsers.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A locator's identity is the method plus the string literals it targets, in
 * source order — the role/testid/text/selector and any string option values
 * (e.g. `name`). Booleans (`exact`), numbers and regex carry no element
 * identity and are skipped. This is the single normalization both sides of the
 * healing round-trip rely on:
 *
 *  - capture (server `persistRunCases`) calls {@link locatorSignature} with the
 *    raw args the test passed, e.g. `('getByRole', ['button', { name: 'Submit' }])`;
 *  - lookup (server `getLocatorHealing`) calls {@link locatorSignatureFromExpression}
 *    with the locator expression parsed out of the failure error,
 *    e.g. `getByRole('button', { name: 'Submit' })`.
 *
 * Both must produce the same hash, so the stored snapshot is found again.
 */
export function locatorArgStrings(args: unknown[]): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      out.push(v);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object' && !(v instanceof RegExp)) {
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        if (key === 'exact') continue; // matching mode, not identity
        walk(val);
      }
    }
  };
  args.forEach(walk);
  return out;
}

/**
 * Extract the leading method name from a locator expression
 * (`getByRole('button')` → `getByRole`, `page.locator('.x')` → `locator`).
 */
export function locatorExpressionMethod(expr: string): string | null {
  const m = expr.match(/(\w+)\s*\(/);
  return m ? m[1]! : null;
}

/**
 * Extract the quoted string literals from a locator expression, in order,
 * honoring `\` escapes and both quote styles. Object keys and booleans are
 * unquoted in Playwright's rendering, so only string values are captured —
 * mirroring {@link locatorArgStrings} on the capture side.
 */
export function locatorExpressionStrings(expr: string): string[] {
  const out: string[] = [];
  const open = expr.indexOf('(');
  let i = open === -1 ? 0 : open + 1;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === "'" || ch === '"') {
      let s = '';
      i++;
      while (i < expr.length && expr[i] !== ch) {
        if (expr[i] === '\\') {
          s += expr[i + 1] ?? '';
          i += 2;
          continue;
        }
        s += expr[i];
        i++;
      }
      out.push(s);
      i++; // skip the closing quote
      continue;
    }
    i++;
  }
  return out;
}

/**
 * True when two locators target the same element identity — same method and
 * the same string literals (order-insensitive: option-object key order differs
 * between capture-side args and expression-parsed args). Used to keep the
 * locator that just failed out of the recommendation pool.
 */
export function locatorIdentityEquals(
  aMethod: string | null | undefined,
  aArgs: unknown,
  bMethod: string | null | undefined,
  bArgs: unknown,
): boolean {
  if (!aMethod || !bMethod || aMethod !== bMethod) return false;
  const strings = (args: unknown): string => JSON.stringify(locatorArgStrings([args]).sort());
  return strings(aArgs) === strings(bArgs);
}

/**
 * True when an alternative's identity depends on the given accessible name —
 * one of its string literals matches it (case-insensitive). Such alternatives
 * break together with the name when the element is relabeled.
 */
export function alternativeUsesName(alt: RankedLocator, name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  return locatorArgStrings([alt.args]).some((s) => s.trim().toLowerCase() === needle);
}

/** Stable signature for a captured locator (method + ordered string literals). */
export async function locatorSignature(method: string, args: unknown[]): Promise<string> {
  return sha256Hex(`${method} ${JSON.stringify(locatorArgStrings(args))}`);
}

/** Stable signature for a locator expression parsed from a failure error. */
export async function locatorSignatureFromExpression(expr: string): Promise<string> {
  const method = locatorExpressionMethod(expr) ?? '';
  return sha256Hex(`${method} ${JSON.stringify(locatorExpressionStrings(expr))}`);
}
