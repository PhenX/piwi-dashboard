import { describe, test, expect } from 'vitest';
import { rankFunctionMatches, matchFunctionAt, type TestFunctionEntry } from '../src/function-match';
import type { RecordedStep, RecordedTarget } from '../src/recording';

function target(overrides: Partial<RecordedTarget> = {}): RecordedTarget {
  return {
    tagName: 'input',
    role: null,
    accessibleName: null,
    testId: null,
    text: null,
    alternatives: [],
    ...overrides,
  };
}

function step(overrides: Partial<RecordedStep> = {}): RecordedStep {
  return {
    action: 'click',
    target: null,
    value: null,
    redacted: false,
    pageUrl: 'https://x.test/login',
    timestamp: 0,
    ...overrides,
  };
}

const loginEntry: TestFunctionEntry = {
  id: 1,
  name: 'login',
  kind: 'page-object-method',
  module: './pages/LoginPage',
  receiver: 'loginPage',
  importName: 'LoginPage',
  params: [
    { name: 'username', type: 'string' },
    { name: 'password', type: 'string' },
  ],
  urlPattern: '**/login',
  steps: [
    { action: 'fill', target: { role: 'textbox', name: 'Username' } },
    { action: 'fill', target: { role: 'textbox', name: 'Password' } },
    { action: 'click', target: { role: 'button', name: 'Log in' } },
  ],
  paramSources: [
    { param: 'username', stepIndex: 0, from: 'value' },
    { param: 'password', stepIndex: 1, from: 'value' },
  ],
};

const usernameStep = step({
  action: 'fill',
  target: target({ role: 'textbox', accessibleName: 'Username' }),
  value: 'alice',
});
const passwordStep = step({
  action: 'fill',
  target: target({ role: 'textbox', accessibleName: 'Password' }),
  value: 'secret',
});
const submitStep = step({ action: 'click', target: target({ role: 'button', accessibleName: 'Log in' }) });

describe('rankFunctionMatches', () => {
  test('a complete matching sequence scores high, is marked complete, and resolves both args', () => {
    const matches = rankFunctionMatches([usernameStep, passwordStep, submitStep], [loginEntry]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.complete).toBe(true);
    expect(matches[0]!.args).toEqual({ username: 'alice', password: 'secret' });
    expect(matches[0]!.score).toBeGreaterThan(0.5);
  });

  test('a partial (in-progress) sequence still ranks, marked incomplete', () => {
    const matches = rankFunctionMatches([usernameStep], [loginEntry]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.complete).toBe(false);
    expect(matches[0]!.matchedIndices).toEqual([0]);
  });

  test('urlPattern gates out entries that do not apply to the current page', () => {
    const offSite = { ...usernameStep, pageUrl: 'https://x.test/checkout' };
    const matches = rankFunctionMatches([offSite], [loginEntry]);
    expect(matches).toHaveLength(0);
  });

  test('an unrelated catalog entry does not match at all', () => {
    const addToCart: TestFunctionEntry = {
      ...loginEntry,
      id: 2,
      name: 'addToCart',
      urlPattern: null,
      steps: [{ action: 'click', target: { role: 'button', name: 'Add to cart' } }],
      paramSources: [],
    };
    const matches = rankFunctionMatches([usernameStep], [addToCart]);
    expect(matches).toHaveLength(0);
  });

  test('higher-coverage matches rank above lower-coverage ones', () => {
    // Only its first pattern step actually appears in the window — the other two
    // (role 'listitem', never seen here) can't match anything, so this entry's
    // coverage stays low even though the one step it does find scores well.
    const mostlyUnmatched: TestFunctionEntry = {
      ...loginEntry,
      id: 3,
      name: 'mostlyUnmatched',
      steps: [
        loginEntry.steps[0]!,
        { action: 'click', target: { role: 'listitem', name: 'Never appears' } },
        { action: 'click', target: { role: 'listitem', name: 'Also never appears' } },
      ],
      paramSources: [],
    };
    const matches = rankFunctionMatches([usernameStep, passwordStep, submitStep], [mostlyUnmatched, loginEntry]);
    expect(matches[0]!.entry.name).toBe('login');
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score);
  });

  test('empty steps or empty catalog return no matches', () => {
    expect(rankFunctionMatches([], [loginEntry])).toEqual([]);
    expect(rankFunctionMatches([usernameStep], [])).toEqual([]);
  });
});

describe('matchFunctionAt', () => {
  test('finds a complete match anchored exactly at the given start index', () => {
    const steps = [step({ action: 'click' }), usernameStep, passwordStep, submitStep];
    const match = matchFunctionAt(steps, 1, [loginEntry]);
    expect(match).not.toBeNull();
    expect(match!.matchedIndices).toEqual([1, 2, 3]);
    expect(match!.args).toEqual({ username: 'alice', password: 'secret' });
  });

  test('returns null when the anchor step does not match any entry pattern start', () => {
    const steps = [submitStep, usernameStep, passwordStep];
    const match = matchFunctionAt(steps, 0, [loginEntry]);
    expect(match).toBeNull();
  });

  test('returns null for an incomplete sequence at the anchor', () => {
    const steps = [usernameStep];
    const match = matchFunctionAt(steps, 0, [loginEntry]);
    expect(match).toBeNull();
  });
});
