/**
 * Trace-derived DOM snapshot: render Playwright's serialized `frame-snapshot`
 * node arrays back into sanitized HTML. The DOM is never captured by the
 * reporter — it is extracted lazily from the trace ZIPs already in storage,
 * so richer failure evidence costs zero extra upload bytes.
 *
 * Format (Playwright-internal, version-sensitive — everything here is
 * best-effort and degrades to placeholders/null, never throws):
 *  - element: `[TAGNAME, {attrs}, ...children]` (children always from index 2)
 *  - text: plain string
 *  - back-reference: `[[snapshotsAgo, nodeIndex]]` — the node at `nodeIndex`
 *    in the post-order node list of the snapshot `snapshotsAgo` earlier in the
 *    same frame's snapshot sequence
 */
import { loadAndParseTrace, type ParsedTraceData, type TraceFrameSnapshot } from './trace-parser';

const VOID_ELEMENTS = new Set([
  'AREA',
  'BASE',
  'BR',
  'COL',
  'EMBED',
  'HR',
  'IMG',
  'INPUT',
  'LINK',
  'META',
  'SOURCE',
  'TRACK',
  'WBR',
]);

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Post-order node list of one snapshot's tree — the indexing space that
 * back-references point into. Ref nodes are neither descended nor indexed
 * (mirrors Playwright's snapshotNodes).
 */
function collectNodes(html: unknown): unknown[] {
  const nodes: unknown[] = [];
  const visit = (n: unknown) => {
    if (typeof n === 'string') {
      nodes.push(n);
    } else if (Array.isArray(n) && typeof n[0] === 'string') {
      for (let i = 2; i < n.length; i++) visit(n[i]);
      nodes.push(n);
    }
  };
  visit(html);
  return nodes;
}

/**
 * Render one named snapshot to an HTML string, resolving back-references
 * against the earlier snapshots of the same frame. Returns null when the
 * snapshot is missing or the tree is entirely unrenderable.
 */
export function renderSnapshotHtml(snapshots: TraceFrameSnapshot[], snapshotName: string): string | null {
  const target =
    snapshots.find((s) => s.snapshotName === snapshotName && s.isMainFrame !== false) ??
    snapshots.find((s) => s.snapshotName === snapshotName);
  if (!target || target.html === undefined) return null;

  const frameList = snapshots.filter((s) => s.frameId === target.frameId);
  const targetIndex = frameList.indexOf(target);

  const nodeListCache = new Map<number, unknown[]>();
  const nodesOf = (snapshotIndex: number): unknown[] => {
    let cached = nodeListCache.get(snapshotIndex);
    if (!cached) {
      cached = collectNodes(frameList[snapshotIndex]!.html);
      nodeListCache.set(snapshotIndex, cached);
    }
    return cached;
  };

  const render = (n: unknown, snapshotIndex: number): string => {
    if (typeof n === 'string') return escapeText(n);
    if (!Array.isArray(n) || n.length === 0) return '';

    // Back-reference: resolve into the earlier snapshot's node space and keep
    // rendering in THAT snapshot's context (its own refs go further back).
    if (Array.isArray(n[0])) {
      const ref = n[0] as unknown[];
      const delta = typeof ref[0] === 'number' ? ref[0] : NaN;
      const nodeIndex = typeof ref[1] === 'number' ? ref[1] : NaN;
      const refSnapshotIndex = snapshotIndex - delta;
      if (!Number.isInteger(refSnapshotIndex) || refSnapshotIndex < 0 || refSnapshotIndex >= snapshotIndex) {
        return '<!-- [unresolved snapshot reference] -->';
      }
      const refNodes = nodesOf(refSnapshotIndex);
      if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= refNodes.length) {
        return '<!-- [unresolved snapshot reference] -->';
      }
      return render(refNodes[nodeIndex], refSnapshotIndex);
    }

    if (typeof n[0] !== 'string') return '';
    const tagUpper = n[0] as string;
    const tag = tagUpper.toLowerCase();

    let out = `<${tag}`;
    const attrs = n[1];
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
      for (const [name, value] of Object.entries(attrs as Record<string, unknown>)) {
        // __playwright_* bookkeeping attrs carry live input values and
        // scroll/selection state — never surfaced (secret-leak posture).
        if (name.startsWith('__playwright')) continue;
        // Inline handlers are noise for diagnosis and unsafe to re-emit.
        if (/^on[a-z]/i.test(name)) continue;
        out += ` ${name}="${escapeAttr(String(value))}"`;
      }
    }
    out += '>';
    if (VOID_ELEMENTS.has(tagUpper)) return out;

    // Script bodies are dropped at the source; the tag stays as a marker.
    if (tag !== 'script') {
      for (let i = 2; i < n.length; i++) out += render(n[i], snapshotIndex);
    }
    return `${out}</${tag}>`;
  };

  try {
    const body = render(target.html, targetIndex);
    if (!body) return null;
    const doctype = target.doctype ? `<!DOCTYPE ${target.doctype}>\n` : '';
    return doctype + body;
  } catch {
    return null;
  }
}

const DATA_URI_RE = /\bdata:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const JWT_RE = /\beyJ[\w-]{10,}\.[\w-]{5,}\.[\w-]{5,}\b/g;
const LONG_HEX_RE = /\b[0-9a-f]{32,}\b/gi;

/**
 * Mask token-shaped strings and cap the rendered HTML. Pure and unit-testable.
 * The renderer already drops `__playwright_*` values, inline handlers, and
 * script bodies — this pass handles secrets baked into ordinary markup.
 */
export function sanitizeDomSnapshot(html: string, capChars: number): { html: string; truncated: boolean } {
  let out = html
    .replace(DATA_URI_RE, 'data:[masked]')
    .replace(JWT_RE, '[masked-token]')
    .replace(LONG_HEX_RE, '[masked-hex]');
  let truncated = false;
  if (capChars > 0 && out.length > capChars) {
    out = out.slice(0, capChars) + '\n<!-- [truncated] -->';
    truncated = true;
  }
  return { html: out, truncated };
}

export interface DomSnapshotResult {
  status: 'ok' | 'no-trace' | 'no-snapshot';
  html?: string;
  truncated?: boolean;
  /** Which snapshot was rendered (e.g. `before@call@12`). */
  snapshotName?: string;
  /** The failing action the snapshot belongs to, when identified. */
  action?: string;
}

/**
 * Pick and render the failure-time DOM from parsed trace data: the failing
 * action's before-snapshot, falling back to its after-snapshot and finally the
 * frame's last recorded snapshot (final page state).
 */
export function extractDomSnapshot(data: ParsedTraceData, capChars: number): DomSnapshotResult {
  if (data.frameSnapshots.length === 0) return { status: 'no-snapshot' };

  const fa = data.failingAction;
  const candidates = [fa?.beforeSnapshot, fa?.snapshotName, fa?.afterSnapshot].filter((name): name is string => !!name);
  // Final fallback: the last main-frame snapshot in the trace.
  const mains = data.frameSnapshots.filter((s) => s.isMainFrame !== false && s.snapshotName);
  const last = mains[mains.length - 1];
  if (last?.snapshotName && !candidates.includes(last.snapshotName)) candidates.push(last.snapshotName);

  for (const name of candidates) {
    const rendered = renderSnapshotHtml(data.frameSnapshots, name);
    if (rendered) {
      const { html, truncated } = sanitizeDomSnapshot(rendered, capChars);
      return { status: 'ok', html, truncated, snapshotName: name, action: fa?.apiName };
    }
  }
  return { status: 'no-snapshot' };
}

/** `extractDomSnapshot` over a stored (slim) trace blob. */
export async function getTraceDomSnapshot(blobPath: string, capChars: number): Promise<DomSnapshotResult> {
  const data = await loadAndParseTrace(blobPath);
  if (!data) return { status: 'no-trace' };
  return extractDomSnapshot(data, capChars);
}
