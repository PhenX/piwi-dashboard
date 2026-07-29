/**
 * Matches a recorded step sequence against a project's catalog of known test
 * functions (page-object methods / helpers), ranked by how well each
 * function's own DOM pattern covers the most recent steps.
 *
 * Two callers, one algorithm: the extension calls `rankFunctionMatches` on
 * every captured step to show live-ranked candidates while recording, and
 * `codegen.ts` calls it again over the whole finished session to decide
 * which spans of steps collapse into a function call. Pure and
 * deterministic on purpose — an optional AI pass may choose *among* the
 * matches this returns, but never invents a match of its own (see
 * `ROADMAP.md`'s grounded-diagnosis precedent for why).
 */
import type { RecordedStep, StepAction } from './recording';

export interface FunctionParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
}

/** The DOM shape one pattern step expects — matched loosely against a recorded step's own target. */
export interface FunctionPatternTarget {
  role?: string | null;
  /** Matched as a case-insensitive substring against the recorded target's accessible name/text, either direction. */
  name?: string | null;
  testId?: string | null;
}

export interface FunctionPatternStep {
  action: StepAction;
  target: FunctionPatternTarget;
}

/** Where one function parameter's value is read from a matched pattern step, at extraction time. */
export interface FunctionParamSource {
  param: string;
  /** Index into this entry's own `steps` array. */
  stepIndex: number;
  from: 'text' | 'value' | 'testId';
}

export interface TestFunctionEntry {
  id: number;
  name: string;
  kind: 'page-object-method' | 'helper' | 'fixture';
  module: string;
  /** Receiver variable name for `page-object-method` (e.g. `cartPage`); null for `helper`/`fixture`. */
  receiver: string | null;
  /** Class name to import and instantiate for `page-object-method`; ignored otherwise. */
  importName: string | null;
  params: FunctionParam[];
  /** Glob (`**`/`*`) matched against a step's `pageUrl`; null matches any page. */
  urlPattern: string | null;
  /** The ordered DOM pattern this function drives — what codegen looks for in the recording. */
  steps: FunctionPatternStep[];
  paramSources: FunctionParamSource[];
}

export interface RankedFunctionMatch {
  entry: TestFunctionEntry;
  /** 0-1, coverage × average per-step match quality. */
  score: number;
  /** Indices into the *window* passed to `rankFunctionMatches`, in pattern order, one per matched pattern step. */
  matchedIndices: number[];
  /** True when every pattern step found a match — only `complete` matches are safe to substitute into codegen. */
  complete: boolean;
  /** Parameter values resolved from the matched steps; a param missing here couldn't be resolved. */
  args: Record<string, string>;
}

/** Splits on the literal `**` separator first so escaping/single-`*` handling never needs an intermediate placeholder character to tell a glob `**` apart from a literal `*`. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

function urlMatches(pattern: string | null, url: string): boolean {
  if (!pattern) return true;
  try {
    return globToRegExp(pattern).test(url);
  } catch {
    return true;
  }
}

/** The bits of an element (recorded or live) a pattern target is scored against — deliberately narrower than `RecordedTarget` so a live-DOM scan (no locator alternatives, no tag name) can build one just as easily as a recording can. */
export interface MatchCandidate {
  role: string | null;
  testId: string | null;
  accessibleName: string | null;
  text: string | null;
}

/**
 * How well one pattern step's target describes one candidate element, in
 * [0, 1]; 0 means "not a match". Shared by `stepPairScore` (recorded steps,
 * via `RecordedStep.target`) and any live-DOM "does this function's pattern
 * exist on this page" scan (e.g. the extension's try-it check) — one rule,
 * not two copies that could drift.
 */
export function scoreTargetMatch(pattern: FunctionPatternTarget, candidate: MatchCandidate | null): number {
  if (!candidate) return pattern.role || pattern.testId || pattern.name ? 0 : 0.3;

  if (pattern.testId) {
    return candidate.testId && candidate.testId.toLowerCase() === pattern.testId.toLowerCase() ? 1 : 0;
  }

  const roleMatches =
    !pattern.role || (candidate.role != null && candidate.role.toLowerCase() === pattern.role.toLowerCase());
  if (!roleMatches) return 0;

  if (pattern.name) {
    const needle = pattern.name.toLowerCase();
    const haystack = `${candidate.accessibleName ?? ''} ${candidate.text ?? ''}`.toLowerCase().trim();
    const nameMatches = haystack.length > 0 && (haystack.includes(needle) || needle.includes(haystack));
    if (!nameMatches) return pattern.role ? 0.35 : 0;
    return pattern.role ? 0.95 : 0.6;
  }

  return pattern.role ? 0.7 : 0.3;
}

/** Whether a pattern step's action matches a recorded step's action closely enough to consider pairing them. */
function actionCompatible(patternAction: StepAction, recordedAction: StepAction): boolean {
  if (patternAction === recordedAction) return true;
  // click/press are close enough in intent (Enter often replaces a submit-button click) to allow a lower-scored pairing.
  return (
    (patternAction === 'click' && recordedAction === 'press') ||
    (patternAction === 'press' && recordedAction === 'click')
  );
}

function stepPairScore(pattern: FunctionPatternStep, recorded: RecordedStep): number {
  if (!actionCompatible(pattern.action, recorded.action)) return 0;
  const base = scoreTargetMatch(pattern.target, recorded.target);
  return pattern.action === recorded.action ? base : base * 0.6;
}

/**
 * Best in-order (non-decreasing on both sides), non-repeating alignment of
 * `pattern` against `window` — classic weighted longest-common-subsequence
 * DP, but scored by match quality instead of counted. `dp[i][j]` = best
 * cumulative score aligning the first `i` window steps against the first `j`
 * pattern steps.
 */
function bestAlignment(
  window: RecordedStep[],
  pattern: FunctionPatternStep[],
): { total: number; matchedCount: number; pairs: Array<[number, number]> } {
  const n = window.length;
  const m = pattern.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  const from: Array<Array<'diag' | 'up' | 'left'>> = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 'up' as const),
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const pairScore = stepPairScore(pattern[j - 1]!, window[i - 1]!);
      const diag = pairScore > 0 ? dp[i - 1]![j - 1]! + pairScore : -Infinity;
      const up = dp[i - 1]![j]!;
      const left = dp[i]![j - 1]!;
      const best = Math.max(diag, up, left);
      dp[i]![j] = best;
      from[i]![j] = best === diag ? 'diag' : best === up ? 'up' : 'left';
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const dir = from[i]![j]!;
    if (dir === 'diag') {
      pairs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dir === 'up') {
      i--;
    } else {
      j--;
    }
  }

  return { total: dp[n]![m]!, matchedCount: pairs.length, pairs };
}

function extractArgs(
  entry: TestFunctionEntry,
  window: RecordedStep[],
  pairs: Array<[number, number]>,
): Record<string, string> {
  const args: Record<string, string> = {};
  const byPatternIndex = new Map(pairs.map(([windowIdx, patternIdx]) => [patternIdx, windowIdx]));
  for (const source of entry.paramSources) {
    const windowIdx = byPatternIndex.get(source.stepIndex);
    if (windowIdx == null) continue;
    const step = window[windowIdx]!;
    const value =
      source.from === 'value'
        ? step.value
        : source.from === 'testId'
          ? (step.target?.testId ?? null)
          : (step.target?.text ?? null);
    if (value != null) args[source.param] = value;
  }
  return args;
}

/**
 * Ranks every catalog entry against a trailing window of `steps`, best
 * first. `windowSize` bounds how far back a pattern is allowed to reach —
 * defaults to `max(3x the longest pattern, 8)` steps so live calls (small,
 * frequent) stay cheap without truncating a legitimate longer function.
 * Entries scoring 0 (no pattern step matched at all, or `urlPattern`
 * doesn't match the window's most recent step) are omitted.
 */
export function rankFunctionMatches(
  steps: RecordedStep[],
  catalog: TestFunctionEntry[],
  opts?: { windowSize?: number },
): RankedFunctionMatch[] {
  if (steps.length === 0 || catalog.length === 0) return [];
  const lastStep = steps[steps.length - 1]!;

  const results: RankedFunctionMatch[] = [];
  for (const entry of catalog) {
    if (entry.steps.length === 0) continue;
    if (!urlMatches(entry.urlPattern, lastStep.pageUrl)) continue;

    const windowSize = opts?.windowSize ?? Math.max(entry.steps.length * 3, 8);
    const window = steps.slice(-windowSize);

    const { total, matchedCount, pairs } = bestAlignment(window, entry.steps);
    if (matchedCount === 0) continue;

    const coverage = matchedCount / entry.steps.length;
    const avgQuality = total / matchedCount;
    const score = coverage * avgQuality;
    if (score <= 0) continue;

    results.push({
      entry,
      score,
      matchedIndices: pairs.map(([windowIdx]) => windowIdx + (steps.length - window.length)),
      complete: matchedCount === entry.steps.length,
      args: extractArgs(entry, window, pairs),
    });
  }

  return results.sort((a, b) => b.score - a.score || Number(b.complete) - Number(a.complete));
}

/**
 * Finds the best *complete* catalog match that starts exactly at `steps[startIndex]`
 * — i.e. the matched pattern's first step pairs with `steps[startIndex]` itself, so a
 * caller (codegen's cover pass) can collapse a contiguous-enough span into one call
 * and advance past it with nothing left unaccounted for in between. Returns null when
 * no entry's first pattern step matches there, or no candidate completes.
 */
export function matchFunctionAt(
  steps: RecordedStep[],
  startIndex: number,
  catalog: TestFunctionEntry[],
  opts?: { windowSize?: number },
): RankedFunctionMatch | null {
  const anchor = steps[startIndex];
  if (!anchor) return null;

  let best: RankedFunctionMatch | null = null;
  for (const entry of catalog) {
    const firstPattern = entry.steps[0];
    if (!firstPattern || stepPairScore(firstPattern, anchor) <= 0) continue;
    if (!urlMatches(entry.urlPattern, anchor.pageUrl)) continue;

    const windowSize = opts?.windowSize ?? Math.max(entry.steps.length * 3, 8);
    const window = steps.slice(startIndex, startIndex + windowSize);
    const { total, matchedCount, pairs } = bestAlignment(window, entry.steps);
    if (matchedCount !== entry.steps.length) continue; // codegen only substitutes complete matches
    if (pairs[0]?.[0] !== 0) continue; // must genuinely start at the anchor, not a few steps in

    const score = total / matchedCount;
    const match: RankedFunctionMatch = {
      entry,
      score,
      matchedIndices: pairs.map(([windowIdx]) => windowIdx + startIndex),
      complete: true,
      args: extractArgs(entry, window, pairs),
    };
    if (!best || match.score > best.score) best = match;
  }
  return best;
}
