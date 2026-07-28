import { test, expect } from '@playwright/test';
import { probeElementAttrs } from '../../src/probe.js';

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
