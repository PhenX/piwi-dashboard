/**
 * A tagged template that escapes every interpolation.
 *
 * Export reports render error text, console output, ARIA snapshots and page
 * source — all of it attacker-influenced. Escaping by default means a forgotten
 * call cannot open a hole: markup has to be opted into explicitly with `raw()`,
 * which is greppable in review.
 *
 *   html`<p>${untrusted}</p>`            escaped
 *   html`<div>${raw(alreadyMarkup)}</div>`  passed through
 */
import { escapeHtml } from '#shared/markdown-to-html';

const RAW = Symbol('raw-html');

export interface RawHtml {
  [RAW]: true;
  value: string;
}

/** Mark a string as already-safe markup so `html` does not escape it. */
export function raw(value: string): RawHtml {
  return { [RAW]: true, value };
}

function isRaw(value: unknown): value is RawHtml {
  return typeof value === 'object' && value !== null && (value as RawHtml)[RAW] === true;
}

function render(value: unknown): string {
  if (value == null || value === false) return '';
  if (isRaw(value)) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + (strings[i + 1] ?? '');
  }
  return raw(out);
}

/** Collapse a rendered fragment to its string form. */
export function toHtmlString(value: RawHtml | string): string {
  return typeof value === 'string' ? value : value.value;
}

/** Join fragments, dropping empty ones. */
export function joinHtml(parts: (RawHtml | string | null | undefined | false)[], separator = ''): RawHtml {
  return raw(
    parts
      .filter((p): p is RawHtml | string => Boolean(p))
      .map((p) => toHtmlString(p))
      .filter((s) => s.trim() !== '')
      .join(separator),
  );
}
