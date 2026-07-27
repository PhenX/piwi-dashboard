/**
 * Failure-time DOM snapshot resolution over stored traces. The pure rendering
 * (`renderSnapshotHtml`/`extractDomSnapshot`) lives in the node-free
 * `dom-snapshot-render.ts` so the browser demo can reuse it; this module wires
 * it to node-only trace loading (storage + zlib via `trace-parser.ts`). No
 * re-exports: Nitro auto-imports every server/utils export, and duplicates
 * would shadow each other — import the pure API from `dom-snapshot-render.ts`
 * directly.
 */
import { getStorage } from '../storage';
import { parseZip, type ZipEntry } from './trace-zip';
import { parseTraceTexts, parseResourceSnapshots, traceFileRank } from './trace-events';
import {
  DOM_SNAPSHOT_CAP_CHARS,
  extractDomSnapshot,
  collectStylesheetLinks,
  inlineStylesheets,
  type DomSnapshotResult,
  type DomSnapshotSource,
} from './dom-snapshot-render';
// The ARIA-snapshot fallback renderer lives in its own node-free module so the
// browser demo can reuse it (the trace path above pulls in node-only zlib).
import { renderAriaSnapshotHtml } from './dom-snapshot-aria';

/** Total inlined CSS budget and per-sheet ceiling — a broken app can ship huge bundles. */
const INLINE_STYLES_BUDGET = 2_000_000;
const MAX_STYLESHEET_BYTES = 1_000_000;

/** Resolve a `<link href>` (possibly relative) against the frame's document URL. */
function resolveResourceUrl(href: string, base: string | undefined): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * Inline the snapshot's external stylesheets from the trace's stored resources.
 * Maps each `<link href>` → absolute URL (via the frame's base) → content hash
 * (from the `.network` stream) → the CSS body stored under the project's
 * `trace-resources` pool. Purely additive: any missing piece leaves the `<link>`
 * untouched, so a page with unreachable CSS is no worse off than before.
 */
async function inlineTraceStylesheets(
  blobPath: string,
  entries: ZipEntry[],
  result: DomSnapshotResult,
): Promise<DomSnapshotResult> {
  if (result.status !== 'ok' || !result.html) return result;
  const hrefs = collectStylesheetLinks(result.html);
  if (hrefs.length === 0) return result;

  const networkTexts = entries.filter((e) => e.name.endsWith('.network')).map((e) => e.data.toString('utf8'));
  const urlToSha1 = parseResourceSnapshots(networkTexts);
  if (urlToSha1.size === 0) return result;

  // Resources live in a project-scoped shared pool; the id is in the blob path
  // (`project-<id>/blobs/<hash>.zip`).
  const projectId = /^project-(\d+)\//.exec(blobPath)?.[1];
  if (!projectId) return result;
  const resourcesDir = `project-${projectId}/trace-resources`;
  const storage = getStorage();

  const cssByHref: Record<string, string> = {};
  let budget = INLINE_STYLES_BUDGET;
  for (const href of hrefs) {
    if (budget <= 0) break;
    const abs = resolveResourceUrl(href, result.frameUrl);
    const sha1 = (abs ? urlToSha1.get(abs) : undefined) ?? urlToSha1.get(href);
    if (!sha1) continue;
    try {
      const bytes = await storage.readFile(`${resourcesDir}/${sha1}`);
      if (bytes.length === 0 || bytes.length > MAX_STYLESHEET_BYTES || bytes.length > budget) continue;
      cssByHref[href] = bytes.toString('utf8');
      budget -= bytes.length;
    } catch {
      // Resource missing/unreadable — leave the <link> as-is.
    }
  }
  if (Object.keys(cssByHref).length === 0) return result;
  return { ...result, html: inlineStylesheets(result.html, cssByHref, INLINE_STYLES_BUDGET) };
}

/** Options for {@link getTraceDomSnapshot}. */
export interface TraceDomSnapshotOptions {
  /** Inline external stylesheets from the trace's resources (the interactive picker only). */
  inlineStyles?: boolean;
}

/** `extractDomSnapshot` over a stored (slim) trace blob, optionally inlining external CSS. */
export async function getTraceDomSnapshot(
  blobPath: string,
  capChars: number,
  options: TraceDomSnapshotOptions = {},
): Promise<DomSnapshotResult> {
  let entries: ZipEntry[];
  try {
    const data = await getStorage().readFile(blobPath);
    entries = await parseZip(data);
  } catch {
    return { status: 'no-trace' };
  }
  const traceTexts = entries
    .filter((e) => e.name.endsWith('.trace'))
    .sort((a, b) => traceFileRank(a.name) - traceFileRank(b.name))
    .map((e) => e.data.toString('utf8'));
  if (traceTexts.length === 0) return { status: 'no-trace' };

  const result = extractDomSnapshot(parseTraceTexts(traceTexts), capChars);
  if (!options.inlineStyles) return result;
  try {
    return await inlineTraceStylesheets(blobPath, entries, result);
  } catch {
    // Inlining is best-effort decoration — never fail the snapshot over it.
    return result;
  }
}

/** Options for {@link resolveCaseDomSnapshot}. */
export interface ResolveCaseDomSnapshotOptions {
  /**
   * Which representation to render. Defaults to `dom` (trace-derived) when a
   * trace exists, falling back to `aria`. Pass `aria` to force the ARIA tree
   * even when a trace is available (the view toggle).
   */
  source?: DomSnapshotSource;
  /**
   * Inline external stylesheets from the trace so the snapshot renders styled.
   * Only the interactive picker requests this — the read-only DOM card shows the
   * HTML as text, where inlined bundles would just be noise.
   */
  inlineStyles?: boolean;
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
    const result = await getTraceDomSnapshot(traceBlobPath, capChars, { inlineStyles: options.inlineStyles });
    if (result.status === 'ok' && result.html) {
      return { ...result, source: 'dom', availableSources: sources() };
    }
    // The trace produced no usable DOM — drop it as an option and fall back.
    domAvailable = false;
  }
  if (ariaHtml) return asAria();
  return { status: 'no-trace', availableSources: sources() };
}
