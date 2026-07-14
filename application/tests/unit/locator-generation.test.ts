import { describe, test, expect } from 'vitest';
import {
  generateAlternatives,
  approximateAccessibleName,
  resolveAriaRole,
  headingLevel,
  type ElementAttributes,
} from '#shared/locator-generation';

/**
 * Behavior tests for the browser-side alternative generator used by the
 * DOM-snapshot picker. Equivalence with the reporter's generator is pinned
 * separately in reporter-shared-drift.test.ts — these tests pin the behavior
 * itself: score tiers, uniqueness gating, and the getByLabel gate.
 */

function el(overrides: Partial<ElementAttributes> = {}): ElementAttributes {
  return {
    tagName: 'button',
    attributes: {},
    textContent: null,
    accessibleName: null,
    center: null,
    ...overrides,
  };
}

describe('generateAlternatives', () => {
  test('unique data-testid ranks first at score 100', () => {
    const alts = generateAlternatives(
      el({ attributes: { 'data-testid': 'pay-btn' }, accessibleName: 'Pay now', selectorCounts: { testId: 1 } }),
    );
    expect(alts[0]).toMatchObject({ locator: "getByTestId('pay-btn')", method: 'getByTestId', score: 100 });
    // Scores are sorted descending
    expect([...alts].sort((a, b) => b.score - a.score)).toEqual(alts);
  });

  test('an ambiguous data-testid (count > 1) is dropped', () => {
    const alts = generateAlternatives(
      el({ attributes: { 'data-testid': 'row' }, accessibleName: 'Open', selectorCounts: { testId: 4 } }),
    );
    expect(alts.some((a) => a.method === 'getByTestId')).toBe(false);
  });

  test('role + accessible name yields getByRole with the name', () => {
    const alts = generateAlternatives(el({ accessibleName: 'Pay now' }));
    expect(alts[0]).toMatchObject({
      locator: "getByRole('button', { name: 'Pay now' })",
      method: 'getByRole',
      args: { role: 'button', name: 'Pay now' },
      score: 90,
    });
  });

  test('a labeled input yields getByLabel; a placeholder-named one does not', () => {
    const labeled = generateAlternatives(
      el({ tagName: 'input', attributes: { type: 'email' }, accessibleName: 'Email address', hasLabel: true }),
    );
    expect(labeled.map((a) => a.method)).toContain('getByLabel');
    expect(labeled.find((a) => a.method === 'getByLabel')).toMatchObject({
      locator: "getByLabel('Email address')",
      score: 85,
    });

    // Accessible name approximated from the placeholder — must NOT claim a <label>
    const placeholderNamed = generateAlternatives(
      el({ tagName: 'input', attributes: { placeholder: 'Search' }, accessibleName: 'Search', hasLabel: false }),
    );
    expect(placeholderNamed.some((a) => a.method === 'getByLabel')).toBe(false);
    expect(placeholderNamed.some((a) => a.method === 'getByPlaceholder')).toBe(true);
  });

  test('heading level flows into getByRole args and locator text', () => {
    const alts = generateAlternatives(el({ tagName: 'h2', accessibleName: 'Overview' }));
    const heading = alts.find((a) => a.method === 'getByRole');
    expect(heading).toMatchObject({ args: { role: 'heading', name: 'Overview', level: 2 } });
    expect(heading!.locator).toContain('level: 2');
  });

  test('auto-generated or ambiguous ids are skipped; a stable unique id is kept', () => {
    const stable = generateAlternatives(el({ attributes: { id: 'pay' }, selectorCounts: { id: 1 } }));
    expect(stable.map((a) => a.locator)).toContain("locator('#pay')");

    const autogen = generateAlternatives(el({ attributes: { id: 'radix-:r3:' } }));
    expect(autogen.some((a) => a.locator.includes('#radix'))).toBe(false);

    const ambiguous = generateAlternatives(el({ attributes: { id: 'row' }, selectorCounts: { id: 2 } }));
    expect(ambiguous.some((a) => a.locator.includes('#row'))).toBe(false);
  });

  test('ancestor anchors produce chained name-free alternatives', () => {
    const alts = generateAlternatives(
      el({
        accessibleName: 'Delete',
        rolePosition: { role: 'button', count: 3, index: 1 },
        ancestors: [
          {
            tag: 'div',
            depth: 1,
            testId: 'cart-row',
            id: null,
            role: null,
            ariaLabel: null,
            scopedRoleCount: 1,
            testIdCount: 1,
          },
          {
            tag: 'section',
            depth: 2,
            testId: null,
            id: 'summary',
            role: null,
            ariaLabel: null,
            scopedRoleCount: 1,
            idCount: 1,
          },
        ],
      }),
    );
    expect(alts.find((a) => a.args.anchorTestId)).toMatchObject({
      locator: "getByTestId('cart-row').getByRole('button')",
      score: 72,
    });
    expect(alts.find((a) => a.args.anchorSelector)).toMatchObject({
      locator: "locator('#summary').getByRole('button')",
      score: 64,
    });
    // The anchored chains carry no name — they survive renames
    expect(alts.filter((a) => a.args.anchorTestId || a.args.anchorSelector).every((a) => !('name' in a.args))).toBe(
      true,
    );
  });

  test('structural alternatives are skipped when the element has its own unique testid', () => {
    const alts = generateAlternatives(
      el({
        attributes: { 'data-testid': 'pay-btn' },
        accessibleName: 'Pay',
        selectorCounts: { testId: 1 },
        rolePosition: { role: 'button', count: 1, index: 0 },
        ancestors: [
          {
            tag: 'div',
            depth: 1,
            testId: 'card',
            id: null,
            role: null,
            ariaLabel: null,
            scopedRoleCount: 1,
            testIdCount: 1,
          },
        ],
      }),
    );
    expect(alts.some((a) => a.args.anchorTestId)).toBe(false);
  });

  test('a document-unique role yields the bare name-free getByRole', () => {
    const alts = generateAlternatives(
      el({ accessibleName: 'Pay', rolePosition: { role: 'button', count: 1, index: 0 } }),
    );
    expect(alts.find((a) => a.method === 'getByRole' && !('name' in a.args))).toMatchObject({
      locator: "getByRole('button')",
      score: 58,
    });
  });

  test('class alternatives rank stable names above generated ones and drop ambiguous classes', () => {
    const alts = generateAlternatives(
      el({
        attributes: { class: 'submit-btn bg-red-500 css-x9k2p1' },
        selectorCounts: { classes: { 'submit-btn': 1, 'bg-red-500': 4, 'css-x9k2p1': 1 } },
      }),
    );
    const classLocators = alts.filter((a) => a.method === 'locator' && a.locator.includes('.'));
    expect(classLocators.map((a) => a.locator)).toEqual(["locator('.submit-btn')", "locator('.css-x9k2p1')"]);
    expect(classLocators[0]!.score).toBeGreaterThan(classLocators[1]!.score);
  });
});

describe('approximateAccessibleName', () => {
  test('prefers aria-label, then text, then title, then placeholder', () => {
    expect(approximateAccessibleName(el({ attributes: { 'aria-label': 'Close' }, textContent: 'X' }))).toBe('Close');
    expect(approximateAccessibleName(el({ textContent: 'Pay now', attributes: { title: 'Pay' } }))).toBe('Pay now');
    expect(approximateAccessibleName(el({ attributes: { title: 'Pay' } }))).toBe('Pay');
    expect(approximateAccessibleName(el({ attributes: { placeholder: 'Search' } }))).toBe('Search');
    expect(approximateAccessibleName(el())).toBeNull();
  });
});

describe('resolveAriaRole / headingLevel', () => {
  test('resolves implicit roles from tag and input type; explicit role wins', () => {
    expect(resolveAriaRole(el({ tagName: 'input', attributes: { type: 'email' } }))).toBe('textbox');
    expect(resolveAriaRole(el({ tagName: 'input', attributes: { type: 'checkbox' } }))).toBe('checkbox');
    expect(resolveAriaRole(el({ tagName: 'select', attributes: { multiple: '' } }))).toBe('listbox');
    expect(resolveAriaRole(el({ tagName: 'select' }))).toBe('combobox');
    expect(resolveAriaRole(el({ tagName: 'a', attributes: { href: '/x' } }))).toBe('link');
    expect(resolveAriaRole(el({ tagName: 'a' }))).toBeNull();
    expect(resolveAriaRole(el({ tagName: 'span', attributes: { role: 'tab' } }))).toBe('tab');
  });

  test('derives the heading level from the tag or aria-level', () => {
    expect(headingLevel(el({ tagName: 'h3' }), 'heading')).toBe(3);
    expect(headingLevel(el({ tagName: 'div', attributes: { 'aria-level': '4' } }), 'heading')).toBe(4);
    expect(headingLevel(el({ tagName: 'h3' }), 'button')).toBeNull();
  });
});
