/* eslint-disable */
// @ts-nocheck
/**
 * The in-iframe locator-picker overlay body — see snapshot-picker-script.ts for
 * the full rationale. Authored as a self-contained function (no references to
 * this module's scope; all config passed as the single argument) and serialized
 * into the sandboxed DOM-snapshot iframe via `String(installSnapshotPicker)`.
 *
 * Isolated in its own file with `@ts-nocheck` because it is browser-context DOM
 * code that never runs in this module — this keeps the pure, host-side helpers
 * in snapshot-picker-script.ts fully type-checked.
 *
 * Structurally MIRRORS the reporter's live picker
 * (`reporter/src/internal/capture/pick-on-failure.ts` -> installPickerOverlay);
 * keep the overlay chrome in sync by hand when it changes.
 */
export function installSnapshotPicker(config) {
  if (window.__piwiPickerInstalled) return;
  window.__piwiPickerInstalled = true;
  var doc = document;
  var g = window;
  var Z = 2147483600;
  var PROBED_ATTRS = config.probedAttrs;

  // Highlight overlay (hover target)
  var highlight = doc.createElement('div');
  highlight.id = '__piwi_picker_highlight';
  highlight.style.cssText =
    'position:fixed;pointer-events:none;z-index:' +
    Z +
    ';display:none;box-sizing:border-box;' +
    'border:2px solid #7c3aed;background:rgba(124,58,237,.12);border-radius:3px;';
  doc.body.appendChild(highlight);

  // Banner
  var banner = doc.createElement('div');
  banner.id = '__piwi_picker_banner';
  banner.style.cssText =
    'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:' +
    (Z + 2) +
    ';' +
    'background:#111827;color:#f9fafb;font:13px/1.5 system-ui,sans-serif;' +
    'padding:10px 16px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:80vw;';
  banner.innerHTML =
    '<div>Click an element to generate locators</div>' +
    '<div style="color:#9ca3af;margin-top:3px;font-size:11px">↑ parent · ↓ child · Esc skip</div>';
  doc.body.appendChild(banner);
  g.parent.postMessage({ type: 'pickerReady' }, '*');

  function describe(el) {
    var tag = (el.tagName || '?').toLowerCase();

    var testId = el.getAttribute && el.getAttribute('data-testid');
    if (testId) return "getByTestId('" + testId + "')";

    if (el.labels && el.labels.length > 0) {
      var labelText = (el.labels[0].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (labelText) return "getByLabel('" + labelText + "')";
    }

    var ariaLabel = el.getAttribute && el.getAttribute('aria-label');
    if (ariaLabel) return "getByLabel('" + ariaLabel + "')";

    var placeholder = el.getAttribute && el.getAttribute('placeholder');
    if (placeholder) return "getByPlaceholder('" + placeholder + "')";

    var alt = el.getAttribute && el.getAttribute('alt');
    if (alt) return "getByAltText('" + alt + "')";

    var titleAttr = el.getAttribute && el.getAttribute('title');
    if (titleAttr) return "getByTitle('" + titleAttr + "')";

    if (el.id) return "locator('#" + el.id + "')";

    var cls = ((el.getAttribute && el.getAttribute('class')) || '').split(/\s+/).find(function (c) {
      return c.length > 1;
    });
    if (cls) return "locator('." + cls + "')";

    return tag;
  }

  function buildChain(raw) {
    var chain = [];
    var node = raw;
    while (node && chain.length < 15) {
      var t = (node.tagName || '').toLowerCase();
      if (t === 'body' || t === 'html') break;
      chain.push(node);
      node = node.parentElement;
    }
    return chain.length ? chain : [raw];
  }

  var ACTIONABLE = ['button', 'a', 'input', 'select', 'textarea', 'summary', 'option'];
  function snapIndex(chain) {
    for (var i = 0; i < Math.min(chain.length, 4); i++) {
      var el = chain[i];
      var t = (el.tagName || '').toLowerCase();
      if (ACTIONABLE.indexOf(t) !== -1) return i;
      if (el.getAttribute && (el.getAttribute('role') || el.getAttribute('data-testid'))) return i;
    }
    return 0;
  }

  var chain = [];
  var idx = 0;
  var lastRaw = null;

  function current() {
    return chain[idx] || null;
  }

  function refresh() {
    var el = current();
    if (!el) {
      highlight.style.display = 'none';
      return;
    }
    var r = el.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left = r.left + 'px';
    highlight.style.top = r.top + 'px';
    highlight.style.width = r.width + 'px';
    highlight.style.height = r.height + 'px';
    var foot = doc.getElementById('__piwi_picker_foot');
    if (foot) foot.textContent = describe(el) + ' — click to pick · ↑ parent · ↓ child · Esc skip';
  }

  var foot = banner.querySelector('[style*=margin]');
  if (foot) foot.id = '__piwi_picker_foot';

  function probe(el) {
    var attrs = {};
    for (var i = 0; i < PROBED_ATTRS.length; i++) {
      var k = PROBED_ATTRS[i];
      var v = el.getAttribute(k) || el[k];
      attrs[k] = typeof v === 'string' ? v.slice(0, 200) : v ? String(v).slice(0, 200) : null;
    }
    var r = el.getBoundingClientRect();
    // Uniqueness probe: how many elements each candidate selector matches — a
    // count > 1 marks the alternative ambiguous so the generator drops it
    // (mirrors the reporter's probeElementAttrs).
    var counts = {};
    try {
      var cssEsc = function (s) {
        return g.CSS.escape(s);
      };
      var countSel = function (sel) {
        try {
          return doc.querySelectorAll(sel).length;
        } catch (err) {
          return undefined;
        }
      };
      if (attrs['data-testid']) counts.testId = countSel('[data-testid=' + JSON.stringify(attrs['data-testid']) + ']');
      if (attrs.id) counts.id = countSel('#' + cssEsc(attrs.id));
      if (attrs.name) counts.name = countSel('[name=' + JSON.stringify(attrs.name) + ']');
      var classList = (attrs['class'] || '')
        .split(/\s+/)
        .filter(function (c) {
          return c.length > 1;
        })
        .slice(0, 10);
      if (classList.length > 0) {
        var classCounts = {};
        for (var j = 0; j < classList.length; j++) {
          var n = countSel('.' + cssEsc(classList[j]));
          if (n !== undefined) classCounts[classList[j]] = n;
        }
        counts.classes = classCounts;
      }
    } catch (err) {
      /* uniqueness probing is best-effort */
    }
    // Associated <label> text — the browser-computed accessible name for
    // labeled form controls; names getByLabel/getByRole alternatives.
    var labelText = null;
    if (el.labels && el.labels.length > 0) {
      labelText = (el.labels[0].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) || null;
    }
    return {
      tagName: (el.tagName || '').toLowerCase(),
      attributes: attrs,
      textContent: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null,
      center: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
      hasLabel: !!(el.labels && el.labels.length > 0),
      labelText: labelText,
      selectorCounts: counts,
    };
  }

  function stop(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function isOwn(el) {
    return el === banner || el === highlight || (banner.contains && banner.contains(el)) || (el && el.__piwiHint);
  }

  var bannerDocked = 'top';
  function dockBanner(side) {
    if (bannerDocked === side) return;
    bannerDocked = side;
    if (side === 'bottom') {
      banner.style.top = 'auto';
      banner.style.bottom = '12px';
    } else {
      banner.style.top = '12px';
      banner.style.bottom = 'auto';
    }
  }

  function onMove(e) {
    var raw = e.target;
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
    var el = current();
    if (el) {
      var r = el.getBoundingClientRect();
      var bannerRect = banner.getBoundingClientRect();
      var margin = 8;
      if (
        r.left < bannerRect.right + margin &&
        r.right > bannerRect.left - margin &&
        r.top < bannerRect.bottom + margin &&
        r.bottom > bannerRect.top - margin
      ) {
        dockBanner(bannerDocked === 'top' ? 'bottom' : 'top');
      }
    }
  }

  function handleKey(k) {
    if (k === 'Escape') {
      doClose();
      return;
    }
    if (k === 'ArrowUp') {
      idx = Math.min(idx + 1, chain.length - 1);
      refresh();
    }
    if (k === 'ArrowDown') {
      idx = Math.max(idx - 1, 0);
      refresh();
    }
  }
  function onKey(e) {
    if (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      stop(e);
      handleKey(e.key);
    }
  }

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
  // the parent — so the host forwards arrow/Esc presses and guidance commands.
  function onParentMsg(e) {
    var d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'piwiPickerKey' && typeof d.key === 'string') handleKey(d.key);
    else if (d.type === 'piwiHighlight') {
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

  function onClick(e) {
    stop(e);
    var el = current();
    if (!el || isOwn(e.target)) return;
    var attrs = probe(el);
    highlight.style.display = 'none';
    clearHints();
    banner.innerHTML = '<div style="text-align:center;color:#9ca3af;">Analyzing element…</div>';
    removeListeners();
    g.parent.postMessage({ type: 'elementPicked', attrs: attrs }, '*');
  }

  var suppressed = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick'];
  function removeListeners() {
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    g.removeEventListener('message', onParentMsg, false);
    for (var i = 0; i < suppressed.length; i++) doc.removeEventListener(suppressed[i], stop, true);
  }

  function doClose() {
    removeListeners();
    clearHints();
    highlight.remove();
    banner.remove();
    g.parent.postMessage({ type: 'pickerClosed' }, '*');
  }

  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  g.addEventListener('message', onParentMsg, false);
  for (var i = 0; i < suppressed.length; i++) doc.addEventListener(suppressed[i], stop, true);

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
