/**
 * Host-side helpers for the DOM-snapshot locator picker: deriving highlight
 * hints, and assembling the hardened iframe document.
 *
 * The snapshot loads into a sandboxed iframe — `sandbox="allow-scripts"` with NO
 * `allow-same-origin`, i.e. an opaque origin — with the picker overlay appended
 * as a `<script>` (see `snapshot-picker-overlay.ts`). The picker can touch only
 * its own document and talks to the host purely over `postMessage`, so a
 * sanitizer bypass in the rendered snapshot can't reach the dashboard's
 * cookies, storage, or API. `<base>` is stripped so the snapshot's relative
 * subresources can't be redirected to the tested app.
 */

import type { RankedLocator } from '#shared/locator-healing.types';
import { installSnapshotPicker } from './snapshot-picker-overlay';

/** Configuration handed to the serialized picker (the only bridge into it). */
export interface SnapshotPickerConfig {
  /** Attribute whitelist to probe — the shared `CAPTURED_ATTRIBUTES`. */
  probedAttrs: string[];
}

/** A text hint the in-iframe picker highlights on open. */
export interface PickerHint {
  text: string;
}

/**
 * Search hints for pre-highlighting the element the failing locator meant to
 * hit: the failing locator's own name/text, then any element-match / ARIA
 * candidate names. Deduped (case-insensitively), trimmed, and capped. Pure so it
 * can be unit-tested; the picker posts the result into the iframe after ready.
 */
export function deriveHighlightHints(input: {
  failingLocator?: { method: string; args: Record<string, unknown> } | null;
  fromElementMatch?: RankedLocator[] | null;
  fromAriaSnapshot?: RankedLocator[] | null;
}): PickerHint[] {
  const out: PickerHint[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const text = value.trim();
    if (text.length < 2 || text.length > 80) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text });
  };
  const nameOf = (args: Record<string, unknown> | undefined): unknown =>
    args && (args.name ?? args.text ?? args.label ?? args.placeholder ?? args.alt ?? args.title);

  push(nameOf(input.failingLocator?.args));
  for (const a of input.fromElementMatch ?? []) push(nameOf(a.args));
  for (const a of input.fromAriaSnapshot ?? []) push(nameOf(a.args));
  return out.slice(0, 6);
}

/**
 * The `<script>` tag that runs the serialized picker with `config`. `</script>`
 * in the source is escaped so a stray one in the (constant) body can't close the
 * tag early. Installation is deferred to `DOMContentLoaded`: the tag sits at the
 * FRONT of the document (see `buildPickerDocument`), so it runs before the
 * snapshot body is parsed, and by DOMContentLoaded the parser has built
 * `document.body` — even for a truncated snapshot that never closes its tags.
 */
export function snapshotPickerScriptTag(config: SnapshotPickerConfig): string {
  const src = String(installSnapshotPicker).replace(/<\/(script)/gi, '<\\/$1');
  const invoke = `(${src})(${JSON.stringify(config)})`;
  return (
    `<script>(function(){var run=function(){${invoke}};` +
    `if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',run)}else{run()}})()</script>`
  );
}

/** Strip `<base>` so the snapshot's relative subresources can't be redirected to the tested app. */
export function stripBaseTag(html: string): string {
  return html.replace(/<base\b[^>]*>/gi, '');
}

const DOCTYPE_RE = /^\s*<!doctype[^>]*>/i;

/**
 * Build the full blob HTML: the snapshot with `<base>` stripped, with the picker
 * script placed at the FRONT (right after any doctype) rather than appended.
 *
 * A large snapshot is truncated at a hard character cap and can end mid-tag or
 * inside a `<style>`; a trailing `<script>` would then be swallowed as attribute
 * text or stylesheet text and never execute, leaving the page fully interactive.
 * Parsed first, the (DOMContentLoaded-deferred) picker always installs, so the
 * snapshot is reliably inert regardless of how mangled its markup is.
 */
export function buildPickerDocument(html: string, config: SnapshotPickerConfig): string {
  const stripped = stripBaseTag(html);
  const doctype = DOCTYPE_RE.exec(stripped);
  const head = doctype ? doctype[0] : '';
  const body = doctype ? stripped.slice(doctype[0].length) : stripped;
  return head + snapshotPickerScriptTag(config) + body;
}
