/**
 * Renders a `RecordedSession` as a runnable Playwright TypeScript spec.
 *
 * Two modes, one function: with no catalog, every step becomes a raw
 * `page.*` line (the extension's fully offline path — works with no Piwi
 * connection at all). With a catalog, `matchFunctionAt` (see
 * `function-match.ts`) greedily collapses a *contiguous* run of steps that
 * matches a function's whole pattern into a call against the project's own
 * page-object methods/helpers, leaving anything unmatched as raw lines — never
 * a partial or guessed call, and never a call that quietly swallows a step it
 * does not perform.
 */
import type { RecordedSession, RecordedStep } from './recording';
import { matchFunctionAt, type TestFunctionEntry, type RankedFunctionMatch } from './function-match';

export interface CodegenOptions {
  /** Test title; defaults to a generic placeholder the user is expected to rename. */
  title?: string;
  /** When set, complete pattern matches against these entries collapse into function calls. */
  catalog?: TestFunctionEntry[];
}

export interface CodegenResult {
  code: string;
  /** One entry per emitted line that came from a function match, keyed by the matched steps' first index — lets a UI highlight which recorded steps a given call represents. */
  matchedSpans: Array<{ startStep: number; endStep: number; functionName: string }>;
}

/**
 * A line terminator inside a single-quoted literal is a syntax error, not a
 * newline — and a recorded value reaches codegen unnormalized (`normalizeSteps`
 * collapses whitespace on a target's *text*, never on the value the user typed),
 * so one multi-line paste into a textarea used to be enough to make the whole
 * exported spec unparseable.
 */
const QUOTE_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

function quote(s: string): string {
  return `'${s.replace(/[\\'\n\r\u2028\u2029]/g, (c) => QUOTE_ESCAPES[c]!)}'`;
}

/** The best-ranked locator for a step's target, or a comment placeholder when the step captured no element. */
function locatorExpr(step: RecordedStep): string {
  const best = step.target?.alternatives[0]?.locator;
  return best ?? `locator(${quote('/* no locator captured */')})`;
}

function renderRawStep(step: RecordedStep, index: number): string {
  const loc = `page.${locatorExpr(step)}`;
  switch (step.action) {
    case 'goto':
      return `  await page.goto(${quote(step.value ?? step.pageUrl)});`;
    case 'click':
      return `  await ${loc}.click();`;
    case 'fill': {
      if (step.redacted) {
        const envVar = `PIWI_TEST_VALUE_${index}`;
        return `  await ${loc}.fill(process.env.${envVar} ?? '');`;
      }
      return `  await ${loc}.fill(${quote(step.value ?? '')});`;
    }
    case 'check':
      return `  await ${loc}.check();`;
    case 'uncheck':
      return `  await ${loc}.uncheck();`;
    case 'selectOption':
      return `  await ${loc}.selectOption(${quote(step.value ?? '')});`;
    case 'press':
      return step.target
        ? `  await ${loc}.press(${quote(step.value ?? 'Enter')});`
        : `  await page.keyboard.press(${quote(step.value ?? 'Enter')});`;
    case 'assertVisible':
      return `  await expect(${loc}).toBeVisible();`;
  }
}

/** A bare identifier can be an object key as-is; anything else has to be quoted. */
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * An `object` param renders as a literal built from whichever of its `fields`
 * resolved — unresolved fields are *omitted* rather than emitted empty, since
 * an options bag's fields are typically optional and a missing key type-checks
 * where `label: ''` would silently target nothing.
 */
function objectArgExpr(param: TestFunctionEntry['params'][number], match: RankedFunctionMatch): string {
  const entries = (param.fields ?? [])
    .map((field) => {
      const raw = match.args[`${param.name}.${field}`];
      return raw == null ? null : `${IDENTIFIER_RE.test(field) ? field : quote(field)}: ${quote(raw)}`;
    })
    .filter((pair): pair is string => pair != null);
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
}

function argExpr(entry: TestFunctionEntry, match: RankedFunctionMatch): string {
  return entry.params
    .map((p) => {
      if (p.type === 'object') return objectArgExpr(p, match);
      const raw = match.args[p.name];
      if (raw == null) return p.type === 'number' ? '0' : p.type === 'boolean' ? 'false' : "''";
      if (p.type === 'number') return String(Number(raw) || 0);
      if (p.type === 'boolean') return String(raw === 'true' || raw === '1');
      return quote(raw);
    })
    .join(', ');
}

function renderFunctionCall(match: RankedFunctionMatch): string {
  const { entry } = match;
  const args = argExpr(entry, match);
  if (entry.kind === 'page-object-method' && entry.receiver) {
    return `  await ${entry.receiver}.${entry.name}(${args});`;
  }
  return `  await ${entry.name}(page${args ? `, ${args}` : ''});`;
}

/** One `import` + (for page-object methods) one instantiation line per receiver actually used, deduped, in first-use order. */
function renderImports(usedEntries: TestFunctionEntry[]): string[] {
  const lines: string[] = [];
  const seenModules = new Set<string>();
  const seenReceivers = new Set<string>();
  for (const entry of usedEntries) {
    if (entry.kind === 'page-object-method' && entry.receiver && entry.importName) {
      const moduleKey = `${entry.module}#${entry.importName}`;
      if (!seenModules.has(moduleKey)) {
        seenModules.add(moduleKey);
        lines.push(`import { ${entry.importName} } from ${quote(entry.module)};`);
      }
      if (!seenReceivers.has(entry.receiver)) {
        seenReceivers.add(entry.receiver);
      }
    } else if (!seenModules.has(entry.module + entry.name)) {
      seenModules.add(entry.module + entry.name);
      lines.push(`import { ${entry.name} } from ${quote(entry.module)};`);
    }
  }
  return lines;
}

function renderInstantiations(usedEntries: TestFunctionEntry[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of usedEntries) {
    if (entry.kind !== 'page-object-method' || !entry.receiver || !entry.importName) continue;
    if (seen.has(entry.receiver)) continue;
    seen.add(entry.receiver);
    lines.push(`  const ${entry.receiver} = new ${entry.importName}(page);`);
  }
  return lines;
}

export function renderSpec(session: RecordedSession, options: CodegenOptions = {}): CodegenResult {
  const { steps } = session;
  const title = options.title ?? 'recorded flow';
  const catalog = options.catalog ?? [];

  const bodyLines: string[] = [];
  const matchedSpans: CodegenResult['matchedSpans'] = [];
  const usedEntries: TestFunctionEntry[] = [];

  let pos = 0;
  let sawGoto = false;
  while (pos < steps.length) {
    const step = steps[pos]!;

    if (step.action === 'goto') {
      bodyLines.push(renderRawStep(step, pos));
      sawGoto = true;
      pos++;
      continue;
    }

    const match = catalog.length > 0 ? matchFunctionAt(steps, pos, catalog) : null;
    if (match) {
      bodyLines.push(renderFunctionCall(match));
      usedEntries.push(match.entry);
      const last = Math.max(...match.matchedIndices);
      matchedSpans.push({ startStep: pos, endStep: last, functionName: match.entry.name });
      pos = last + 1;
      continue;
    }

    bodyLines.push(renderRawStep(step, pos));
    pos++;
  }

  if (!sawGoto && session.startUrl) {
    bodyLines.unshift(`  await page.goto(${quote(session.startUrl)});`);
  }

  const importLines = renderImports(usedEntries);
  const instantiationLines = renderInstantiations(usedEntries);

  const lines = [
    // Package name interpolated rather than adjoining the preceding keyword
    // directly, so this generated-code line does not itself look like a real
    // import to the boundary test in tests/boundary.test.ts.
    `import { test, expect } from ${quote('@playwright/test')};`,
    ...importLines,
    ``,
    `test(${quote(title)}, async ({ page }) => {`,
    ...instantiationLines,
    ...bodyLines,
    `});`,
    ``,
  ];

  return { code: lines.join('\n'), matchedSpans };
}
