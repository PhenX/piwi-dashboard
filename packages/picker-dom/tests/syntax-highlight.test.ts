import { describe, it, expect } from 'vitest';
import { tokenizeLocator, highlightLocator, LOCATOR_SYNTAX_CSS } from '../src/syntax-highlight.js';

describe('tokenizeLocator', () => {
  it('classifies methods, strings, option keys, literals and punctuation', () => {
    const tokens = tokenizeLocator(`getByRole('button', { name: 'Pay now', exact: true })`);
    expect(tokens.filter((t) => t.kind === 'method').map((t) => t.text)).toEqual(['getByRole']);
    expect(tokens.filter((t) => t.kind === 'string').map((t) => t.text)).toEqual([`'button'`, `'Pay now'`]);
    expect(tokens.filter((t) => t.kind === 'option').map((t) => t.text)).toEqual(['name', 'exact']);
    expect(tokens.filter((t) => t.kind === 'literal').map((t) => t.text)).toEqual(['true']);
  });

  it('preserves the expression verbatim across the token list', () => {
    const expr = `getByTestId('row-7').getByRole('button').first()`;
    expect(
      tokenizeLocator(expr)
        .map((t) => t.text)
        .join(''),
    ).toBe(expr);
  });
});

describe('highlightLocator', () => {
  it('emits a token class per highlighted piece', () => {
    const html = highlightLocator(`getByRole('button', { name: 'Pay now', exact: true })`);
    expect(html).toContain(`<span class="piwi-tok-fn">getByRole</span>`);
    expect(html).toContain(`<span class="piwi-tok-str">'button'</span>`);
    expect(html).toContain(`<span class="piwi-tok-key">name</span>`);
    expect(html).toContain(`<span class="piwi-tok-lit">true</span>`);
  });

  it('escapes HTML-significant characters in string literals', () => {
    expect(highlightLocator(`getByText('<b>&amp;</b>')`)).toContain('&lt;b&gt;&amp;amp;&lt;/b&gt;');
  });
});

describe('LOCATOR_SYNTAX_CSS', () => {
  it('styles every token class in both color schemes', () => {
    for (const cls of ['piwi-tok-fn', 'piwi-tok-str', 'piwi-tok-key', 'piwi-tok-lit', 'piwi-tok-punc']) {
      expect(LOCATOR_SYNTAX_CSS).toContain(`.${cls} {`);
      expect(LOCATOR_SYNTAX_CSS).toContain(`.piwi-loc:not(.piwi-loc-dark) .${cls} {`);
    }
    expect(LOCATOR_SYNTAX_CSS).toContain('@media (prefers-color-scheme: light)');
  });
});
