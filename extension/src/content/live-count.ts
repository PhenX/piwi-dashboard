import type { RankedLocator } from '@piwitests/picker-dom';
import { domRoleOf, domHeadingLevel, type DomRoleMaps } from '@piwitests/picker-dom';

/** Result of re-checking a ranked locator against the live DOM right now. */
export interface LiveCount {
  /** Number of elements the locator currently matches, or null when this shape isn't re-checked (see module doc). */
  count: number | null;
}

/**
 * Re-count how many elements a ranked locator matches against the live DOM,
 * independent of the counts baked in at pick time — a page can re-render
 * between the pick and the moment the user reviews results.
 *
 * Only the shapes that can be re-evaluated exactly (not approximately) are
 * covered: `getByTestId`, `locator` (already a CSS selector), and a bare
 * `getByRole` (no ancestor anchor). Text/label/placeholder/alt/title
 * matching and anchor-scoped role chains follow Playwright's own fuzzy
 * text-matching and chain-scoping rules, which this does not attempt to
 * reproduce — those candidates keep whatever count was captured at pick
 * time (`count: null` here) rather than risk a confidently-wrong number.
 */
export function liveCount(locator: RankedLocator, maps: DomRoleMaps): LiveCount {
  const args = locator.args as Record<string, unknown>;

  if (locator.method === 'getByTestId' && typeof args.testId === 'string') {
    return { count: document.querySelectorAll(`[data-testid=${JSON.stringify(args.testId)}]`).length };
  }

  if (locator.method === 'locator' && typeof args.selector === 'string') {
    try {
      return { count: document.querySelectorAll(args.selector).length };
    } catch {
      return { count: null };
    }
  }

  if (
    locator.method === 'getByRole' &&
    typeof args.role === 'string' &&
    args.name === undefined &&
    args.anchorTestId === undefined &&
    args.anchorSelector === undefined &&
    args.anchorRole === undefined
  ) {
    const role = args.role;
    const level = typeof args.level === 'number' ? args.level : null;
    let count = 0;
    for (const el of document.querySelectorAll<HTMLElement>(
      '[role],a,button,input,select,textarea,h1,h2,h3,h4,h5,h6',
    )) {
      if (domRoleOf(el, maps) !== role) continue;
      if (level != null && domHeadingLevel(el) !== level) continue;
      count++;
    }
    return { count };
  }

  return { count: null };
}
