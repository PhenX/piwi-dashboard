/**
 * Syntax-highlight a Playwright locator expression to inline-styled HTML —
 * method purple, option keys blue, strings green, literals amber, punctuation
 * muted. A normally-importable twin of the nested copies inside
 * `overlay-element.ts` and `overlay-confirm.ts`: those two must stay
 * self-contained (each is independently re-serialized via
 * `Function.prototype.toString()`), so they can't import this — but a host
 * that consumes picker-dom through normal bundling (no serialization
 * boundary) can.
 */
export function highlightLocator(expr: string): string {
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re =
    /('(?:\\.|[^'])*'|"(?:\\.|[^"])*")|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)(?=\s*:)|(true|false|null|\d+)|([{}(),.])/g;
  let html = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    if (m.index > last) html += escHtml(expr.slice(last, m.index));
    const color = m[1] ? '#4ade80' : m[2] ? '#c084fc' : m[3] ? '#93c5fd' : m[4] ? '#fbbf24' : '#9ca3af';
    html += `<span style="color:${color}">${escHtml(m[0])}</span>`;
    last = re.lastIndex;
  }
  if (last < expr.length) html += escHtml(expr.slice(last));
  return html;
}
