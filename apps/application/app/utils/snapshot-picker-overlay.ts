/* eslint-disable */
// @ts-nocheck
/**
 * The in-iframe snapshot-only chrome layered on top of the shared picker core
 * (`@piwitests/picker-dom`'s `installPickerOverlay`, run in `'postMessage'`
 * transport — see `snapshot-picker-script.ts`): pre-highlighting likely
 * elements, text search, extended inertness (nothing in a dead snapshot
 * should ever react), and reporting content height so the opaque-origin host
 * can size the iframe without reading its document.
 *
 * Authored as a self-contained function (no references to this module's
 * scope; all config passed as the single argument) and serialized into the
 * sandboxed DOM-snapshot iframe via `String(installSnapshotPickerExtras)`,
 * ahead of the shared core overlay in the same `<script>` tag.
 *
 * Isolated in its own file with `@ts-nocheck` because it is browser-context DOM
 * code that never runs in this module — this keeps the pure, host-side helpers
 * in snapshot-picker-script.ts fully type-checked.
 */
export function installSnapshotPickerExtras() {
  var doc = document;
  var g = window;
  var Z = 2147483600;

  // ── Guidance: pre-highlight likely elements + text search ──────────────────
  // The host derives search hints from the healing result and drives a search
  // box; both find elements by visible text and outline them, so the user does
  // not have to hunt for the element the failing locator meant to hit.

  var hintBoxes = [];
  function clearHints() {
    for (var i = 0; i < hintBoxes.length; i++) {
      if (hintBoxes[i].parentNode) hintBoxes[i].parentNode.removeChild(hintBoxes[i]);
    }
    hintBoxes = [];
  }
  function norm(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function textMatches(hintText) {
    var q = norm(hintText);
    if (q.length < 2) return [];
    var all = doc.querySelectorAll(
      'button,a,[role],h1,h2,h3,h4,h5,h6,label,summary,input,textarea,select,option,span,li,td,th,p',
    );
    var exact = [];
    var partial = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var t = norm(el.textContent);
      if (!t) {
        var pl = norm((el.getAttribute && (el.getAttribute('placeholder') || el.getAttribute('aria-label'))) || '');
        if (pl && (pl === q || pl.indexOf(q) !== -1)) exact.push(el);
        continue;
      }
      if (t.length > 120) continue; // skip large containers
      if (t === q) exact.push(el);
      else if (t.indexOf(q) !== -1 && t.length < q.length + 30) partial.push(el);
    }
    return exact.concat(partial);
  }
  function box(el, color) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    var b = doc.createElement('div');
    b.__piwiHint = true;
    b.style.cssText =
      'position:fixed;pointer-events:none;z-index:' +
      (Z + 1) +
      ';box-sizing:border-box;border-radius:3px;' +
      'transition:opacity .3s;border:2px solid ' +
      color +
      ';box-shadow:0 0 0 3px ' +
      color +
      '55;' +
      'left:' +
      r.left +
      'px;top:' +
      r.top +
      'px;width:' +
      r.width +
      'px;height:' +
      r.height +
      'px;';
    doc.body.appendChild(b);
    hintBoxes.push(b);
    return b;
  }
  function scrollHostTo(el) {
    var r = el.getBoundingClientRect();
    g.parent.postMessage({ type: 'piwiScrollTo', y: r.top }, '*');
  }
  function highlightHints(hints) {
    clearHints();
    if (!hints || !hints.length) return;
    var best = null;
    for (var i = 0; i < hints.length; i++) {
      var h = hints[i];
      var matches = textMatches(h && h.text);
      for (var j = 0; j < Math.min(matches.length, 3); j++) {
        box(matches[j], '#f59e0b');
        if (!best) best = matches[j];
      }
    }
    if (best) scrollHostTo(best);
    // Fade after a few seconds so the outlines never obscure the pick target.
    setTimeout(function () {
      for (var i = 0; i < hintBoxes.length; i++) hintBoxes[i].style.opacity = '0';
    }, 2600);
    setTimeout(clearHints, 3000);
  }
  var searchMatches = [];
  var searchIdx = 0;
  function reportSearch() {
    g.parent.postMessage(
      { type: 'piwiSearchResult', count: searchMatches.length, index: searchMatches.length ? searchIdx : -1 },
      '*',
    );
  }
  function focusSearchMatch() {
    clearHints();
    var el = searchMatches[searchIdx];
    if (!el) return;
    box(el, '#7c3aed');
    scrollHostTo(el);
    reportSearch();
  }
  function doSearch(q) {
    searchMatches = textMatches(q);
    searchIdx = 0;
    if (!searchMatches.length) {
      clearHints();
      reportSearch();
      return;
    }
    focusSearchMatch();
  }
  function cycleSearch() {
    if (!searchMatches.length) return;
    searchIdx = (searchIdx + 1) % searchMatches.length;
    focusSearchMatch();
  }

  // The iframe rarely holds keyboard focus — the modal's focus-trap keeps it in
  // the parent — so the host forwards search/highlight guidance commands here.
  // Arrow/Esc key forwarding is the shared core overlay's own concern
  // (`piwiPickerKey`, handled by `installPickerOverlay` itself).
  function onParentMsg(e) {
    var d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'piwiHighlight') {
      try {
        highlightHints(d.hints);
      } catch (err) {}
    } else if (d.type === 'piwiSearch') {
      try {
        doSearch(d.q);
      } catch (err) {}
    } else if (d.type === 'piwiSearchNext') {
      try {
        cycleSearch();
      } catch (err) {}
    } else if (d.type === 'piwiClearHints') {
      try {
        clearHints();
      } catch (err) {}
    }
  }
  g.addEventListener('message', onParentMsg, false);

  // Every interaction the snapshot must swallow so it behaves as an inert
  // picture: a click must never navigate a link, submit a form, activate a
  // control, type into a field, or start a drag/selection. `mousemove`, `click`
  // and `keydown` are the shared core overlay's own concern; this list stays
  // installed for the whole picker lifetime, on top of the core's own (looser)
  // suppression — intentionally STRICTER than the reporter's live picker, which
  // runs on a real page the user may still want to interact with. Here the page
  // is a dead snapshot, so nothing should react.
  function stop(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  var INERT_EVENTS = [
    'mousedown',
    'mouseup',
    'pointerdown',
    'pointerup',
    'auxclick',
    'dblclick',
    'contextmenu',
    'submit',
    'beforeinput',
    'input',
    'change',
    'paste',
    'cut',
    'drop',
    'dragstart',
    'keypress',
    'keyup',
    'touchstart',
    'touchend',
  ];
  for (var i = 0; i < INERT_EVENTS.length; i++) doc.addEventListener(INERT_EVENTS[i], stop, true);

  g.__piwiSnapshotExtras = {
    onPick: function () {
      clearHints();
    },
    onClose: function () {
      clearHints();
      g.removeEventListener('message', onParentMsg, false);
      for (var i = 0; i < INERT_EVENTS.length; i++) doc.removeEventListener(INERT_EVENTS[i], stop, true);
    },
  };

  // ── Report full content height so the host can size the (opaque-origin)
  // iframe without reading its document. Replaces parent-side measurement. ────
  function reportHeight() {
    var h = Math.max(doc.documentElement ? doc.documentElement.scrollHeight : 0, doc.body ? doc.body.scrollHeight : 0);
    if (h > 0) g.parent.postMessage({ type: 'piwiContentHeight', height: h }, '*');
  }
  reportHeight();
  try {
    if (g.ResizeObserver) {
      var ro = new g.ResizeObserver(reportHeight);
      if (doc.documentElement) ro.observe(doc.documentElement);
      if (doc.body) ro.observe(doc.body);
    }
  } catch (err) {
    /* height stays at the recorded viewport */
  }
}
