import type { ProbeArg } from './types.js';

/** Configuration for `installPickerOverlay` — see the function doc for the transport split. */
export interface PickerOverlayArg {
  transport: 'global' | 'postMessage';
  /** Rendered failing locator for the banner heading (`'global'` transport only). */
  failing?: string | null;
  /** Probe arguments for the inline probe the `'postMessage'` transport performs on pick. */
  probeArg?: ProbeArg;
}

/**
 * Runs inside the browser — installs the element-picking overlay: a hover
 * highlight, an instruction banner, and capture-phase listeners that suppress
 * the app's own handlers while picking. The hover target snaps to the nearest
 * actionable ancestor (button/link/field/role/testid) and up/down walk the DOM
 * chain before the click commits.
 *
 * `transport` picks how a pick/skip is reported, since the two hosts cross
 * fundamentally different boundaries:
 *  - `'global'` — the reporter drives a live page from Node over CDP. The
 *    picked element is parked on `globalThis.__piwiPickedElement` and
 *    `__piwiPickState` is set to `'picked'`/`'skipped'`, polled from Node;
 *    probing happens later, from Node, against a live element handle.
 *  - `'postMessage'` — the snapshot picker runs standalone inside a sandboxed
 *    opaque-origin iframe with nothing outside able to reach in, so the pick
 *    is probed and posted to `window.parent` in the same tick. The probe
 *    itself can't be imported (a serialized function carries no imports), so
 *    the embedding host installs it on `globalThis.__piwiProbe` before
 *    invoking this function, and may install lifecycle hooks on
 *    `globalThis.__piwiSnapshotExtras` (`onPick`/`onClose`) for its own
 *    snapshot-only chrome (search, highlight hints, extended inertness).
 *
 * Must stay fully self-contained (no module-closure references) — both hosts
 * re-serialize this function via `Function.prototype.toString()` (the
 * reporter through `page.evaluate`, the snapshot picker through `String()`
 * into a `<script>` tag).
 */
export function installPickerOverlay(arg: PickerOverlayArg): void {
  const g = globalThis as any;
  const doc = g.document;
  if (!doc || !doc.body) {
    if (arg.transport === 'postMessage') g.parent.postMessage({ type: 'pickerClosed' }, '*');
    else g.__piwiPickState = 'skipped';
    return;
  }
  const Z = 2147483600;

  const highlight = doc.createElement('div');
  highlight.id = '__piwi_picker_highlight';
  highlight.style.cssText =
    `position:fixed;pointer-events:none;z-index:${Z};display:none;box-sizing:border-box;` +
    'border:2px solid #7c3aed;background:rgba(124,58,237,.12);border-radius:3px;';
  const banner = doc.createElement('div');
  banner.id = '__piwi_picker_banner';
  banner.style.cssText =
    `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:${Z + 2};` +
    'background:#111827;color:#f9fafb;font:13px/1.5 system-ui,sans-serif;' +
    'padding:10px 16px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:80vw;';
  // Syntax-highlight a Playwright locator expression to inline-styled HTML —
  // method purple, option keys blue, strings green, literals amber, punctuation
  // muted. Nested rather than imported, and kept in sync by hand with the copy
  // in overlay-confirm.ts: both must stay self-contained, since each is
  // serialized independently.
  const hlLocator = (expr: string): string => {
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
    return `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${html}</code>`;
  };
  const head = doc.createElement('div');
  head.innerHTML =
    arg.transport === 'postMessage'
      ? 'Click an element to generate locators'
      : arg.failing
        ? `Piwi locator picker — click the element that should replace ${hlLocator(arg.failing)}`
        : 'Piwi inspector — click any element to generate locators for it';
  const foot = doc.createElement('div');
  foot.id = '__piwi_picker_foot';
  foot.style.cssText = 'color:#9ca3af;margin-top:3px;';
  foot.textContent = '↑ parent · ↓ child · Esc skip';
  banner.appendChild(head);
  banner.appendChild(foot);
  doc.body.appendChild(highlight);
  doc.body.appendChild(banner);

  // Short descriptor of an element for the banner breadcrumb.
  const escJs = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const describe = (el: any): string => {
    const tag = (el.tagName || '?').toLowerCase();

    const testId = el.getAttribute && el.getAttribute('data-testid');
    if (testId) return `getByTestId('${escJs(testId)}')`;

    if (el.labels && el.labels.length > 0) {
      const labelText = (el.labels[0].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (labelText) return `getByLabel('${escJs(labelText)}')`;
    }

    const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
    if (ariaLabel) return `getByLabel('${escJs(ariaLabel)}')`;

    const placeholder = el.getAttribute && el.getAttribute('placeholder');
    if (placeholder) return `getByPlaceholder('${escJs(placeholder)}')`;

    const alt = el.getAttribute && el.getAttribute('alt');
    if (alt) return `getByAltText('${escJs(alt)}')`;

    const titleAttr = el.getAttribute && el.getAttribute('title');
    if (titleAttr) return `getByTitle('${escJs(titleAttr)}')`;

    if (el.id) return `locator('#${escJs(el.id)}')`;

    const cls = ((el.getAttribute && el.getAttribute('class')) || '').split(/\s+/).find((c: string) => c.length > 1);
    return cls ? `locator('.${escJs(cls)}')` : tag;
  };

  // The hover chain: raw target up to (not including) body, capped.
  const buildChain = (raw: any): any[] => {
    const chain: any[] = [];
    let node = raw;
    while (node && chain.length < 15) {
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'body' || tag === 'html') break;
      chain.push(node);
      node = node.parentElement;
    }
    return chain.length ? chain : [raw];
  };

  // Snap the initial pick to the nearest actionable ancestor — a click lands
  // on the <span> inside a button, but the button is what the test targets.
  const ACTIONABLE_TAGS = ['button', 'a', 'input', 'select', 'textarea', 'summary', 'option'];
  const snapIndex = (chain: any[]): number => {
    for (let i = 0; i < Math.min(chain.length, 4); i++) {
      const el = chain[i];
      const tag = (el.tagName || '').toLowerCase();
      if (ACTIONABLE_TAGS.includes(tag)) return i;
      if (el.getAttribute && (el.getAttribute('role') || el.getAttribute('data-testid'))) return i;
    }
    return 0;
  };

  let chain: any[] = [];
  let idx = 0;
  let lastRaw: any = null;

  const current = (): any => chain[idx] ?? null;
  const refresh = () => {
    const el = current();
    if (!el) {
      highlight.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left = r.left + 'px';
    highlight.style.top = r.top + 'px';
    highlight.style.width = r.width + 'px';
    highlight.style.height = r.height + 'px';
    foot.textContent = `${describe(el)} — click to pick · ↑ parent · ↓ child · Esc skip`;
  };

  const stop = (e: any) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const isOwn = (el: any) =>
    el === banner || el === highlight || (banner.contains && banner.contains(el)) || !!(el && el.__piwiHint);
  let bannerDocked: 'top' | 'bottom' = 'top';
  const dockBanner = (side: 'top' | 'bottom') => {
    if (bannerDocked === side) return;
    bannerDocked = side;
    if (side === 'bottom') {
      banner.style.top = 'auto';
      banner.style.bottom = '12px';
    } else {
      banner.style.top = '12px';
      banner.style.bottom = 'auto';
    }
  };
  const onMove = (e: any) => {
    const raw = e.target;
    if (!raw || isOwn(raw)) {
      highlight.style.display = 'none';
      return;
    }
    if (raw !== lastRaw) {
      lastRaw = raw;
      chain = buildChain(raw);
      idx = snapIndex(chain);
    }
    refresh();
    const el = current();
    if (el) {
      const r = el.getBoundingClientRect();
      const br = banner.getBoundingClientRect();
      const margin = 8;
      if (
        r.left < br.right + margin &&
        r.right > br.left - margin &&
        r.top < br.bottom + margin &&
        r.bottom > br.top - margin
      ) {
        dockBanner(bannerDocked === 'top' ? 'bottom' : 'top');
      }
    }
  };

  // Suppress the app's own pointer handlers while picking — a pick must never
  // navigate or mutate the page under inspection.
  const suppressed = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick'];
  const removePickingListeners = () => {
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    if (arg.transport === 'postMessage') g.removeEventListener('message', onParentMsg, false);
  };
  const removeSuppressed = () => {
    for (const t of suppressed) doc.removeEventListener(t, stop, true);
  };
  const cleanup = () => {
    highlight.remove();
    banner.remove();
  };

  // A pick committed. `'global'` hands the raw element back to Node (probed
  // later, separately) and tears everything down — the reporter's next step
  // (anchors) installs its own overlay. `'postMessage'` has no Node on the
  // other end of the wire, so it probes inline and keeps the overlay's inert
  // blockers installed (the review step still shows this same page) —
  // `onPick` lets the embedding host clear its own snapshot-only chrome
  // (search highlights) without this function knowing it exists.
  const reportPicked = (el: any) => {
    removePickingListeners();
    highlight.style.display = 'none';
    if (arg.transport === 'postMessage') {
      const probeFn = g.__piwiProbe;
      const attrs = typeof probeFn === 'function' ? probeFn(el, arg.probeArg) : null;
      g.__piwiSnapshotExtras?.onPick?.();
      doc.addEventListener('click', stop, true);
      doc.addEventListener('keydown', stop, true);
      foot.textContent = 'Analyzing element…';
      g.parent.postMessage({ type: 'elementPicked', attrs }, '*');
    } else {
      removeSuppressed();
      g.__piwiPickedElement = el;
      g.__piwiPickState = 'picked';
      foot.textContent = 'Analyzing element…';
    }
  };

  const reportSkipped = () => {
    removePickingListeners();
    if (arg.transport === 'postMessage') {
      doc.removeEventListener('click', stop, true);
      doc.removeEventListener('keydown', stop, true);
      removeSuppressed();
      g.__piwiSnapshotExtras?.onClose?.();
      cleanup();
      g.parent.postMessage({ type: 'pickerClosed' }, '*');
    } else {
      removeSuppressed();
      g.__piwiPickState = 'skipped';
      cleanup();
    }
  };

  const onClick = (e: any) => {
    stop(e);
    const el = current();
    if (!el || isOwn(e.target)) return;
    reportPicked(el);
  };
  const onKey = (e: any) => {
    if (e.key === 'Escape') {
      stop(e);
      reportSkipped();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      stop(e);
      if (e.key === 'ArrowUp') idx = Math.min(idx + 1, chain.length - 1);
      else idx = Math.max(idx - 1, 0);
      refresh();
    }
  };
  // The snapshot iframe rarely holds keyboard focus (a host modal's focus trap
  // keeps it in the parent document), so its host forwards arrow/Esc presses.
  const onParentMsg = (e: any) => {
    const d = e.data;
    if (!d || typeof d.type !== 'string' || d.type !== 'piwiPickerKey' || typeof d.key !== 'string') return;
    onKey({
      key: d.key,
      preventDefault() {},
      stopImmediatePropagation() {},
    });
  };

  g.__piwiPickCleanup = cleanup;
  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  for (const t of suppressed) doc.addEventListener(t, stop, true);
  if (arg.transport === 'postMessage') {
    g.addEventListener('message', onParentMsg, false);
    g.parent.postMessage({ type: 'pickerReady' }, '*');
  }
}
