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
 * The `<script>` tag to append to the snapshot HTML — it runs the serialized
 * picker with `config`. `</script>` in the source is escaped so a stray one in
 * the (constant) body can't close the tag early.
 */
export function snapshotPickerScriptTag(config: SnapshotPickerConfig): string {
  const src = String(installSnapshotPicker).replace(/<\/(script)/gi, '<\\/$1');
  return `<script>(${src})(${JSON.stringify(config)})</script>`;
}

/** Strip `<base>` so the snapshot's relative subresources can't be redirected to the tested app. */
export function stripBaseTag(html: string): string {
  return html.replace(/<base\b[^>]*>/gi, '');
}

/** Build the full blob HTML: the snapshot with `<base>` stripped, plus the appended picker script. */
export function buildPickerDocument(html: string, config: SnapshotPickerConfig): string {
  return stripBaseTag(html) + snapshotPickerScriptTag(config);
}
