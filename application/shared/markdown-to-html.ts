/**
 * Minimal Markdown → HTML renderer for generated reports and clipboard exports.
 *
 * Covers the subset AI diagnoses and export reports actually emit: headings,
 * fenced code, unordered lists, blockquotes and paragraphs. Every interpolated
 * value is escaped, so untrusted text (error messages, console output, test
 * source) is safe to render into a standalone document.
 */

/** Escape the five characters that can break out of HTML text or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';
  const codeLines: string[] = [];
  let inList = false;

  function flushCode() {
    if (codeLines.length) {
      const langTag = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : '';
      out.push(`<pre><code${langTag}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      codeLines.length = 0;
    }
    codeLang = '';
  }

  function closeList() {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  }

  for (const line of md.split('\n')) {
    if (line.startsWith('```')) {
      closeList();
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushCode();
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith('## ')) {
      out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('### ')) {
      out.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith('> ')) {
      out.push(`<blockquote>${escapeHtml(line.slice(2))}</blockquote>`);
      continue;
    }
    if (line.trim() === '') {
      out.push('<br>');
      continue;
    }
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  if (inCode) flushCode();
  return out.join('\n');
}
