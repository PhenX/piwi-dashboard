/**
 * Server-side locator healing — lookup alternatives for failing locators.
 *
 * Queries the normalized `locator_snapshots` table by test_case_id + location,
 * with fallback to element-fingerprint matching against the current page (the
 * "element changed" case), fuzzy matching by locator signature, and ARIA
 * snapshot generation when no prior snapshot exists.
 */
import { and, eq, ne, notInArray, sql, inArray } from 'drizzle-orm';
import { locatorSnapshots, testCases, testRunsCases, type LocatorSnapshotRow } from '../database/schema';
import { extractLeafSelector } from '#shared/error-fingerprint';
import {
  locatorSignatureFromExpression,
  locatorExpressionMethod,
  locatorSignature,
  recommendLocatorFix,
  locatorIdentityEquals,
  alternativeUsesName,
} from '#shared/locator-healing';
import {
  elementMatchOutcome,
  parseAriaCandidates,
  TEXT_CONTENT_ROLES,
  type ElementFingerprint,
} from '#shared/locator-fingerprint';
import type {
  RankedLocator,
  LocatorSnapshot,
  LocatorHealingResult,
  ElementAttributes,
} from '#shared/locator-healing.types';
import type { DrizzleDB } from '#shared/handlers/db';

// The payload shape lives in shared/ so the API handler, MCP tools, AI context
// and the dashboard panel all agree on it; re-exported for existing importers.
export type { LocatorHealingResult, LocatorHealingSource } from '#shared/locator-healing.types';

/**
 * Parse a Playwright locator expression into method + args.
 *
 * Examples:
 *   getByTestId('submit-btn') → { method: 'getByTestId', args: { testId: 'submit-btn' } }
 *   getByRole('button', { name: 'Submit' }) → { method: 'getByRole', args: { role: 'button', name: 'Submit' } }
 *   locator('.my-class') → { method: 'locator', args: { selector: '.my-class' } }
 */
function parseLocatorExpression(expr: string): {
  method: string;
  args: Record<string, unknown>;
} | null {
  const methodMatch = expr.match(/^(\w+)\(/);
  if (!methodMatch) return null;
  const method = methodMatch[1]!;

  const inner = expr.slice(method.length + 1, -1).trim();
  if (!inner) return { method, args: {} };

  const args: unknown[] = [];
  let i = 0;

  while (i < inner.length) {
    const ch = inner[i];
    if (ch === ',' || ch === ' ') {
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const end = findMatchingQuote(inner, i);
      args.push(inner.slice(i + 1, end));
      i = end + 1;
      continue;
    }

    if (ch === '{') {
      const end = findMatchingBrace(inner, i);
      args.push(parseOptionsObject(inner.slice(i, end + 1)));
      i = end + 1;
      continue;
    }

    // Fallback: skip unknown token
    i++;
  }

  return normalizeParsedArgs(method, args);
}

function findMatchingQuote(s: string, start: number): number {
  const quote = s[start];
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === quote) return i;
  }
  return s.length - 1;
}

/**
 * Parse a Playwright option object as printed in error text, e.g.
 * `{ name: 'Submit', exact: true }`. This is NOT JSON — keys are unquoted and
 * strings use single quotes — so `JSON.parse` would throw. Values are read
 * loosely (string / boolean / number / regex) for display only; matching uses
 * the locator signature, not these parsed args.
 */
function parseOptionsObject(src: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const re = /(\w+)\s*:\s*('(?:\\.|[^'])*'|"(?:\\.|[^"])*"|true|false|-?\d+(?:\.\d+)?|\/(?:\\.|[^/])*\/[a-z]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const key = m[1]!;
    const raw = m[2]!;
    if (raw === 'true') obj[key] = true;
    else if (raw === 'false') obj[key] = false;
    else if (/^-?\d/.test(raw)) obj[key] = Number(raw);
    else if (raw.startsWith('/'))
      obj[key] = raw; // regex — keep as text for display
    else obj[key] = raw.slice(1, -1).replace(/\\(.)/g, '$1'); // unquote + unescape
  }
  return obj;
}

function findMatchingBrace(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return s.length - 1;
}

function normalizeParsedArgs(method: string, args: unknown[]): { method: string; args: Record<string, unknown> } {
  const obj: Record<string, unknown> = {};

  switch (method) {
    case 'getByTestId':
      obj.testId = args[0];
      break;
    case 'getByRole': {
      const role = args[0] as string | undefined;
      if (role) obj.role = role;
      const opts = (args[1] as Record<string, unknown>) ?? {};
      for (const [k, v] of Object.entries(opts)) {
        if (k !== 'exact') obj[k] = v;
      }
      break;
    }
    case 'getByText':
      obj.text = args[0];
      break;
    case 'getByLabel':
      obj.label = args[0];
      break;
    case 'getByPlaceholder':
      obj.placeholder = args[0];
      break;
    case 'getByAltText':
      obj.text = args[0];
      break;
    case 'getByTitle':
      obj.title = args[0];
      break;
    case 'locator':
      obj.selector = args[0];
      break;
    case 'page.locator':
      obj.selector = args[0];
      break;
    default:
      obj.args = args;
  }

  return { method, args: obj };
}

/**
 * Extract the call-site location (`file:line:col`) from a Playwright error's
 * stack frames — the first frame outside node_modules and Node internals.
 * Handles both anonymous frames (`at tests/x.spec.ts:42:5`) and named ones
 * (`at Object.foo (tests/x.spec.ts:42:5)`), mirroring `extractTopFrameFile`.
 */
function extractErrorLocation(error: string): string | null {
  const frameRe = /^\s+at (?:.*? \()?([^()\s][^()]*?):(\d+):(\d+)\)?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = frameRe.exec(error)) !== null) {
    const file = m[1]!.replace(/\\/g, '/');
    if (file.includes('node_modules') || file.startsWith('node:')) continue;
    return `${file}:${m[2]}:${m[3]}`;
  }
  return null;
}

/**
 * Generate alternatives from ARIA snapshot text, filtered and scored by
 * relevance to the failing locator. Previously this dumped every named element
 * on the page with a flat score of 40 — a sidebar button and the actual
 * replacement heading were scored identically, and since all scores were equal,
 * the first element in ARIA tree order (always nav/sidebar) "won".
 *
 * Now the function accepts the failing locator's args so it can:
 * 1. Filter to elements whose accessible name overlaps the failing text
 * 2. Score proportionally to token overlap
 * 3. Generate `getByText` alternatives for text-bearing roles
 */
function generateFromAriaSnapshot(
  ariaSnapshot: string | null,
  failingLocator: { method: string; args: Record<string, unknown> } | null,
): RankedLocator[] | null {
  if (!ariaSnapshot) return null;

  const alts: RankedLocator[] = [];
  const seen = new Set<string>();

  const add = (l: RankedLocator) => {
    if (!seen.has(l.locator)) {
      seen.add(l.locator);
      alts.push(l);
    }
  };

  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // Extract the failing text: the string literal(s) the test was searching for.
  const failingText = extractFailingText(failingLocator);
  const failingTokens = failingText ? tokenize(failingText) : null;

  // Collect all candidates first so we can apply a position bonus (content-area
  // elements appear later in the ARIA tree than sidebar/nav). Without this, the
  // sidebar wins every time because all scores were identical.
  const candidates = parseAriaCandidates(ariaSnapshot);
  const totalCandidates = candidates.length;

  for (let idx = 0; idx < candidates.length; idx++) {
    const { role, name, level } = candidates[idx]!;
    if (!name) continue;

    // Score: 40 base + text-overlap bonus (Jaccard similarity, 0–25)
    // + position bonus (0–10, linear across the tree order). Content-area
    // elements sit after the sidebar so they naturally score higher.
    let score = 40;
    if (failingTokens && failingTokens.size > 0) {
      const nameTokens = tokenize(name);
      const intersection = [...nameTokens].filter((t) => failingTokens.has(t)).length;
      const union = failingTokens.size + nameTokens.size - intersection;
      if (intersection > 0 && union > 0) {
        score += Math.round((intersection / union) * 25);
      }
    }
    // Position bonus: later elements in the ARIA tree are more likely to
    // be content than sidebar. Linear 0–10 ramp across all candidates.
    if (totalCandidates > 1) {
      score += Math.round((idx / (totalCandidates - 1)) * 10);
    }

    add(
      level != null
        ? {
            locator: `getByRole('${role}', { name: '${esc(name)}', level: ${level} })`,
            method: 'getByRole',
            args: { role, name, level },
            score,
          }
        : {
            locator: `getByRole('${role}', { name: '${esc(name)}' })`,
            method: 'getByRole',
            args: { role, name },
            score,
          },
    );

    // getByText for roles whose visible text `getByText` inspects
    if (TEXT_CONTENT_ROLES.has(role)) {
      add({
        locator: `getByText('${esc(name)}')`,
        method: 'getByText',
        args: { text: name },
        score: score - 5, // slightly below the role-based locator
      });
    }

    if (['textbox', 'combobox', 'searchbox'].includes(role)) {
      add({
        locator: `getByLabel('${esc(name)}')`,
        method: 'getByLabel',
        args: { label: name },
        score: score - 5,
      });
    }
  }

  if (alts.length === 0) return null;
  return alts.sort((a, b) => b.score - a.score).slice(0, 8);
}

/**
 * Extract the first meaningful string argument from a failing locator as
 * lowercase tokens for relevance comparison. For getByText/getByLabel/
 * getByPlaceholder/getByAltText getByTitle, this is the primary text argument.
 * For getByRole, it's the name option.
 */
function extractFailingText(locator: { method: string; args: Record<string, unknown> } | null): string | null {
  if (!locator) return null;
  const a = locator.args;
  const text = (a.text ?? a.label ?? a.placeholder ?? a.alt ?? a.title ?? a.name) as string | undefined;
  return text?.toLowerCase().trim() || null;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s\-_.:,;!?()[\]{}'"\\/]+/)
      .filter((t) => t.length > 0),
  );
}

/**
 * Assemble a result, computing the convention-preserving recommendation over
 * whichever alternative list is active. Element-match (fresh, current-page)
 * wins over prior-success (pre-captured), which wins over the ARIA fallback.
 * Kept in one place so every return path picks the recommendation the same way.
 */
/** Sources whose alternative scores are real stability scores from a pre-captured DOM snapshot. */
const STABILITY_SCORED_SOURCES = new Set<LocatorHealingResult['source']>(['prior-run', 'fingerprint', 'cross-test']);

function buildHealingResult(
  failingLocator: LocatorHealingResult['failingLocator'],
  fromPriorSuccess: RankedLocator[] | null,
  fromAriaSnapshot: RankedLocator[] | null,
  source: LocatorHealingResult['source'],
  fromElementMatch: RankedLocator[] | null = null,
  capturedAt: Date | null = null,
  opts: { recommendFrom?: RankedLocator[]; priorNameMayBeStale?: boolean } = {},
): LocatorHealingResult {
  const alternatives = fromElementMatch ?? fromPriorSuccess ?? fromAriaSnapshot ?? [];
  // The recommendation may be picked from a filtered pool (stale name-derived
  // entries excluded) while the full list stays visible. An empty pool means
  // nothing trustworthy remains — recommendation: null, never a stale pick.
  const pool = opts.recommendFrom ?? alternatives;
  const recommendation = pool.length ? recommendLocatorFix(failingLocator?.method, pool) : null;
  // "Everything is fragile — add a data-testid" only makes sense when the
  // scores are stability scores. ARIA-fallback scores measure text-overlap
  // relevance and element-match scores are a fixed band, so a low score there
  // says nothing about the element lacking stable hooks.
  if (recommendation && !STABILITY_SCORED_SOURCES.has(source)) {
    recommendation.suggestAddTestId = false;
  }
  return {
    failingLocator,
    fromPriorSuccess,
    fromElementMatch,
    fromAriaSnapshot,
    source,
    recommendation,
    capturedAt: capturedAt ? capturedAt.toISOString() : null,
    ...(opts.priorNameMayBeStale ? { priorNameMayBeStale: true } : {}),
  };
}

/**
 * The identity of the element a stored snapshot describes — its resolved ARIA
 * role and accessible name. The role/name were resolved against the real DOM at
 * capture time and baked into the stored `getByRole` alternative, so we read
 * them back from there instead of re-deriving a role server-side.
 */
function fingerprintFromSnapshot(priorAlts: RankedLocator[] | null, row: LocatorSnapshotRow): ElementFingerprint {
  const roleAlt = priorAlts?.find((a) => a.method === 'getByRole');
  let role = typeof roleAlt?.args?.role === 'string' ? roleAlt.args.role : null;
  // Fall back to the stored HTML element tag when no getByRole was captured
  // (common for getByText locators on <span>/<div>). Map semantic elements to
  // their implicit ARIA role so the renamed-element match stays scoped.
  if (!role && row.elementTag) {
    role = implicitRoleForTag(row.elementTag);
  }
  const name = typeof roleAlt?.args?.name === 'string' ? roleAlt.args.name : (row.elementText ?? null);

  // Structural identity — heading level and same-role position — narrows the
  // renamed-element match. Level: captured getByRole args, then the h1-h6 tag,
  // then a stored aria-level attribute. rolePosition: newer captures only.
  let attrs: Record<string, unknown> = {};
  try {
    attrs = JSON.parse(row.elementAttrs) as Record<string, unknown>;
  } catch {
    // Legacy/malformed attrs — the fingerprint stays role+name only.
  }
  let level = typeof roleAlt?.args?.level === 'number' ? roleAlt.args.level : null;
  if (level == null && row.elementTag) {
    const tagMatch = row.elementTag.match(/^h([1-6])$/i);
    if (tagMatch) level = Number(tagMatch[1]);
  }
  const ariaLevel = attrs['aria-level'];
  if (level == null && typeof ariaLevel === 'string' && /^\d+$/.test(ariaLevel)) {
    level = Number(ariaLevel);
  }
  const rp = attrs['rolePosition'] as { role?: unknown; count?: unknown; index?: unknown } | null | undefined;
  const rolePosition =
    rp && typeof rp.role === 'string' && typeof rp.count === 'number' && typeof rp.index === 'number'
      ? { role: rp.role, count: rp.count, index: rp.index }
      : null;

  return { role, name, level, rolePosition };
}

/**
 * Map HTML element tags to their implicit ARIA roles so the element-match
 * fingerprint retains role-based scoping even when the stored alternatives
 * had no getByRole entry (which happens for getByText locators on elements
 * without explicit role attributes).
 */
function implicitRoleForTag(tag: string): string | null {
  const MAP: Record<string, string> = {
    a: 'link',
    button: 'button',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
    img: 'img',
    input: 'textbox',
    textarea: 'textbox',
    select: 'combobox',
    nav: 'navigation',
    main: 'main',
    aside: 'complementary',
    header: 'banner',
    footer: 'contentinfo',
    form: 'form',
    table: 'table',
    ul: 'list',
    ol: 'list',
    li: 'listitem',
    section: 'region',
    article: 'article',
    dialog: 'dialog',
    label: 'label',
    figcaption: 'caption',
    legend: 'legend',
    td: 'cell',
    th: 'columnheader',
    tr: 'row',
    option: 'option',
    menuitem: 'menuitem',
  };
  return MAP[tag.toLowerCase()] ?? null;
}

/**
 * Given a stored snapshot found by location/signature, decide whether the
 * element still exists on the current page. If it was renamed/moved/replaced,
 * return fresh locators generated from the element it became (`element-match`);
 * otherwise the pre-captured alternatives still describe it (`prior-run` /
 * `fingerprint`).
 *
 * When the stored accessible name is provably gone from the failing page but
 * no rename match was confident (`no-match`), the name-derived alternatives —
 * including the failing locator itself, which capture legitimately recorded —
 * almost certainly no longer match. They stay visible for context, but the
 * recommendation is picked only from the survivors (structural/attribute
 * alternatives), and failure-page ARIA candidates ride along as a supplement.
 * A flaky failure on an unchanged page (`unchanged`) keeps the full pool: the
 * original locator is still the right one there.
 */
function resolveStoredHit(
  failingLocator: LocatorHealingResult['failingLocator'],
  hit: LocatorSnapshotRow,
  ariaSnapshot: string | null,
  priorSource: 'prior-run' | 'fingerprint' | 'cross-test',
): LocatorHealingResult {
  const priorAlts = parseAlternativesColumn(hit);
  const fingerprint = fingerprintFromSnapshot(priorAlts, hit);
  const outcome = elementMatchOutcome(fingerprint, ariaSnapshot);
  if (outcome.status === 'matched') {
    return buildHealingResult(failingLocator, null, null, 'element-match', outcome.fresh);
  }

  if (outcome.status === 'no-match' && fingerprint.name) {
    const staleName = fingerprint.name;
    const survivors = (priorAlts ?? []).filter(
      (a) =>
        !alternativeUsesName(a, staleName) &&
        !(failingLocator && locatorIdentityEquals(a.method, a.args, failingLocator.method, failingLocator.args)),
    );
    const supplement = generateFromAriaSnapshot(ariaSnapshot, failingLocator);
    return buildHealingResult(failingLocator, priorAlts, supplement, priorSource, null, hit.lastSeenAt ?? null, {
      recommendFrom: survivors,
      priorNameMayBeStale: true,
    });
  }

  return buildHealingResult(failingLocator, priorAlts, null, priorSource, null, hit.lastSeenAt ?? null);
}

/**
 * Find alternatives for a failing locator. Loads every snapshot for the test
 * case once (indexed by test_case_id) and resolves the best match in memory:
 *
 * 1. Call-site location — exact `file:line:col`, then `file:line` (tolerates a
 *    column drift). Disambiguates repeated identical locators by where they run.
 * 2. Locator signature — method + ordered string literals; survives line shifts
 *    but cannot tell apart repeated identical locators.
 * 3. ARIA fallback — generated from the current run's ARIA snapshot.
 */
export async function getLocatorHealing(db: DrizzleDB, testRunsCaseId: number): Promise<LocatorHealingResult> {
  // Load the failing row
  const rows = await db
    .select({
      error: testRunsCases.error,
      testCaseId: testRunsCases.testCaseId,
      ariaSnapshot: testRunsCases.ariaSnapshot,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, testRunsCaseId));

  const row = rows[0];
  if (!row?.error) {
    return buildHealingResult(null, null, null, 'none');
  }

  const error = row.error;
  const testCaseId = row.testCaseId;

  // Parse the failing locator from the error (for display + signature lookup).
  // Use the chain leaf — the innermost call identifies the resolved element and
  // is what the capture side recorded, so chained locators match too.
  const selector = extractLeafSelector(error);
  const parsedLocator = selector ? parseLocatorExpression(selector) : null;
  const failingLocator = parsedLocator ? { method: parsedLocator.method, args: parsedLocator.args } : null;
  const location = extractErrorLocation(error);

  // Load every snapshot for this test case once (indexed by test_case_id). A
  // case has only a handful of locators, so matching in memory is cheaper than
  // several round-trips and keeps the ladder logic in one place.
  const snaps = testCaseId
    ? await db.select().from(locatorSnapshots).where(eq(locatorSnapshots.testCaseId, testCaseId))
    : [];

  // Ladder 1: call-site location. Prefer an exact file:line:col match, then
  // fall back to file:line so a column drift between the runtime capture and
  // the error location still resolves. This is what disambiguates repeated
  // identical locators (e.g. two "Delete" buttons on different rows).
  if (location && snaps.length > 0) {
    const hit = snaps.find((s) => s.location === location) ?? snaps.find((s) => sameFileLine(s.location, location));
    if (hit) {
      return resolveStoredHit(failingLocator, hit, row.ariaSnapshot ?? null, 'prior-run');
    }
  }

  if (selector) {
    const sig = await locatorSignatureFromExpression(selector);
    const method = locatorExpressionMethod(selector);

    // Ladder 2: locator signature (method + ordered string literals) — survives
    // line shifts. Cannot tell apart repeated identical locators; returns the
    // first match.
    const hit = snaps.find((s) => s.usedArgsFp === sig && (!method || s.usedMethod === method));
    if (hit) {
      return resolveStoredHit(failingLocator, hit, row.ariaSnapshot ?? null, 'fingerprint');
    }

    // Ladder 2.5: cross-test — the same locator captured by another test in
    // the same project (assert-only locators are never captured by their own
    // test, but an action elsewhere frequently touches the same element).
    // Freshest capture wins.
    if (testCaseId) {
      const crossHit = await findCrossTestSnapshot(db, testCaseId, sig, method);
      if (crossHit) {
        return resolveStoredHit(failingLocator, crossHit, row.ariaSnapshot ?? null, 'cross-test');
      }
    }
  }

  // Ladder 3: ARIA snapshot fallback
  const ariaAlts = generateFromAriaSnapshot(row.ariaSnapshot ?? null, failingLocator);
  if (ariaAlts) {
    return buildHealingResult(failingLocator, null, ariaAlts, 'aria-snapshot');
  }

  return buildHealingResult(failingLocator, null, null, 'none');
}

/**
 * Find the freshest snapshot of the same locator signature captured by a
 * *different* test case in the same project — the cross-test healing ladder.
 * The project scope keeps suggestions on the same application; the signature
 * (method + ordered string literals) guarantees it is the same locator text.
 */
async function findCrossTestSnapshot(
  db: DrizzleDB,
  testCaseId: number,
  sig: string,
  method: string | null,
): Promise<LocatorSnapshotRow | null> {
  const rows = await db
    .select({ snap: locatorSnapshots })
    .from(locatorSnapshots)
    .innerJoin(testCases, eq(locatorSnapshots.testCaseId, testCases.id))
    .where(
      and(
        eq(testCases.projectId, sql`(select project_id from test_cases where id = ${testCaseId})`),
        eq(locatorSnapshots.usedArgsFp, sig),
        ne(locatorSnapshots.testCaseId, testCaseId),
        ...(method ? [eq(locatorSnapshots.usedMethod, method)] : []),
      ),
    )
    .orderBy(sql`${locatorSnapshots.lastSeenAt} desc`)
    .limit(1);
  return rows[0]?.snap ?? null;
}

/**
 * Batch variant: fetch locator healing for multiple test-run-case IDs in
 * two queries instead of N * 2. Used by the MCP `get_cluster` tool to avoid
 * N+1 overhead when attaching healing to affected cases.
 */
export async function getLocatorHealingBatch(
  db: DrizzleDB,
  testRunsCaseIds: number[],
): Promise<Map<number, LocatorHealingResult>> {
  const results = new Map<number, LocatorHealingResult>();
  if (testRunsCaseIds.length === 0) return results;

  // 1. Load all failing rows in one query
  const caseRows = await db
    .select({
      id: testRunsCases.id,
      error: testRunsCases.error,
      testCaseId: testRunsCases.testCaseId,
      ariaSnapshot: testRunsCases.ariaSnapshot,
    })
    .from(testRunsCases)
    .where(inArray(testRunsCases.id, testRunsCaseIds));

  // 2. Collect unique test case IDs and load all snapshots in one query
  const tcIds = [...new Set(caseRows.map((r) => r.testCaseId).filter(Boolean))];
  const allSnaps =
    tcIds.length > 0 ? await db.select().from(locatorSnapshots).where(inArray(locatorSnapshots.testCaseId, tcIds)) : [];

  // Bucket snapshots by testCaseId for fast lookup
  const snapsByTc = new Map<number, LocatorSnapshotRow[]>();
  for (const s of allSnaps) {
    const arr = snapsByTc.get(s.testCaseId);
    if (arr) arr.push(s);
    else snapsByTc.set(s.testCaseId, [s]);
  }

  // 3. Run the matching ladder for each case
  for (const row of caseRows) {
    if (!row.error) {
      results.set(row.id, buildHealingResult(null, null, null, 'none'));
      continue;
    }

    const error = row.error;
    const snaps = snapsByTc.get(row.testCaseId) ?? [];

    const selector = extractLeafSelector(error);
    const parsedLocator = selector ? parseLocatorExpression(selector) : null;
    const failingLocator = parsedLocator ? { method: parsedLocator.method, args: parsedLocator.args } : null;
    const location = extractErrorLocation(error);

    // Ladder 1: location
    if (location && snaps.length > 0) {
      const hit = snaps.find((s) => s.location === location) ?? snaps.find((s) => sameFileLine(s.location, location));
      if (hit) {
        results.set(row.id, resolveStoredHit(failingLocator, hit, row.ariaSnapshot ?? null, 'prior-run'));
        continue;
      }
    }

    // Ladder 2: signature; ladder 2.5: cross-test (same locator captured by
    // another test in the project)
    if (selector) {
      const sig = await locatorSignatureFromExpression(selector);
      const method = locatorExpressionMethod(selector);
      const hit = snaps.find((s) => s.usedArgsFp === sig && (!method || s.usedMethod === method));
      if (hit) {
        results.set(row.id, resolveStoredHit(failingLocator, hit, row.ariaSnapshot ?? null, 'fingerprint'));
        continue;
      }
      if (row.testCaseId) {
        const crossHit = await findCrossTestSnapshot(db, row.testCaseId, sig, method);
        if (crossHit) {
          results.set(row.id, resolveStoredHit(failingLocator, crossHit, row.ariaSnapshot ?? null, 'cross-test'));
          continue;
        }
      }
    }

    // Ladder 3: ARIA fallback
    const ariaAlts = generateFromAriaSnapshot(row.ariaSnapshot ?? null, failingLocator);
    if (ariaAlts) {
      results.set(row.id, buildHealingResult(failingLocator, null, ariaAlts, 'aria-snapshot'));
      continue;
    }

    results.set(row.id, buildHealingResult(failingLocator, null, null, 'none'));
  }

  return results;
}

/**
 * Compare two `file:line:col` locations ignoring the trailing column. The file
 * parts match on a path suffix at a `/` boundary, so the stored cwd-relative
 * capture location (`tests/x.spec.ts`) still matches an absolute path from an
 * error stack frame (`/repo/tests/x.spec.ts`).
 */
function sameFileLine(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const [fileA, lineA] = splitFileLine(a);
  const [fileB, lineB] = splitFileLine(b);
  if (lineA !== lineB || !fileA || !fileB) return false;
  if (fileA === fileB) return true;
  return fileA.endsWith(`/${fileB}`) || fileB.endsWith(`/${fileA}`);
}

/** Split `file:line:col` into `[file, line]`, dropping the column. */
function splitFileLine(loc: string): [string, string] {
  const m = loc.match(/^(.*):(\d+):\d+$/) ?? loc.match(/^(.*):(\d+)$/);
  return m ? [m[1]!, m[2]!] : [loc, ''];
}

function parseAlternativesColumn(row: LocatorSnapshotRow): RankedLocator[] | null {
  try {
    return JSON.parse(row.alternatives) as RankedLocator[];
  } catch {
    return null;
  }
}

/**
 * Upsert locator snapshots for a batch of test cases, then purge rows for
 * locations no longer exercised. Shared by the server ingest path
 * (persist-run-cases) and the demo ingest mirror so the storage logic lives in
 * one place.
 *
 * Every location seen this run is preserved — including failed actions whose
 * placeholder carries a location but no element — so a locator that failed this
 * run keeps its prior-success row for the healing lookup.
 *
 * Stale-location purge is gated on each case's `purge` flag (set when its run
 * completed, i.e. passed): a failed/timed-out run can stop before later locators
 * execute, and those unreached locations must NOT be mistaken for "removed from
 * the test" and deleted. Rows are also deduped by (caseId, location) before the
 * upsert — the same call site acted on twice (a loop, or a page-object method
 * called more than once) captures one location repeatedly, and a single
 * multi-row `ON CONFLICT DO UPDATE` that targets the same key twice is rejected
 * by PostgreSQL ("cannot affect row a second time"); the latest capture wins.
 */
export async function upsertLocatorSnapshots(
  db: DrizzleDB,
  perCase: Array<{ caseId: number; snapshots: LocatorSnapshot[] | null | undefined; purge?: boolean }>,
  runId: number,
): Promise<void> {
  // Keyed by `${caseId}\x00${location}` so a repeated call site yields one row.
  const rowByKey = new Map<string, typeof locatorSnapshots.$inferInsert>();
  const seenByCase = new Map<number, Set<string>>();
  // Cases whose run completed (passed) — only these may purge stale locations.
  const purgeableCases = new Set<number>();

  for (const { caseId, snapshots, purge } of perCase) {
    // Tolerate a malformed/non-array payload field without failing run ingest.
    if (!Array.isArray(snapshots) || snapshots.length === 0) continue;

    const seen = seenByCase.get(caseId) ?? new Set<string>();
    for (const snap of snapshots) {
      if (snap.location) seen.add(snap.location);
    }
    if (seen.size > 0) seenByCase.set(caseId, seen);
    if (purge) purgeableCases.add(caseId);

    const captured = snapshots.filter((s) => s.element && s.location);
    const fps = await Promise.all(captured.map((s) => locatorSignature(s.used.method, s.used.args)));
    captured.forEach((snap, idx) => {
      rowByKey.set(`${caseId}\x00${snap.location}`, {
        testCaseId: caseId,
        location: snap.location!,
        usedMethod: snap.used.method,
        usedArgs: JSON.stringify(snap.used.args),
        usedArgsFp: fps[idx]!,
        elementTag: snap.element!.tagName,
        // rolePosition/ancestors must be folded in explicitly — this object is
        // the storage whitelist, so anything omitted here is silently dropped.
        elementAttrs: JSON.stringify({
          ...snap.element!.attributes,
          accessibleName: snap.element!.accessibleName,
          center: snap.element!.center,
          ...(snap.element!.rolePosition ? { rolePosition: snap.element!.rolePosition } : {}),
          ...(snap.element!.ancestors?.length ? { ancestors: snap.element!.ancestors } : {}),
        }),
        elementText: snap.element!.textContent,
        alternatives: JSON.stringify(snap.alternatives.slice(0, 10)),
        lastSeenRunId: runId,
        lastSeenAt: new Date(),
      });
    });
  }

  const rows = [...rowByKey.values()];
  if (rows.length > 0) {
    await db
      .insert(locatorSnapshots)
      .values(rows)
      .onConflictDoUpdate({
        target: [locatorSnapshots.testCaseId, locatorSnapshots.location],
        set: {
          usedMethod: sql`excluded.used_method`,
          usedArgs: sql`excluded.used_args`,
          usedArgsFp: sql`excluded.used_args_fp`,
          elementTag: sql`excluded.element_tag`,
          elementAttrs: sql`excluded.element_attrs`,
          elementText: sql`excluded.element_text`,
          alternatives: sql`excluded.alternatives`,
          lastSeenRunId: sql`excluded.last_seen_run_id`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
  }

  // Purge locations no longer exercised (locator removed/moved in the test) —
  // only for cases whose run completed, so a run that failed before reaching a
  // locator doesn't delete that locator's still-valid prior-success row.
  for (const [caseId, locs] of seenByCase) {
    if (!purgeableCases.has(caseId)) continue;
    await db
      .delete(locatorSnapshots)
      .where(and(eq(locatorSnapshots.testCaseId, caseId), notInArray(locatorSnapshots.location, [...locs])));
  }
}

/** Input for saving a user-confirmed pick from the dashboard's DOM-snapshot picker. */
export interface LocatorPickInput {
  /**
   * The failing locator as the healing panel displayed it — identity fallback
   * for the rare error whose stored text can't be re-parsed server-side.
   */
  failingLocator?: { method: string; args: Record<string, unknown> } | null;
  /** The alternative the user confirmed. */
  pickedLocator: RankedLocator;
  /** The picked element as probed inside the rendered DOM snapshot. */
  element?: Partial<ElementAttributes> | null;
}

export type LocatorPickSaveResult =
  | { status: 'ok'; associatedBy: 'location' | 'fingerprint' | 'new-call-site' }
  | { status: 'not-found' }
  | { status: 'not-persisted'; reason: 'no-identity' };

/**
 * Persist a user-confirmed locator pick against the failing call site so the
 * healing lookup surfaces it (`pickedByUser` wins the recommendation). Shared
 * by the `locator-pick` endpoint and the demo mirror.
 *
 * The failing locator's identity — call-site location and signature — is
 * re-derived from the stored error with the same helpers `getLocatorHealing`
 * uses, so the saved row is guaranteed to be found by the same ladder (location
 * first, then `usedArgsFp`). The client-provided `failingLocator` is only a
 * fallback when the error can't be re-parsed.
 *
 * An existing snapshot row keeps its captured element data (richer than the
 * snapshot-probe's) — the pick is merged to the front of `alternatives`. When
 * no row exists (the locator never passed), a new row is created from the pick;
 * `elementAttrs` follows the same storage-whitelist shape as
 * `upsertLocatorSnapshots`. Never silently drops a pick: when there is nothing
 * to key it on, the caller gets `not-persisted` to surface.
 */
export async function saveLocatorPick(
  db: DrizzleDB,
  testRunsCaseId: number,
  input: LocatorPickInput,
): Promise<LocatorPickSaveResult> {
  const rows = await db
    .select({ testCaseId: testRunsCases.testCaseId, error: testRunsCases.error })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, testRunsCaseId));
  const row = rows[0];
  if (!row) return { status: 'not-found' };
  if (!row.testCaseId) return { status: 'not-persisted', reason: 'no-identity' };

  // Same identity derivation as getLocatorHealing, so save and lookup agree.
  const error = row.error ?? '';
  const location = error ? extractErrorLocation(error) : null;
  const selector = error ? extractLeafSelector(error) : null;
  const method = (selector ? locatorExpressionMethod(selector) : null) ?? input.failingLocator?.method ?? null;
  const sig = selector
    ? await locatorSignatureFromExpression(selector)
    : input.failingLocator
      ? await locatorSignature(input.failingLocator.method, Object.values(input.failingLocator.args ?? {}))
      : null;
  if (!location && !sig) return { status: 'not-persisted', reason: 'no-identity' };

  const pick: RankedLocator = { ...input.pickedLocator, pickedByUser: true };
  const mergePick = (existing: RankedLocator[] | null): string =>
    JSON.stringify([pick, ...(existing ?? []).filter((a) => a.locator !== pick.locator)].slice(0, 10));

  const snaps = await db.select().from(locatorSnapshots).where(eq(locatorSnapshots.testCaseId, row.testCaseId));

  let associatedBy: 'location' | 'fingerprint' = 'location';
  let hit = location
    ? (snaps.find((s) => s.location === location) ?? snaps.find((s) => sameFileLine(s.location, location)))
    : undefined;
  if (!hit && sig) {
    hit = snaps.find((s) => s.usedArgsFp === sig && (!method || s.usedMethod === method));
    if (hit) associatedBy = 'fingerprint';
  }

  if (hit) {
    await db
      .update(locatorSnapshots)
      .set({ alternatives: mergePick(parseAlternativesColumn(hit)), lastSeenAt: new Date() })
      .where(eq(locatorSnapshots.id, hit.id));
    return { status: 'ok', associatedBy };
  }

  // No stored snapshot for this call site (the locator never passed) — create
  // one from the pick so the ladder finds it: by location when the error had
  // one, else by signature (the synthetic location only serves the unique key).
  const parsed = selector ? parseLocatorExpression(selector) : null;
  const el = input.element;
  await db
    .insert(locatorSnapshots)
    .values({
      testCaseId: row.testCaseId,
      location: location ?? `pick:${sig}`,
      usedMethod: method ?? pick.method,
      usedArgs: JSON.stringify(parsed?.args ?? input.failingLocator?.args ?? {}),
      usedArgsFp: sig ?? (await locatorSignature(method ?? pick.method, [])),
      elementTag: el?.tagName ?? 'unknown',
      // Same storage whitelist as upsertLocatorSnapshots — anything not folded
      // in here is dropped.
      elementAttrs: JSON.stringify({
        ...(el?.attributes ?? {}),
        accessibleName: el?.accessibleName ?? null,
        center: el?.center ?? null,
      }),
      elementText: el?.textContent ?? null,
      alternatives: JSON.stringify([pick]),
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [locatorSnapshots.testCaseId, locatorSnapshots.location],
      set: { alternatives: sql`excluded.alternatives`, lastSeenAt: sql`excluded.last_seen_at` },
    });
  return { status: 'ok', associatedBy: 'new-call-site' };
}
