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
    const html = markdownToHtml(['## Title', '### Sub', '- one', '- two', '> quoted'].join('\n'));
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<h3>Sub</h3>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('</ul>');
    expect(html).toContain('<blockquote>quoted</blockquote>');
  });

  it('renders a fenced block with its language and closes it', () => {
    const html = markdownToHtml(['```ts', 'const a = 1;', '```'].join('\n'));
    expect(html).toContain('<pre><code class="language-ts">const a = 1;</code></pre>');
  });

  it('closes an unterminated fence rather than dropping its content', () => {
    expect(markdownToHtml(['```', 'dangling'].join('\n'))).toContain('<pre><code>dangling</code></pre>');
  });

  it('escapes markup inside code, list items and paragraphs', () => {
    const html = markdownToHtml(['- <script>a</script>', '', '```', '<script>b</script>', '```', 'c < d'].join('\n'));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;a&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;b&lt;/script&gt;');
    expect(html).toContain('c &lt; d');
  });

  it('escapes a code fence language so it cannot break the class attribute', () => {
    const html = markdownToHtml(['```ts"><script>', 'x', '```'].join('\n'));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;');
  });
});
