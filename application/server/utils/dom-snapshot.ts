/**
 * Failure-time DOM snapshot resolution over stored traces. The pure rendering
 * (`renderSnapshotHtml`/`extractDomSnapshot`) lives in the node-free
 * `dom-snapshot-render.ts` so the browser demo can reuse it; this module wires
 * it to node-only trace loading (storage + zlib via `trace-parser.ts`). No
 * re-exports: Nitro auto-imports every server/utils export, and duplicates
 * would shadow each other — import the pure API from `dom-snapshot-render.ts`
 * directly.
 */
import { loadAndParseTrace } from './trace-parser';
import {
  DOM_SNAPSHOT_CAP_CHARS,
  extractDomSnapshot,
  type DomSnapshotResult,
  type DomSnapshotSource,
} from './dom-snapshot-render';
// The ARIA-snapshot fallback renderer lives in its own node-free module so the
// browser demo can reuse it (the trace path above pulls in node-only zlib).
import { renderAriaSnapshotHtml } from './dom-snapshot-aria';

/** `extractDomSnapshot` over a stored (slim) trace blob. */
export async function getTraceDomSnapshot(blobPath: string, capChars: number): Promise<DomSnapshotResult> {
  const data = await loadAndParseTrace(blobPath);
  if (!data) return { status: 'no-trace' };
  return extractDomSnapshot(data, capChars);
}

/** Options for {@link resolveCaseDomSnapshot}. */
export interface ResolveCaseDomSnapshotOptions {
  /**
   * Which representation to render. Defaults to `dom` (trace-derived) when a
   * trace exists, falling back to `aria`. Pass `aria` to force the ARIA tree
   * even when a trace is available (the view toggle).
   */
  source?: DomSnapshotSource;
}

/**
 * Resolve the failure-time snapshot for a case. By default it prefers the
 * trace-derived DOM and falls back to the ARIA tree, but `source: 'aria'`
 * forces the ARIA tree even when a trace exists. The result reports which
 * representation it is (`source`) and every representation available for the
 * case (`availableSources`) so the UI can offer a view toggle. Shared by the
 * dom-snapshot endpoint and the interactive locator picker.
 */
export async function resolveCaseDomSnapshot(
  traceBlobPath: string | null | undefined,
  ariaSnapshot: string | null | undefined,
  capChars: number = DOM_SNAPSHOT_CAP_CHARS,
  options: ResolveCaseDomSnapshotOptions = {},
): Promise<DomSnapshotResult> {
  // Render the ARIA tree up front (cheap) so we can both offer it as a toggle
  // and serve it directly without parsing the trace when it's the one requested.
  const ariaHtml = ariaSnapshot ? renderAriaSnapshotHtml(ariaSnapshot) : null;
  let domAvailable = !!traceBlobPath;
  const ariaAvailable = !!ariaHtml;

  const sources = (): DomSnapshotSource[] => {
    const list: DomSnapshotSource[] = [];
    if (domAvailable) list.push('dom');
    if (ariaAvailable) list.push('aria');
    return list;
  };
  const asAria = (): DomSnapshotResult => ({
    status: 'ok',
    html: ariaHtml!,
    truncated: false,
    snapshotName: 'aria-fallback',
    source: 'aria',
    availableSources: sources(),
  });

  // Explicit ARIA request — skip the trace entirely.
  if (options.source === 'aria' && ariaHtml) return asAria();

  if (traceBlobPath) {
    const result = await getTraceDomSnapshot(traceBlobPath, capChars);
    if (result.status === 'ok' && result.html) {
      return { ...result, source: 'dom', availableSources: sources() };
    }
    // The trace produced no usable DOM — drop it as an option and fall back.
    domAvailable = false;
  }
  if (ariaHtml) return asAria();
  return { status: 'no-trace', availableSources: sources() };
}
