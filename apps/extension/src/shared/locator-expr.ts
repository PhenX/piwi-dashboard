/**
 * A safe-subset parser for Playwright locator expressions — no `eval`, no
 * `Function` construction from user input. Supports exactly the chain shapes
 * the rest of this extension emits and reads back: `getBy*` leaf calls,
 * `locator(css)`, and the narrowing chain methods `filter({ hasText })`,
 * `first()`, `last()`, `nth(n)`.
 */

export type LocatorCall =
  | { method: 'getByRole'; role: string; name?: string; exact?: boolean; level?: number }
  | {
      method: 'getByTestId' | 'getByText' | 'getByLabel' | 'getByPlaceholder' | 'getByAltText' | 'getByTitle';
      text: string;
      exact?: boolean;
    }
  | { method: 'locator'; selector: string }
  | { method: 'filter'; hasText?: string; hasNotText?: string }
  | { method: 'first' | 'last' }
  | { method: 'nth'; index: number };

export interface ParsedLocatorChain {
  calls: LocatorCall[];
}

const LEAF_METHODS = new Set([
  'getByRole',
  'getByTestId',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'locator',
]);
const NARROWING_METHODS = new Set(['filter', 'first', 'last', 'nth']);

function endOfString(s: string, start: number): number {
  const quote = s[start];
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === quote) return i;
  }
  throw new Error('unterminated string');
}

function matchParen(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') {
      i = endOfString(s, i);
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw new Error('unmatched (');
}

function parseString(s: string): string {
  const q = s[0];
  if (q !== "'" && q !== '"' && q !== '`') throw new Error('expected a string literal');
  return s.slice(1, -1).replace(/\\(.)/g, '$1');
}

function parseObjectLiteral(s: string): Record<string, string | number | boolean> {
  const trimmed = s.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) throw new Error('expected an object literal');
  const body = trimmed.slice(1, -1);
  const out: Record<string, string | number | boolean> = {};
  const re = /(\w+)\s*:\s*('(?:\\.|[^'])*'|"(?:\\.|[^"])*"|true|false|-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const key = m[1]!;
    const raw = m[2]!;
    if (raw === 'true') out[key] = true;
    else if (raw === 'false') out[key] = false;
    else if (/^-?\d+(?:\.\d+)?$/.test(raw)) out[key] = Number(raw);
    else out[key] = parseString(raw);
  }
  return out;
}

function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && (inner[i] === ' ' || inner[i] === ',')) i++;
    if (i >= inner.length) break;
    if (inner[i] === "'" || inner[i] === '"' || inner[i] === '`') {
      const end = endOfString(inner, i);
      args.push(inner.slice(i, end + 1));
      i = end + 1;
    } else if (inner[i] === '{') {
      let depth = 0;
      const start = i;
      for (; i < inner.length; i++) {
        if (inner[i] === '{') depth++;
        else if (inner[i] === '}' && --depth === 0) {
          i++;
          break;
        }
      }
      args.push(inner.slice(start, i));
    } else {
      const start = i;
      while (i < inner.length && inner[i] !== ',') i++;
      args.push(inner.slice(start, i));
    }
  }
  return args;
}

function parseCall(methodName: string, argsSrc: string): LocatorCall {
  const args = splitTopLevelArgs(argsSrc);
  switch (methodName) {
    case 'getByRole': {
      if (args.length < 1) throw new Error('getByRole needs a role');
      const role = parseString(args[0]!);
      const opts = args[1] ? parseObjectLiteral(args[1]) : {};
      return {
        method: 'getByRole',
        role,
        ...(typeof opts.name === 'string' ? { name: opts.name } : {}),
        ...(typeof opts.exact === 'boolean' ? { exact: opts.exact } : {}),
        ...(typeof opts.level === 'number' ? { level: opts.level } : {}),
      };
    }
    case 'getByTestId':
    case 'getByText':
    case 'getByLabel':
    case 'getByPlaceholder':
    case 'getByAltText':
    case 'getByTitle': {
      if (args.length < 1) throw new Error(`${methodName} needs a value`);
      const text = parseString(args[0]!);
      const opts = args[1] ? parseObjectLiteral(args[1]) : {};
      return { method: methodName, text, ...(typeof opts.exact === 'boolean' ? { exact: opts.exact } : {}) };
    }
    case 'locator': {
      if (args.length < 1) throw new Error('locator needs a selector');
      return { method: 'locator', selector: parseString(args[0]!) };
    }
    case 'filter': {
      const opts = args[0] ? parseObjectLiteral(args[0]) : {};
      return {
        method: 'filter',
        ...(typeof opts.hasText === 'string' ? { hasText: opts.hasText } : {}),
        ...(typeof opts.hasNotText === 'string' ? { hasNotText: opts.hasNotText } : {}),
      };
    }
    case 'first':
      return { method: 'first' };
    case 'last':
      return { method: 'last' };
    case 'nth': {
      if (args.length < 1) throw new Error('nth needs an index');
      return { method: 'nth', index: Number(args[0]) };
    }
    default:
      throw new Error(`unsupported method: ${methodName}()`);
  }
}

/**
 * Parse a locator expression like `getByRole('button', { name: 'Pay' }).nth(0)`
 * into a chain of calls. Throws with a human-readable message on anything
 * outside the supported subset — callers should show that message, not a
 * stack trace.
 */
export function parseLocatorExpression(expr: string): ParsedLocatorChain {
  const trimmed = expr.trim().replace(/^(?:await\s+)?page\./, '');
  const calls: LocatorCall[] = [];
  let i = 0;
  let leafSeen = false;
  while (i < trimmed.length) {
    const nameMatch = /^[A-Za-z_$][\w$]*/.exec(trimmed.slice(i));
    if (!nameMatch) throw new Error(`expected a method name at "${trimmed.slice(i, i + 20)}"`);
    const methodName = nameMatch[0];
    const parenStart = i + methodName.length;
    if (trimmed[parenStart] !== '(') throw new Error(`expected "(" after ${methodName}`);
    const parenEnd = matchParen(trimmed, parenStart);
    if (!LEAF_METHODS.has(methodName) && !NARROWING_METHODS.has(methodName)) {
      throw new Error(`unsupported method: ${methodName}() — try getBy*, locator, filter, first, last, or nth`);
    }
    if (LEAF_METHODS.has(methodName)) {
      if (leafSeen)
        throw new Error(
          `${methodName}() can only start a chain, or follow an anchor — chained locators aren't supported here yet`,
        );
      leafSeen = true;
    } else if (!leafSeen) {
      throw new Error(`${methodName}() needs a locator before it`);
    }
    calls.push(parseCall(methodName, trimmed.slice(parenStart + 1, parenEnd)));
    i = parenEnd + 1;
    if (i < trimmed.length) {
      if (trimmed[i] !== '.') throw new Error(`expected "." at "${trimmed.slice(i, i + 20)}"`);
      i++;
    }
  }
  if (calls.length === 0) throw new Error('empty expression');
  return { calls };
}
