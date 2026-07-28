import { describe, it, expect } from 'vitest';
import { highlightLocator } from '../src/syntax-highlight.js';

describe('highlightLocator', () => {
  it('colors strings, method names, option keys, and literals', () => {
    const html = highlightLocator(`getByRole('button', { name: 'Pay now', exact: true })`);
    expect(html).toContain(`<span style="color:#c084fc">getByRole</span>`);
    expect(html).toContain(`<span style="color:#4ade80">'button'</span>`);
    expect(html).toContain(`<span style="color:#93c5fd">name</span>`);
    expect(html).toContain(`<span style="color:#fbbf24">true</span>`);
  });

  it('escapes HTML-significant characters in string literals', () => {
    expect(highlightLocator(`getByText('<b>&amp;</b>')`)).toContain('&lt;b&gt;&amp;amp;&lt;/b&gt;');
  });
});
