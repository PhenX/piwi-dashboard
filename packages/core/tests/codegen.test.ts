import { describe, test, expect } from 'vitest';
import { renderSpec } from '../src/codegen';
import { buildSession } from '../src/recording';
import type { RecordedStep, RecordedTarget } from '../src/recording';
import type { TestFunctionEntry } from '../src/function-match';

function target(overrides: Partial<RecordedTarget> = {}): RecordedTarget {
  const merged = {
    tagName: 'button',
    role: 'button',
    accessibleName: 'Log in',
    testId: null as string | null,
    text: null as string | null,
    ...overrides,
  };
  const locator = merged.testId
    ? `getByTestId('${merged.testId}')`
    : `getByRole('${merged.role}', { name: '${merged.accessibleName}' })`;
  return {
    ...merged,
    alternatives: overrides.alternatives ?? [
      { locator, method: merged.testId ? 'getByTestId' : 'getByRole', score: 90 },
    ],
  };
}

function step(overrides: Partial<RecordedStep> = {}): RecordedStep {
  return {
    action: 'click',
    target: target(),
    value: null,
    redacted: false,
    pageUrl: 'https://x.test/login',
    timestamp: 0,
    ...overrides,
  };
}

describe('renderSpec — raw mode (no catalog)', () => {
  test('emits an initial goto from startUrl, then one line per step', () => {
    const session = buildSession([step({ action: 'click' })], 0);
    session.startUrl = 'https://x.test/login';
    const { code } = renderSpec(session);
    expect(code).toContain(`await page.goto('https://x.test/login');`);
    expect(code).toContain(`.click();`);
    expect(code).toContain(`test('recorded flow'`);
  });

  test('a goto step in the recording is used as-is, without a duplicate leading goto', () => {
    const gotoStep = step({ action: 'goto', target: null, value: 'https://x.test/login' });
    const session = buildSession([gotoStep, step()], 0);
    const { code } = renderSpec(session);
    expect(code.match(/page\.goto\(/g)).toHaveLength(1);
  });

  test('fill emits the literal value', () => {
    const session = buildSession(
      [step({ action: 'fill', value: 'alice', target: target({ accessibleName: 'Username' }) })],
      0,
    );
    const { code } = renderSpec(session);
    expect(code).toContain(`.fill('alice');`);
  });

  test('a redacted fill emits a process.env placeholder, never the raw value', () => {
    const session = buildSession([step({ action: 'fill', value: null, redacted: true })], 0);
    const { code } = renderSpec(session);
    expect(code).toMatch(/process\.env\.PIWI_TEST_VALUE_\d+/);
    expect(code).not.toContain('hunter2');
  });

  test('check/uncheck/selectOption/press render their own methods', () => {
    const session = buildSession(
      [
        step({ action: 'check' }),
        step({ action: 'uncheck' }),
        step({ action: 'selectOption', value: 'FR' }),
        step({ action: 'press', value: 'Enter' }),
      ],
      0,
    );
    const { code } = renderSpec(session);
    expect(code).toContain('.check();');
    expect(code).toContain('.uncheck();');
    expect(code).toContain(`.selectOption('FR');`);
    expect(code).toContain(`.press('Enter');`);
  });

  test('no matchedSpans are reported without a catalog', () => {
    const session = buildSession([step()], 0);
    const { matchedSpans } = renderSpec(session);
    expect(matchedSpans).toEqual([]);
  });
});

describe('renderSpec — with a catalog', () => {
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

  function loginSteps(): RecordedStep[] {
    return [
      step({
        action: 'fill',
        value: 'alice',
        target: target({ role: 'textbox', accessibleName: 'Username', tagName: 'input' }),
      }),
      step({
        action: 'fill',
        value: 'secret',
        target: target({ role: 'textbox', accessibleName: 'Password', tagName: 'input' }),
      }),
      step({ action: 'click', target: target({ role: 'button', accessibleName: 'Log in' }) }),
    ];
  }

  test('a complete matching span collapses into one function call with imports and instantiation', () => {
    const session = buildSession(loginSteps(), 0);
    const { code, matchedSpans } = renderSpec(session, { catalog: [loginEntry] });
    expect(code).toContain(`import { LoginPage } from './pages/LoginPage';`);
    expect(code).toContain(`const loginPage = new LoginPage(page);`);
    expect(code).toContain(`await loginPage.login('alice', 'secret');`);
    expect(code).not.toContain('.fill(');
    expect(matchedSpans).toEqual([{ startStep: 0, endStep: 2, functionName: 'login' }]);
  });

  test('steps after a matched span that do not match anything stay raw', () => {
    const extra = step({ action: 'click', target: target({ accessibleName: 'Continue' }) });
    const session = buildSession([...loginSteps(), extra], 0);
    const { code } = renderSpec(session, { catalog: [loginEntry] });
    expect(code).toContain(`await loginPage.login('alice', 'secret');`);
    expect(code).toContain(`getByRole('button', { name: 'Continue' })`);
  });

  test('an incomplete match (fewer steps than the pattern needs) is left raw, not partially substituted', () => {
    const session = buildSession(loginSteps().slice(0, 2), 0);
    const { code, matchedSpans } = renderSpec(session, { catalog: [loginEntry] });
    expect(code).not.toContain('loginPage.login');
    expect(code).toContain(`.fill('alice');`);
    expect(matchedSpans).toEqual([]);
  });

  test('a helper (no receiver) is imported and called directly with page as the first arg', () => {
    const helper: TestFunctionEntry = {
      ...loginEntry,
      id: 2,
      name: 'addItem',
      kind: 'helper',
      receiver: null,
      importName: null,
      module: './helpers/cart',
      params: [{ name: 'sku', type: 'string' }],
      steps: [{ action: 'click', target: { role: 'button', name: 'Add to cart' } }],
      paramSources: [{ param: 'sku', stepIndex: 0, from: 'testId' }],
    };
    const cartStep = step({ target: target({ role: 'button', accessibleName: 'Add to cart', testId: 'sku-42' }) });
    const session = buildSession([cartStep], 0);
    const { code } = renderSpec(session, { catalog: [helper] });
    expect(code).toContain(`import { addItem } from './helpers/cart';`);
    expect(code).toContain(`await addItem(page, 'sku-42');`);
  });
});

/**
 * The shape most real Playwright helpers actually take — an options bag
 * (`selectOption(page, { label }, { value })`) rather than positional
 * scalars. Before `object` params existed these could only be declared
 * `string`, and codegen emitted a bare `''` into a slot needing a literal.
 */
describe('renderSpec — object params', () => {
  const selectEntry: TestFunctionEntry = {
    id: 10,
    name: 'selectOption',
    kind: 'helper',
    module: './helpers/select',
    receiver: null,
    importName: null,
    urlPattern: null,
    params: [
      { name: 'source', type: 'object', fields: ['label'] },
      { name: 'option', type: 'object', fields: ['value'] },
    ],
    steps: [
      { action: 'click', target: { role: 'combobox' } },
      { action: 'click', target: { role: 'option' } },
    ],
    paramSources: [
      { param: 'source', path: 'label', stepIndex: 0, from: 'text' },
      { param: 'option', path: 'value', stepIndex: 1, from: 'text' },
    ],
  };

  function selectSteps(optionText: string | null): RecordedStep[] {
    return [
      step({ target: target({ role: 'combobox', accessibleName: 'Country', text: 'Country' }) }),
      step({ target: target({ role: 'option', accessibleName: 'France', text: optionText }) }),
    ];
  }

  test('each object param renders as a literal built from its resolved fields', () => {
    const session = buildSession(selectSteps('France'), 0);
    const { code } = renderSpec(session, { catalog: [selectEntry] });
    expect(code).toContain(`await selectOption(page, { label: 'Country' }, { value: 'France' });`);
  });

  test('a field that resolved to nothing is omitted, not emitted empty', () => {
    const session = buildSession(selectSteps(null), 0);
    const { code } = renderSpec(session, { catalog: [selectEntry] });
    // `option.value` had no text to read, so the bag renders empty rather than `{ value: '' }`.
    expect(code).toContain(`await selectOption(page, { label: 'Country' }, {});`);
  });

  test('a field name that is not a bare identifier is quoted as a key', () => {
    const quirky: TestFunctionEntry = {
      ...selectEntry,
      params: [
        { name: 'source', type: 'object', fields: ['data-label'] },
        { name: 'option', type: 'object', fields: ['value'] },
      ],
      paramSources: [
        { param: 'source', path: 'data-label', stepIndex: 0, from: 'text' },
        { param: 'option', path: 'value', stepIndex: 1, from: 'text' },
      ],
    };
    const session = buildSession(selectSteps('France'), 0);
    const { code } = renderSpec(session, { catalog: [quirky] });
    expect(code).toContain(`{ 'data-label': 'Country' }`);
  });
});
