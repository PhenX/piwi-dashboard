/**
 * The replay interpreter: it turns a committed entry back into plain Playwright
 * calls. It builds a real, synchronous `Locator` from a structured locator, runs
 * a flow's steps (with a per-step fingerprint drift guard so replay stops *before*
 * acting on a renamed element), and asserts the flow's postcondition oracle.
 *
 * Everything here is allowlist-validated and parameter-substituted; nothing is
 * evaluated. `buildLocator` and the executors are structural over their `page`
 * argument so they can be driven by a real page at runtime or a recording double
 * in unit tests.
 */
import type { Locator, Page } from '@playwright/test';
import type { ElementFingerprint } from '@piwitests/core';
import { parseAriaCandidates, fingerprintPresent } from '@piwitests/core';
import { LOCATOR_METHODS, ACTION_METHODS } from '../capture/locator-healing.js';
import type { LocatorArg, Postcondition, RunEntry, RunStep, StructuredLocator } from './artifact.js';
import type { ParamValues } from './params.js';
import { substituteArgs, substituteMarkers } from './params.js';

const LOCATOR_METHOD_SET = new Set(LOCATOR_METHODS);
const ACTION_METHOD_SET = new Set(ACTION_METHODS);

/** A page or locator, viewed as the bag of builder/action methods we call. */
type MethodBag = Record<string, (...args: unknown[]) => unknown>;

/** Thrown when a step's element drifted from its compile-time fingerprint. */
export class StepDriftError extends Error {
  constructor(
    public readonly step: RunStep,
    public readonly fingerprint: ElementFingerprint,
  ) {
    super(
      `piwi AI: element drifted from its recorded identity (` +
        `role="${fingerprint.role ?? ''}" name="${fingerprint.name ?? ''}") before ` +
        `${describeLocator(step.locator)}.${step.action}() — the flow was not run to avoid corrupting page state`,
    );
    this.name = 'StepDriftError';
  }
}

/** Thrown when a postcondition oracle is not satisfied after a flow replays. */
export class PostconditionError extends Error {
  constructor(post: Postcondition, cause: string) {
    super(`piwi AI: postcondition (${describePostcondition(post)}) not satisfied — ${cause}`);
    this.name = 'PostconditionError';
  }
}

/** Render a structured locator back to a readable call for error messages. */
export function describeLocator(loc: StructuredLocator): string {
  const head = `${loc.method}(${loc.args.map((a) => JSON.stringify(a)).join(', ')})`;
  const tail = (loc.chain ?? []).map(describeLocator).join('.');
  return tail ? `${head}.${tail}` : head;
}

function renderSourceArg(arg: LocatorArg): string {
  if (typeof arg === 'string') return `'${arg.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (arg === null || typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (Array.isArray(arg)) return `[${arg.map(renderSourceArg).join(', ')}]`;
  return `{ ${Object.entries(arg)
    .map(([key, value]) => `${key}: ${renderSourceArg(value)}`)
    .join(', ')} }`;
}

/**
 * Render a structured locator in Playwright's own source style —
 * `getByRole('textbox', { name: 'Email' })` — the exact form Playwright prints
 * in error messages and traces. Used for the intent mappings the usage manifest
 * carries, so the dashboard and AI diagnosis can join a failing locator string
 * back to the natural-language prompt it was compiled from. (`describeLocator`
 * keeps its JSON style for interpreter error messages.)
 */
export function locatorSource(loc: StructuredLocator): string {
  const head = `${loc.method}(${loc.args.map(renderSourceArg).join(', ')})`;
  const tail = (loc.chain ?? []).map(locatorSource).join('.');
  return tail ? `${head}.${tail}` : head;
}

function describePostcondition(post: Postcondition): string {
  return post.assert === 'url' ? `url → ${post.url ?? ''}` : `${describeLocator(post.locator!)} ${post.assert}`;
}

/**
 * Build a concrete `Locator` from structured data, rooted at `root` (a `Page`
 * for the first hop, a `Locator` for chained hops). Methods are allowlist-checked
 * and `{{param}}` markers substituted before the call.
 */
export function buildLocator(root: Page | Locator, structured: StructuredLocator, params: ParamValues = {}): Locator {
  if (!LOCATOR_METHOD_SET.has(structured.method)) {
    throw new Error(`piwi AI: locator method "${structured.method}" is not allowlisted`);
  }
  const args = substituteArgs(structured.args, params);
  let current = (root as unknown as MethodBag)[structured.method](...args) as Locator;
  for (const child of structured.chain ?? []) {
    current = buildLocator(current, child, params);
  }
  return current;
}

/** Options controlling step execution — injectable so tests need no real browser. */
export interface StepContext {
  page: Page;
  params: ParamValues;
  /**
   * Reads the page's ARIA snapshot for the fingerprint guard. When omitted the
   * guard is skipped (silent degradation); the fixture supplies the real reader.
   */
  readAria?: (page: Page) => Promise<string | null>;
  /** Existence-probe timeout (ms) for `optional` steps. */
  optionalProbeTimeout?: number;
  /** Timeout (ms) for a step's `waitForResponse`; omitted uses Playwright's default. */
  responseWaitTimeout?: number;
  /**
   * Wraps each step/assert in a reporter step (`test.step`) so replayed actions
   * appear in the trace and HTML report like hand-written code. Omitted in unit
   * tests, supplied by the fixture at runtime.
   */
  step?: <T>(title: string, body: () => Promise<T>) => Promise<T>;
}

async function probePresent(locator: Locator, timeout: number): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a fingerprint is still on the page. Returns `drifted` only when the
 * ARIA snapshot positively lacks it; an unreadable or empty snapshot yields
 * `unknown` (never blocks replay on uncertainty).
 */
export function checkFingerprintDrift(
  ariaSnapshot: string | null,
  fingerprint: ElementFingerprint,
): 'present' | 'drifted' | 'unknown' {
  if (!ariaSnapshot) return 'unknown';
  const candidates = parseAriaCandidates(ariaSnapshot);
  if (candidates.length === 0) return 'unknown';
  return fingerprintPresent(fingerprint, candidates) ? 'present' : 'drifted';
}

async function performAction(page: Page, locator: Locator, step: RunStep, ctx: StepContext): Promise<void> {
  if (!ACTION_METHOD_SET.has(step.action)) throw new Error(`piwi AI: action "${step.action}" is not allowlisted`);
  const args = step.value === undefined ? [] : [substituteMarkers(step.value, ctx.params)];
  const act = (): unknown => (locator as unknown as MethodBag)[step.action](...args);

  if (!step.waitForResponse) {
    await act();
    return;
  }

  // Arm the response wait BEFORE firing the action. Creating the wait promise
  // registers Playwright's listener synchronously, so a fast Ajax reply can never
  // land in the gap between the action and the wait (the race this guards against).
  const pattern = substituteMarkers(step.waitForResponse, ctx.params);
  const waitForResponse =
    ctx.responseWaitTimeout === undefined
      ? page.waitForResponse(pattern)
      : page.waitForResponse(pattern, { timeout: ctx.responseWaitTimeout });
  await Promise.all([waitForResponse, act()]);
}

/** Execute one flow step. Returns whether it ran or was skipped (optional absent). */
export async function executeStep(step: RunStep, ctx: StepContext): Promise<'ran' | 'skipped'> {
  const body = async (): Promise<'ran' | 'skipped'> => {
    const locator = buildLocator(ctx.page, step.locator, ctx.params);

    if (step.optional) {
      const present = await probePresent(locator, ctx.optionalProbeTimeout ?? 2000);
      if (!present) return 'skipped';
    }

    if (step.fingerprint && ctx.readAria) {
      const aria = await ctx.readAria(ctx.page);
      if (checkFingerprintDrift(aria, step.fingerprint) === 'drifted') {
        throw new StepDriftError(step, step.fingerprint);
      }
    }

    await performAction(ctx.page, locator, step, ctx);
    return 'ran';
  };

  const title = `${step.action}: ${describeLocator(step.locator)}${step.optional ? ' (optional)' : ''}`;
  return ctx.step ? ctx.step(title, body) : body();
}

/** Assert a flow's postcondition oracle. Throws `PostconditionError` on failure. */
export async function assertPostcondition(post: Postcondition, ctx: StepContext): Promise<void> {
  const body = async (): Promise<void> => {
    try {
      if (post.assert === 'url') {
        await ctx.page.waitForURL(substituteMarkers(post.url ?? '', ctx.params));
        return;
      }
      const locator = buildLocator(ctx.page, post.locator!, ctx.params);
      const state = post.assert === 'hidden' ? 'hidden' : post.assert === 'attached' ? 'attached' : 'visible';
      await locator.first().waitFor({ state });
    } catch (error) {
      throw new PostconditionError(post, (error as Error).message);
    }
  };
  await (ctx.step ? ctx.step(`postcondition: ${describePostcondition(post)}`, body) : body());
}

/** Replay a whole flow: every step in order, then the postcondition oracle. */
export async function executeRun(entry: RunEntry, ctx: StepContext): Promise<void> {
  for (const step of entry.steps) {
    await executeStep(step, ctx);
  }
  await assertPostcondition(entry.postcondition, ctx);
}
