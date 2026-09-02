import { describe, it, expect } from 'vitest';
import { highlightCode, isKnownLanguage } from '../../shared/highlight';

describe('highlightCode', () => {
  it.each(['typescript', 'javascript', 'json', 'diff', 'yaml', 'bash', 'css', 'xml', 'python'])('knows %s', (lang) => {
    expect(isKnownLanguage(lang)).toBe(true);
  });

  it.each(['ts', 'js', 'sh', 'yml', 'html'])('accepts the %s alias the codebase writes in fences', (alias) => {
    expect(isKnownLanguage(alias)).toBe(true);
  });

  // ARIA snapshots are passed as ```yaml from several call sites; before this
  // module they fell through to auto-detection because no consumer registered it.
  it('highlights an ARIA snapshot as yaml rather than guessing', () => {
    const result = highlightCode('- button "Pay now"\n- link "Home"', 'yaml');
    expect(result.language).toBe('yaml');
    expect(result.html).toContain('hljs-');
  });

  it('marks additions and deletions in a diff', () => {
    const { html } = highlightCode('--- a/x.ts\n+++ b/x.ts\n-const a = 1;\n+const a = 2;', 'diff');
    expect(html).toContain('hljs-deletion');
    expect(html).toContain('hljs-addition');
  });

  it('emits token spans for typescript', () => {
    const { html } = highlightCode("const greeting: string = 'hi';", 'typescript');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-string');
  });

  describe('safety', () => {
    // The result is injected with v-html and raw(), so escaping is the module's job.
    it('escapes markup in highlighted source', () => {
      const { html } = highlightCode('const x = "<script>alert(1)</script>";', 'typescript');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    // Auto-detection may tokenize the source *as* HTML, splitting `&lt;` from
    // the tag name across spans. The property that matters is that the only
    // real tags in the output are highlight.js's own.
    it('emits no tags of its own beyond hljs spans', () => {
      const { html } = highlightCode('<img src=x onerror=alert(1)>');
      const withoutHljsSpans = html.replace(/<span class="hljs-[\w-]+">/g, '').replace(/<\/span>/g, '');
      expect(withoutHljsSpans).not.toMatch(/<[a-z]/i);
      expect(withoutHljsSpans).toContain('&lt;img');
    });

    it('escapes markup in a block too large to auto-detect', () => {
      const big = '<script>alert(1)</script>\n' + 'x'.repeat(200_000);
      const { html, language } = highlightCode(big);
      expect(language).toBe('');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes markup for an unknown language', () => {
      const { html } = highlightCode('<b>x</b>', 'not-a-language');
      expect(html).not.toContain('<b>');
    });
  });

  it('does not throw on source that violates its grammar', () => {
    expect(() => highlightCode('function ( { unbalanced', 'typescript')).not.toThrow();
  });

  it('returns empty output for empty input', () => {
    expect(highlightCode('', 'typescript').html).toBe('');
  });
});
