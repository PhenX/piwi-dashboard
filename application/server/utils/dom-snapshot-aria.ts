/**
 * ARIA-snapshot fallback rendering — the DOM view for executions with no stored
 * trace (only the captured ARIA tree). Kept in its own module (no node-only
 * imports) so the browser demo can render it too: the trace path in
 * `dom-snapshot.ts` pulls in node-only zlib, but this renderer needs nothing
 * beyond `parseAriaCandidates`. `dom-snapshot.ts` re-exports it, so server
 * callers are unchanged.
 */
import { parseAriaCandidates } from '#shared/locator-fingerprint';

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** Role → inline chip style for the ARIA-snapshot fallback rendering. */
const ARIA_ROLE_COLORS: Record<string, string> = {
  button: 'background:#dbeafe;color:#1e40af',
  link: 'background:#dbeafe;color:#1e40af',
  heading: 'background:#f3e8ff;color:#6b21a8;font-weight:600',
  textbox: 'background:#dcfce7;color:#166534',
  searchbox: 'background:#dcfce7;color:#166534',
  combobox: 'background:#dcfce7;color:#166534',
  listbox: 'background:#dcfce7;color:#166534',
  spinbutton: 'background:#dcfce7;color:#166534',
  checkbox: 'background:#fef3c7;color:#92400e',
  radio: 'background:#fef3c7;color:#92400e',
  switch: 'background:#fef3c7;color:#92400e',
  navigation: 'background:#f1f5f9;color:#334155;border:1px dashed #cbd5e1',
  main: 'background:#f1f5f9;color:#334155;border:1px dashed #cbd5e1',
  region: 'background:#f1f5f9;color:#334155;border:1px dashed #cbd5e1',
  form: 'background:#f1f5f9;color:#334155;border:1px dashed #cbd5e1',
  article: 'background:#f1f5f9;color:#334155;border:1px dashed #cbd5e1',
  img: 'background:#fce7f3;color:#9d174d',
  listitem: 'background:#f8fafc;color:#475569',
  tab: 'background:#e0e7ff;color:#3730a3',
  tabpanel: 'background:#f5f3ff;color:#5b21b6',
  menuitem: 'background:#f8fafc;color:#475569',
  option: 'background:#f8fafc;color:#475569',
  table: 'background:#f1f5f9;color:#334155',
  rowgroup: 'background:#f8fafc;color:#475569',
  row: 'background:#f8fafc;color:#475569',
  columnheader: 'background:#e0e7ff;color:#3730a3',
  cell: 'background:#f8fafc;color:#475569',
  separator: 'background:transparent;color:#888',
};

/**
 * Render a Playwright ARIA snapshot to a standalone HTML document — the
 * fallback for executions with no stored trace (only the captured ARIA tree).
 * Each accessibility node becomes a role-colored chip carrying its `data-role`/
 * `data-name`. Returns null when the snapshot yields no candidates.
 *
 * The accessible name is untrusted (tested-page DOM) and this HTML is loaded
 * into a same-origin iframe, so it is escaped in both attribute and text
 * contexts to prevent markup injection / XSS.
 */
export function renderAriaSnapshotHtml(ariaSnapshot: string): string | null {
  const candidates = parseAriaCandidates(ariaSnapshot);
  if (candidates.length === 0) return null;

  let body = '';
  for (const c of candidates) {
    const style = ARIA_ROLE_COLORS[c.role] ?? 'background:transparent;color:#888';
    // The name is used in both an attribute and text, so escape all four
    // metacharacters (& < > ") — safe in either context.
    const name = c.name ? escapeText(c.name).replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
    const label = c.name ? `${c.role} "${name}"` : c.role;
    const levelAttr = c.level != null ? ` data-level="${c.level}"` : '';
    body +=
      `<div data-role="${c.role}" data-name="${name}"${levelAttr} ` +
      `style="${style};padding:3px 6px;margin:1px 0;border-radius:3px;white-space:nowrap;` +
      `display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis">${label}</div>\n`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body{margin:0;padding:8px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.8;color:#111;background:#fff}
  @media(prefers-color-scheme:dark){body{color:#e5e5e5;background:#1a1a1a}}
  [data-role]:hover{filter:brightness(.92);outline:1px solid rgba(124,58,237,.4)}
</style></head>
<body>${body}</body></html>`;
}
