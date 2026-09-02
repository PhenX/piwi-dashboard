import { domRoleOf, type DomRoleMaps } from '@piwitests/picker-dom';
import { scoreTargetMatch, type TestFunctionEntry, type FunctionPatternTarget } from '@piwitests/core/function-match';
import type { StepAction } from '@piwitests/core/recording';

export interface FunctionTestStepResult {
  stepIndex: number;
  action: StepAction;
  matchCount: number;
  verdict: 'unique' | 'ambiguous' | 'missing';
}

export interface FunctionTestResult {
  entry: TestFunctionEntry;
  steps: FunctionTestStepResult[];
  /** "ready" — every step resolves to exactly one element right now. "partial" — some steps match, at least one doesn't or is ambiguous. "not-found" — nothing in the pattern matches this page at all. */
  verdict: 'ready' | 'partial' | 'not-found';
}

/**
 * "Try it": scores every catalog function's DOM pattern against the *live*
 * page, with no recording/replay needed — for each pattern step, counts how
 * many current elements satisfy its target and reports unique/ambiguous/missing,
 * then rolls that up into one verdict per function. Reuses `scoreTargetMatch`
 * (the same rule `rankFunctionMatches` scores a recorded step against) so a
 * function marked "ready" here is scored the same way it would be mid-recording.
 *
 * Every helper is nested here rather than a module-level sibling, mirroring
 * `multi-pick-derive.ts`: this gets re-serialized via
 * `Function.prototype.toString()` in tests (installing `domRoleOf` and
 * `scoreTargetMatch` as globals first), which only ever carries a function's
 * own source text.
 */
export function testCatalogAgainstPage(catalog: TestFunctionEntry[], maps: DomRoleMaps): FunctionTestResult[] {
  const ROLE_CANDIDATES = [...new Set(['[role]', 'input', 'select', ...Object.keys(maps.tagRoles)])].join(',');

  function normalize(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }

  /**
   * Mirrors core's `approximateAccessibleName` — aria-label, then text, then
   * title, then placeholder. Inlined rather than imported because this function
   * is re-serialized via `Function.prototype.toString()` (see the note above),
   * the same reason `probe.ts` keeps its own copy. Reading only `aria-label`
   * here meant a step scored one way in "Try it" and another way during a real
   * recording, against the claim that both use one rule.
   */
  function accessibleNameOf(el: Element): string | null {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    const text = normalize(el.textContent || '');
    if (text) return text;
    return el.getAttribute('title') || el.getAttribute('placeholder') || null;
  }

  function elementCandidate(el: Element): {
    role: string | null;
    testId: string | null;
    accessibleName: string | null;
    text: string | null;
  } {
    return {
      role: domRoleOf(el, maps),
      testId: el.getAttribute('data-testid'),
      accessibleName: accessibleNameOf(el),
      text: normalize(el.textContent || ''),
    };
  }

  // A confident match, not just "better than nothing" — mirrors the
  // threshold `matchFunctionAt` effectively requires via its "complete
  // match" gate, so a step reported "unique" here would actually pair
  // during a real recording too.
  const MATCH_THRESHOLD = 0.6;

  function countMatches(target: FunctionPatternTarget): number {
    const pool = target.testId
      ? [...document.querySelectorAll('[data-testid]')]
      : [...document.querySelectorAll(ROLE_CANDIDATES)];
    // A target naming nothing at all describes every element, which is
    // "ambiguous", not "missing" — and scoring it would say missing, since an
    // unconstrained pattern scores below the confidence threshold everywhere.
    if (!target.testId && !target.role && !target.name) return pool.length;
    return pool.filter((el) => scoreTargetMatch(target, elementCandidate(el)) >= MATCH_THRESHOLD).length;
  }

  return catalog.map((entry) => {
    const steps: FunctionTestStepResult[] = entry.steps.map((step, i) => {
      const matchCount = countMatches(step.target);
      const verdict: FunctionTestStepResult['verdict'] =
        matchCount === 0 ? 'missing' : matchCount === 1 ? 'unique' : 'ambiguous';
      return { stepIndex: i, action: step.action, matchCount, verdict };
    });

    const verdict: FunctionTestResult['verdict'] = steps.every((s) => s.verdict === 'unique')
      ? 'ready'
      : steps.some((s) => s.verdict !== 'missing')
        ? 'partial'
        : 'not-found';

    return { entry, steps, verdict };
  });
}
