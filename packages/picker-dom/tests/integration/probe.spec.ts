import { test, expect } from '@playwright/test';
import { probeElementAttrs } from '../../src/probe.js';
import { domRoleOf, domHeadingLevel } from '../../src/dom-role.js';

test.describe('domRoleOf / domHeadingLevel', () => {
  test('resolves explicit and implicit roles, and heading level', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <button id="btn">X</button>
      <a id="link" href="/x">X</a>
      <a id="bare-a">X</a>
      <input id="text-input" />
      <input id="checkbox-input" type="checkbox" />
      <div id="explicit" role="tab">X</div>
      <h2 id="heading">X</h2>
      <div id="aria-heading" role="heading" aria-level="4">X</div>
    </body></html>`);
    const maps = {
      tagRoles: { a: 'link', button: 'button', h2: 'heading' },
      inputRoles: { text: 'textbox', checkbox: 'checkbox' },
    };
    const roleOf = (id: string) => page.locator(`#${id}`).evaluate(domRoleOf, maps);

    expect(await roleOf('btn')).toBe('button');
    expect(await roleOf('link')).toBe('link');
    expect(await roleOf('bare-a')).toBe(null);
    expect(await roleOf('text-input')).toBe('textbox');
    expect(await roleOf('checkbox-input')).toBe('checkbox');
    expect(await roleOf('explicit')).toBe('tab');

    expect(await page.locator('#heading').evaluate(domHeadingLevel)).toBe(2);
    expect(await page.locator('#aria-heading').evaluate(domHeadingLevel)).toBe(4);
    expect(await page.locator('#btn').evaluate(domHeadingLevel)).toBe(null);
  });
});

test.describe('probeElementAttrs', () => {
  test('reads the attribute whitelist and selector-uniqueness counts', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <button id="submit" data-testid="submit-btn" class="btn btn-primary">Submit</button>
      <button class="btn">Other</button>
    </body></html>`);
    const attrs = await page.locator('#submit').evaluate(probeElementAttrs, {
      keep: ['id', 'data-testid', 'class'],
      includeStructural: false,
      includeLabelText: false,
    });
    expect(attrs.attributes['data-testid']).toBe('submit-btn');
    expect(attrs.selectorCounts.testId).toBe(1);
    expect(attrs.selectorCounts.id).toBe(1);
    expect(attrs.selectorCounts.classes?.['btn']).toBe(2);
    expect(attrs.selectorCounts.classes?.['btn-primary']).toBe(1);
    expect(attrs.hasLabel).toBe(false);
  });

  test('computes rolePosition and anchor-worthy ancestors only when includeStructural is set', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <nav aria-label="Main">
        <button data-testid="a">A</button>
        <button>B</button>
      </nav>
    </body></html>`);
    const withStructural = await page.locator('[data-testid="a"]').evaluate(probeElementAttrs, {
      keep: ['data-testid'],
      tagRoles: { button: 'button', nav: 'navigation' },
      inputRoles: {},
      roleSources: 'button,nav',
      includeStructural: true,
      includeLabelText: false,
    });
    expect(withStructural.rolePosition).toEqual({ role: 'button', count: 2, index: 0 });
    expect(withStructural.ancestors?.[0]).toMatchObject({ tag: 'nav', ariaLabel: 'Main' });

    const withoutStructural = await page.locator('[data-testid="a"]').evaluate(probeElementAttrs, {
      keep: ['data-testid'],
      includeStructural: false,
      includeLabelText: false,
    });
    expect(withoutStructural.rolePosition).toBeUndefined();
    expect(withoutStructural.ancestors).toBeUndefined();
  });

  test('collects a stable data-* hook on an ancestor that has no other anchor', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <div data-product="42"><button>Add to cart</button></div>
      <div data-product="43" data-v-4f2a1b><button id="target">Add to cart</button></div>
    </body></html>`);
    const attrs = await page.locator('#target').evaluate(probeElementAttrs, {
      keep: ['id'],
      tagRoles: { button: 'button' },
      inputRoles: {},
      roleSources: 'button,div',
      includeStructural: true,
      includeLabelText: false,
    });
    // Vue's scoped-style marker sits first in the attribute list and would win
    // a naive "first data-*" scan — it identifies a build, not an element.
    expect(attrs.ancestors?.[0]).toMatchObject({
      tag: 'div',
      dataAttr: { name: 'data-product', value: '43' },
      dataAttrCount: 1,
      scopedRoleCount: 1,
    });
    // Both cards say "Add to cart", so the leaf's own locators are ambiguous —
    // the anchor is the only thing that resolves to one element.
    expect(attrs.selectorCounts.roleName).toBe(2);
  });

  test('ignores valueless and over-long data-* markers', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <div data-open data-state="${'x'.repeat(200)}"><button id="target">Go</button></div>
    </body></html>`);
    const attrs = await page.locator('#target').evaluate(probeElementAttrs, {
      keep: ['id'],
      tagRoles: { button: 'button' },
      inputRoles: {},
      roleSources: 'button,div',
      includeStructural: true,
      includeLabelText: false,
    });
    expect(attrs.ancestors).toEqual([]);
  });

  test('walks ancestors for a role-less leaf and counts its text within each', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <div data-testid="row-mouse"><span class="price">£49.99</span></div>
      <div data-testid="row-keyboard"><span id="target" class="price">£49.99</span></div>
    </body></html>`);
    const attrs = await page.locator('#target').evaluate(probeElementAttrs, {
      keep: ['id', 'class'],
      tagRoles: { button: 'button' },
      inputRoles: {},
      roleSources: 'button,div',
      includeStructural: true,
      includeLabelText: false,
    });
    // A <span> has no role, so there is nothing role-shaped to scope — the
    // walk used to stop here and the leaf got no chain at all.
    expect(attrs.rolePosition).toBeNull();
    expect(attrs.ancestors?.[0]).toMatchObject({ testId: 'row-keyboard', scopedTextCount: 1 });
    expect(attrs.ancestors?.[0]?.scopedRoleCount).toBeUndefined();
    expect(attrs.selectorCounts.text).toBe(2);
  });

  test('counts the smallest element containing the text, not every ancestor of it', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <div><section><div class="badge">In <b>stock</b></div></section></div>
      <div><section><div id="target" class="badge">In <b>stock</b></div></section></div>
    </body></html>`);
    const attrs = await page.locator('#target').evaluate(probeElementAttrs, {
      keep: ['id'],
      tagRoles: {},
      inputRoles: {},
      roleSources: 'button',
      includeStructural: true,
      includeLabelText: false,
    });
    // Two badges match. Their wrapping <section> and <div> contain the text too
    // but only through a descendant, and Playwright resolves to the smallest
    // element — counting them would wrongly report 6.
    expect(attrs.selectorCounts.text).toBe(2);
  });

  test('picks discriminating text for a repeated container and counts what it narrows to', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body><ul>
      <li><h3>Mouse</h3><button>Remove</button></li>
      <li><h3>Keyboard</h3><button id="target">Remove</button></li>
      <li><h3>Monitor</h3><button>Remove</button></li>
    </ul></body></html>`);
    const attrs = await page.locator('#target').evaluate(probeElementAttrs, {
      keep: ['id'],
      tagRoles: { button: 'button', li: 'listitem', h3: 'heading' },
      inputRoles: {},
      roleSources: 'button,li,h3',
      includeStructural: true,
      includeLabelText: false,
    });
    // Nothing on the page carries a hook and every <li> has the same role, so
    // the heading inside the row is the only thing that names it.
    expect(attrs.ancestors?.[0]).toMatchObject({
      tag: 'li',
      roleCount: 3,
      filterText: 'Keyboard',
      filterRoleCount: 1,
      scopedRoleCount: 1,
    });
  });

  test('never filters a container by the target element own text', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body><ul>
      <li><button>Remove</button></li>
      <li><button id="target">Remove</button></li>
    </ul></body></html>`);
    const attrs = await page.locator('#target').evaluate(probeElementAttrs, {
      keep: ['id'],
      tagRoles: { button: 'button', li: 'listitem' },
      inputRoles: {},
      roleSources: 'button,li',
      includeStructural: true,
      includeLabelText: false,
    });
    // filter({ hasText: 'Remove' }) would match every row — filtering on the
    // very text being disambiguated singles out nothing.
    expect(attrs.ancestors?.[0]?.filterText).toBeUndefined();
  });

  test('includes labelText only when includeLabelText is set', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <label for="email">Email address</label>
      <input id="email" />
    </body></html>`);
    const withLabel = await page.locator('#email').evaluate(probeElementAttrs, {
      keep: ['id'],
      includeStructural: false,
      includeLabelText: true,
    });
    expect(withLabel.hasLabel).toBe(true);
    expect(withLabel.labelText).toBe('Email address');

    const withoutLabel = await page.locator('#email').evaluate(probeElementAttrs, {
      keep: ['id'],
      includeStructural: false,
      includeLabelText: false,
    });
    expect(withoutLabel.hasLabel).toBe(true);
    expect(withoutLabel.labelText).toBeUndefined();
  });
});
