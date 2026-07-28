import { describe, test, expect } from 'vitest';
import { normalizeSteps, buildSession, type RawCaptureEvent, type RecordedTarget } from '../src/recording';

function target(overrides: Partial<RecordedTarget> = {}): RecordedTarget {
  return {
    tagName: 'input',
    role: 'textbox',
    accessibleName: 'Username',
    testId: null,
    text: null,
    alternatives: [{ locator: `getByRole('textbox', { name: 'Username' })`, method: 'getByRole', score: 90 }],
    ...overrides,
  };
}

function ev(overrides: Partial<RawCaptureEvent>): RawCaptureEvent {
  return {
    kind: 'click',
    target: null,
    value: null,
    checked: null,
    inputType: null,
    isPasswordField: false,
    pageUrl: 'https://x.test/',
    timestamp: 0,
    ...overrides,
  };
}

describe('normalizeSteps', () => {
  test('coalesces an input burst on the same field into one fill with the last value', () => {
    const usernameField = target();
    const steps = normalizeSteps([
      ev({ kind: 'input', target: usernameField, value: 'a', timestamp: 1 }),
      ev({ kind: 'input', target: usernameField, value: 'al', timestamp: 2 }),
      ev({ kind: 'input', target: usernameField, value: 'alice', timestamp: 3 }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ action: 'fill', value: 'alice' });
  });

  test('a click on a different target flushes the pending fill first', () => {
    const usernameField = target();
    const button = target({ tagName: 'button', role: 'button', accessibleName: 'Submit' });
    const steps = normalizeSteps([
      ev({ kind: 'input', target: usernameField, value: 'alice', timestamp: 1 }),
      ev({ kind: 'click', target: button, timestamp: 2 }),
    ]);
    expect(steps.map((s) => s.action)).toEqual(['fill', 'click']);
  });

  test('password fields are never captured — redacted with a null value', () => {
    const passwordField = target({ role: 'textbox', accessibleName: 'Password' });
    const steps = normalizeSteps([
      ev({ kind: 'input', target: passwordField, value: 'hunter2', isPasswordField: true, timestamp: 1 }),
    ]);
    expect(steps[0]).toMatchObject({ action: 'fill', value: null, redacted: true });
  });

  test('checkbox change becomes check/uncheck, not a raw click', () => {
    const checkbox = target({ tagName: 'input', role: 'checkbox', accessibleName: 'Agree' });
    const steps = normalizeSteps([
      ev({ kind: 'click', target: checkbox, inputType: 'checkbox', timestamp: 1 }),
      ev({ kind: 'change', target: checkbox, inputType: 'checkbox', checked: true, timestamp: 2 }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.action).toBe('check');
  });

  test('unchecking emits uncheck', () => {
    const checkbox = target({ role: 'checkbox' });
    const steps = normalizeSteps([
      ev({ kind: 'change', target: checkbox, inputType: 'checkbox', checked: false, timestamp: 1 }),
    ]);
    expect(steps[0]!.action).toBe('uncheck');
  });

  test('select change becomes selectOption', () => {
    const select = target({ tagName: 'select', role: 'combobox', accessibleName: 'Country' });
    const steps = normalizeSteps([
      ev({ kind: 'change', target: select, inputType: 'select', value: 'FR', timestamp: 1 }),
    ]);
    expect(steps[0]).toMatchObject({ action: 'selectOption', value: 'FR' });
  });

  test('Enter commits a pending fill and becomes a press step, not a click', () => {
    const field = target();
    const steps = normalizeSteps([
      ev({ kind: 'input', target: field, value: 'alice', timestamp: 1 }),
      ev({ kind: 'keydown', target: field, value: 'Enter', timestamp: 2 }),
    ]);
    expect(steps.map((s) => s.action)).toEqual(['fill', 'press']);
    expect(steps[1]).toMatchObject({ value: 'Enter' });
  });

  test('non-Enter keydowns are ignored', () => {
    const field = target();
    const steps = normalizeSteps([ev({ kind: 'keydown', target: field, value: 'Tab', timestamp: 1 })]);
    expect(steps).toHaveLength(0);
  });

  test('only the first navigation becomes a goto — later ones are implied by what caused them', () => {
    const steps = normalizeSteps([
      ev({ kind: 'navigate', value: 'https://x.test/', timestamp: 1 }),
      ev({ kind: 'click', target: target({ tagName: 'a', role: 'link' }), timestamp: 2 }),
      ev({ kind: 'navigate', value: 'https://x.test/next', timestamp: 3 }),
      ev({ kind: 'click', target: target({ tagName: 'button', role: 'button' }), timestamp: 4 }),
    ]);
    expect(steps.map((s) => s.action)).toEqual(['goto', 'click', 'click']);
    expect(steps[0]).toMatchObject({ value: 'https://x.test/' });
  });

  test('long text is normalized and truncated on the target', () => {
    const long = 'x'.repeat(200);
    const steps = normalizeSteps([ev({ kind: 'click', target: target({ text: `  ${long}  ` }), timestamp: 1 })]);
    expect(steps[0]!.target!.text).toHaveLength(120);
  });
});

describe('buildSession', () => {
  test('startUrl comes from the first goto step when present', () => {
    const steps = normalizeSteps([
      ev({ kind: 'navigate', value: 'https://x.test/start', timestamp: 1 }),
      ev({ kind: 'click', target: target(), timestamp: 2 }),
    ]);
    const session = buildSession(steps, 1000);
    expect(session.startUrl).toBe('https://x.test/start');
    expect(session.startedAt).toBe(1000);
  });

  test('falls back to the first step pageUrl when there is no goto', () => {
    const steps = normalizeSteps([
      ev({ kind: 'click', target: target(), pageUrl: 'https://x.test/no-goto', timestamp: 1 }),
    ]);
    const session = buildSession(steps, 0);
    expect(session.startUrl).toBe('https://x.test/no-goto');
  });
});
