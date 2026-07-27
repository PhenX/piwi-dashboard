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
 *
 * Node-free (pure rendering over already-parsed trace data) so the browser
 * demo can render the committed demo trace with the same code the server
 * uses; the node-only trace loading lives in `dom-snapshot.ts`.
 */
import type { ParsedTraceData, TraceFrameSnapshot } from './trace-events';

/**
 * Cap for the rendered snapshot HTML. Generous so a fully-styled snapshot
 * (inline CSS can run to a few hundred KB) fits; `extractDomSnapshot` drops
 * inline `<style>` only when a page exceeds it.
 */
export const DOM_SNAPSHOT_CAP_CHARS = 1_500_000;

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

/** Options controlling how much of the DOM survives rendering. */
export interface RenderOptions {
  /**
   * Drop the text body of inline `<style>` elements (the tag stays as a
   * marker). Inline CSS is the single biggest source of bloat — a framework's
   * inlined styles can run to hundreds of KB and push the real `<body>` past
   * the endpoint cap, leaving the snapshot blank. Off by default (full
   * fidelity); `extractDomSnapshot` turns it on only when a styled render would
   * be truncated. `<link>` stylesheets and inline `style=` attrs are always
   * kept, so pages with external CSS still render styled either way.
   */
  dropStyles?: boolean;
}

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
export function renderSnapshotHtml(
  snapshots: TraceFrameSnapshot[],
  snapshotName: string,
  options: RenderOptions = {},
): string | null {
  const { dropStyles = false } = options;
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

    // `<script>` bodies are always dropped (unsafe to re-emit); `<style>` bodies
    // are dropped only under the lean fallback. The tag stays as a marker.
    const dropBody = tagUpper === 'SCRIPT' || (dropStyles && tagUpper === 'STYLE');
    if (!dropBody) {
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
 * Mask token-shaped strings (base64 data URIs, JWTs, long hex blobs) in any
 * user-visible text extracted from a trace. Single masking source of truth,
 * shared by the DOM snapshot, network headers/bodies and AI-context sections.
 */
export function maskSensitiveText(text: string): string {
  return text
    .replace(DATA_URI_RE, 'data:[masked]')
    .replace(JWT_RE, '[masked-token]')
    .replace(LONG_HEX_RE, '[masked-hex]');
}

/**
 * Mask secrets in a CSS body destined for an inlined `<style>`, but leave
 * `data:` URIs alone — unlike {@link maskSensitiveText}. The picker deliberately
 * embeds fonts/images as base64 data URIs, so blanket data-URI masking would
 * wipe them out; token-shaped secrets (JWTs, long hex) are still scrubbed. Run
 * this AFTER assets are inlined so the fresh data URIs survive. Pure.
 */
export function maskCssText(css: string): string {
  return css.replace(JWT_RE, '[masked-token]').replace(LONG_HEX_RE, '[masked-hex]');
}

/**
 * Mask token-shaped strings and cap the rendered HTML. Pure and unit-testable.
 * The renderer already drops `__playwright_*` values, inline handlers, and
 * script bodies — this pass handles secrets baked into ordinary markup.
 */
export function sanitizeDomSnapshot(html: string, capChars: number): { html: string; truncated: boolean } {
  let out = maskSensitiveText(html);
  let truncated = false;
  if (capChars > 0 && out.length > capChars) {
    out = out.slice(0, capChars) + '\n<!-- [truncated] -->';
    truncated = true;
  }
  return { html: out, truncated };
}

/**
 * A `<link rel="stylesheet">` parsed out of rendered snapshot HTML: its original
 * `href` (the key a resource map is looked up by) and any `media` attribute.
 */
function parseStylesheetLink(tag: string): { href: string; media: string | null } | null {
  // rel may be quoted or bare and carry several tokens (`rel="preload stylesheet"`).
  if (!/\brel\s*=\s*("|')?[^"'>]*\bstylesheet\b/i.test(tag)) return null;
  const quoted = /\bhref\s*=\s*("|')(.*?)\1/i.exec(tag);
  const href = quoted ? quoted[2]! : (/\bhref\s*=\s*([^\s"'>]+)/i.exec(tag)?.[1] ?? null);
  if (!href) return null;
  const media = /\bmedia\s*=\s*("|')(.*?)\1/i.exec(tag)?.[2] ?? null;
  return { href, media };
}

/** Split a `url()` target into its resource path and any `#fragment` (SVG sprites). Pure. */
export function splitCssUrlFragment(ref: string): { path: string; fragment: string } {
  const hash = ref.indexOf('#');
  return hash >= 0 ? { path: ref.slice(0, hash), fragment: ref.slice(hash) } : { path: ref, fragment: '' };
}

/** Unique original hrefs of every `<link rel="stylesheet">` in the HTML. Pure. */
export function collectStylesheetLinks(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const link = parseStylesheetLink(m[0]);
    if (link && !seen.has(link.href)) {
      seen.add(link.href);
      out.push(link.href);
    }
  }
  return out;
}

/**
 * Replace external `<link rel="stylesheet">` elements whose CSS we have with an
 * inline `<style>`, so the snapshot renders styled inside the opaque-origin
 * picker iframe — where the original href (pointing at the long-gone test
 * server) can never load. `cssByHref` is keyed by each link's ORIGINAL href
 * attribute; links with no entry are left untouched (their href might still
 * resolve, and a broken link is no worse than before). `<style>` bodies are raw
 * text to the HTML parser, so a stray `</style` in the CSS is defanged here.
 *
 * The caller is responsible for scrubbing secrets from the CSS first (see
 * `maskCssText`): masking must run BEFORE any `url(...)` assets are embedded, or
 * it would shred the base64 data URIs it can't tell from real tokens.
 *
 * Inlining stops once `maxTotalChars` of CSS has been emitted; the remaining
 * links stay as-is rather than emit a half sheet. Pure and unit-testable.
 */
export function inlineStylesheets(html: string, cssByHref: Record<string, string>, maxTotalChars = 8_000_000): string {
  if (!html || Object.keys(cssByHref).length === 0) return html;
  let budget = maxTotalChars;
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    const link = parseStylesheetLink(tag);
    if (!link) return tag;
    const css = cssByHref[link.href];
    if (typeof css !== 'string' || css.length === 0 || css.length > budget) return tag;
    budget -= css.length;
    const media = link.media ? ` media="${escapeAttr(link.media)}"` : '';
    const safeCss = css.replace(/<\/(style)/gi, '<\\/$1');
    return `<style${media}>${safeCss}</style>`;
  });
}

// A `url(...)` target: single/double quoted (group 2) or bare (group 3).
const CSS_URL_RE = /url\(\s*(?:(['"])(.*?)\1|([^)\s'"]+))\s*\)/gi;

/**
 * Every distinct `url(...)` target in a CSS body worth resolving — quotes
 * stripped, and already-inline (`data:`) / in-document (`#id`) refs skipped.
 * Pure; the caller resolves each against the stylesheet's own URL.
 */
export function collectCssUrls(css: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(CSS_URL_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const raw = (m[2] ?? m[3] ?? '').trim();
    // Skip already-inline data: URIs and in-document refs (`url(#blur)` filters,
    // `url(#gradient)`). A `sprite.svg#icon` ref keeps its fragment — the caller
    // embeds the file and re-appends `#icon` to the data: URI.
    if (!raw || raw.startsWith('data:') || raw.startsWith('#')) continue;
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

/**
 * Rewrite every `url(...)` whose target appears in `replacements` (keyed by the
 * raw target) to the replacement, double-quoted. Used to swap external asset
 * refs for `data:` URIs so fonts / background images render offline. Targets
 * with no replacement are left untouched. Pure.
 */
export function inlineCssUrls(css: string, replacements: Record<string, string>): string {
  if (!css || Object.keys(replacements).length === 0) return css;
  return css.replace(new RegExp(CSS_URL_RE.source, 'gi'), (full, _q, quoted, bare) => {
    const raw = (quoted ?? bare ?? '').trim();
    const repl = replacements[raw];
    return repl ? `url("${repl}")` : full;
  });
}

/** The two representations a case can be viewed as: trace-derived DOM or the ARIA tree. */
export type DomSnapshotSource = 'dom' | 'aria';

export interface DomSnapshotResult {
  status: 'ok' | 'no-trace' | 'no-snapshot';
  html?: string;
  truncated?: boolean;
  /** Which snapshot was rendered (e.g. `before@call@12`). */
  snapshotName?: string;
  /** The failing action the snapshot belongs to, when identified. */
  action?: string;
  /** The recorded page viewport, for proportion-preserving scaled rendering. */
  viewport?: { width: number; height: number };
  /** The rendered frame's document URL — the base for resolving `<link href>` when inlining stylesheets. */
  frameUrl?: string;
  /** Which representation `html` is — the trace DOM (`dom`) or the ARIA tree (`aria`). */
  source?: DomSnapshotSource;
  /**
   * Which representations exist for this case, so the UI can offer a toggle
   * (e.g. view the ARIA tree even when a trace was uploaded).
   */
  availableSources?: DomSnapshotSource[];
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
    // Full-fidelity first (inline <style> kept). If keeping styles blows the
    // cap the real <body> can get truncated away, so re-render lean (inline
    // CSS dropped) — that reliably fits and preserves the whole DOM.
    const styled = renderSnapshotHtml(data.frameSnapshots, name);
    if (!styled) continue;
    let result = sanitizeDomSnapshot(styled, capChars);
    if (result.truncated) {
      const lean = renderSnapshotHtml(data.frameSnapshots, name, { dropStyles: true });
      if (lean) result = sanitizeDomSnapshot(lean, capChars);
    }
    // The viewport of the snapshot we rendered (main frame preferred, mirroring
    // renderSnapshotHtml) so the client can render it at its true proportions.
    const rendered =
      data.frameSnapshots.find((s) => s.snapshotName === name && s.isMainFrame !== false) ??
      data.frameSnapshots.find((s) => s.snapshotName === name);
    return {
      status: 'ok',
      html: result.html,
      truncated: result.truncated,
      snapshotName: name,
      action: fa?.apiName,
      viewport: rendered?.viewport,
      frameUrl: rendered?.frameUrl,
    };
  }
  return { status: 'no-snapshot' };
}
