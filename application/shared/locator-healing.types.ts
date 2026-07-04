/**
 * Shared types for locator healing — the in-runtime capture + storage of
 * alternative locators for every element interaction.
 *
 * Lives in `shared/` so both server and demo (in-browser sql.js) can
 * import the same definitions. The reporter package uses structural
 * compatibility (mirrored types, no shared import).
 */

/** A ranked alternative locator suggestion. */
export interface RankedLocator {
  locator: string;
  method: string;
  args: Record<string, unknown>;
  /** 0-100 stability score. data-testid=100, semantic CSS=35-40, hash-suffixed=10. */
  score: number;
}

/**
 * The single recommended fix, chosen from the stability-ranked alternatives so
 * it keeps the developer's original locator style where that style is stable
 * enough — a minimal, idiomatic edit. The full ranked menu stays available; this
 * just picks the one fix to surface as the "Top recommendation".
 */
export interface LocatorFixRecommendation {
  /** The recommended fix. Null only when there are no alternatives at all. */
  recommended: RankedLocator | null;
  /** The most stable alternative overall — surfaced so a sturdier (but different) choice stays visible. */
  durable: RankedLocator | null;
  /** True when `recommended` keeps the failing locator's method family (same style). */
  preservesConvention: boolean;
  /** True when `durable` is a different, sturdier option than `recommended`. */
  hasDurableAlternative: boolean;
  /** True when nothing cleared the stability floor — advise adding a `data-testid` to the app. */
  suggestAddTestId: boolean;
}

/**
 * Match counts for candidate selectors, probed against the live DOM at capture
 * time. A count > 1 marks the selector ambiguous (strict-mode violation).
 */
export interface SelectorCounts {
  testId?: number;
  id?: number;
  name?: number;
  classes?: Record<string, number>;
}

/** Raw element attributes captured after a successful action. */
export interface ElementAttributes {
  tagName: string;
  attributes: Record<string, string | null>;
  /** Visible text, truncated to 80 chars. */
  textContent: string | null;
  /** Browser-computed accessible name from ariaSnapshot(). */
  accessibleName: string | null;
  /** Center point of the element's bounding box — spatial discriminator. */
  center: { x: number; y: number } | null;
  /** True when the element has an associated <label> — gates getByLabel. */
  hasLabel?: boolean;
  /** Live-page uniqueness probe results for candidate selectors. */
  selectorCounts?: SelectorCounts;
}

/** One captured element interaction (per locator call site). */
export interface LocatorSnapshot {
  /** The Playwright step location — unique, stable identity of this call site. */
  location: string | null;
  /** The locator the test code actually used. */
  used: {
    method: string;
    /** All args passed to the locator method. */
    args: unknown[];
    /** Original step title, for round-tripping. */
    raw: string;
  };
  /** Element attributes — null for gap entries (failed actions). */
  element: {
    tagName: string;
    attributes: Record<string, string | null>;
    textContent: string | null;
    accessibleName: string | null;
    center: { x: number; y: number } | null;
  } | null;
  /** Computed alternative locators, ranked by stability score (max 10). */
  alternatives: RankedLocator[];
}

/**
 * Where a healing lookup's alternatives came from, best first:
 * `prior-run` (exact call-site match against a pre-captured snapshot),
 * `fingerprint` (locator-signature match, survives line shifts),
 * `cross-test` (same locator signature captured by another test in the project),
 * `element-match` (element renamed/moved — fresh locators for its current identity),
 * `aria-snapshot` (derived from the failure-time ARIA snapshot only).
 */
export type LocatorHealingSource =
  | 'prior-run'
  | 'element-match'
  | 'fingerprint'
  | 'cross-test'
  | 'aria-snapshot'
  | 'none';

/**
 * Result of a healing lookup for one failing test-run case. Single source of
 * truth for the API payload shape — the server handler, MCP tools, AI context
 * and the dashboard panel all import this.
 */
export interface LocatorHealingResult {
  failingLocator: { method: string; args: Record<string, unknown> } | null;
  fromPriorSuccess: RankedLocator[] | null;
  /**
   * Fresh locators generated from the element's *current* identity, when the
   * pre-captured locator no longer matches the live page (renamed/moved element).
   */
  fromElementMatch: RankedLocator[] | null;
  fromAriaSnapshot: RankedLocator[] | null;
  source: LocatorHealingSource;
  /**
   * The single recommended fix — convention-preserving where possible — chosen
   * from the active alternative list. Null when no alternatives are available.
   */
  recommendation: LocatorFixRecommendation | null;
  /**
   * When the alternatives come from a stored snapshot (`prior-run` /
   * `fingerprint` / `cross-test`), the time that snapshot was last captured —
   * lets consumers judge freshness. Null otherwise.
   */
  capturedAt: string | null;
}
