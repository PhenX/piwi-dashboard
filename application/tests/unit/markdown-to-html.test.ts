import { describe, it, expect } from 'vitest';
import { escapeHtml, markdownToHtml } from '../../shared/markdown-to-html';

describe('escapeHtml', () => {
  it('neutralizes every character that can break out of markup', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;',
    );
  });

  it('escapes the ampersand first so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('markdownToHtml', () => {
  it('renders headings, lists and blockquotes', () => {
    const html = markdownToHtml(['## Title', '', '- one', '- two', '', '> quoted'].join('\n'));
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('quoted');
  });

  it('renders a fenced block with its language', () => {
    const html = markdownToHtml(['```ts', 'const a = 1;', '```'].join('\n'));
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('const a = 1;');
  });

  it('renders tables and emphasis, which the previous parser dropped', () => {
    const html = markdownToHtml(['| a | b |', '| - | - |', '| 1 | 2 |', '', '**bold**'].join('\n'));
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('escapes raw HTML in the source instead of passing it through', () => {
    const html = markdownToHtml('Normal\n\n<img src=x onerror=alert(1)>\n\n- <script>a</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;a&lt;/script&gt;');
  });

  it('escapes a code fence language so it cannot break the class attribute', () => {
    const html = markdownToHtml(['```ts"><script>', 'x', '```'].join('\n'));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;');
  });

  describe('link handling', () => {
    it('emits an anchor by default', () => {
      expect(markdownToHtml('[docs](https://example.com/a)')).toContain('<a href="https://example.com/a">docs</a>');
    });

    it('flattens links to text so an export keeps no outbound references', () => {
      const html = markdownToHtml('[docs](https://example.com/a)', { linkMode: 'text' });
      expect(html).not.toContain('<a ');
      expect(html).toContain('docs (https://example.com/a)');
    });

    // Overriding marked's link renderer bypasses its own URL cleaning, so the
    // protocol whitelist is ours to enforce.
    it.each([
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      'java script:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
    ])('renders %s inert in both modes', (href) => {
      for (const linkMode of ['anchor', 'text'] as const) {
        const out = markdownToHtml(`[click](${href})`, { linkMode });
        expect(out).not.toMatch(/href\s*=\s*["']?\s*(?:javascript|data|vbscript):/i);
        expect(out).not.toMatch(/<a\s/i);
      }
    });

    it('keeps relative and anchor links usable', () => {
      expect(markdownToHtml('[a](/docs)')).toContain('<a href="/docs">');
      expect(markdownToHtml('[a](#section)')).toContain('<a href="#section">');
      expect(markdownToHtml('[a](mailto:x@example.com)')).toContain('<a href="mailto:x@example.com">');
    });

    it('drops remote images in text mode, keeping the alt text', () => {
      const html = markdownToHtml('![a shot](https://example.com/x.png)', { linkMode: 'text' });
      expect(html).not.toContain('<img');
      expect(html).toContain('a shot');
    });
  });
});
