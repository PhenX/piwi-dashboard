<script setup lang="ts">
/**
 * Interactive DOM snapshot locator picker. Opens as a modal, renders the
 * failure-time DOM snapshot in an iframe, and lets the user click the element
 * the failing locator should have targeted. The picked element is probed for
 * its attributes, ranked alternative locators are generated client-side, and
 * the user confirms one — which is saved back to the server.
 */
import { generateAlternatives, type RankedLocator, type ElementAttributes } from '#shared/locator-generation';
import type { LocatorFixRecommendation } from '#shared/locator-healing.types';
import { recommendLocatorFix } from '#shared/locator-healing';
import LocatorAlternativeRow from './LocatorAlternativeRow.vue';

const props = defineProps<{
  runId: number;
  testRunsCaseId: number;
  failingLocator: { method: string; args: Record<string, unknown> };
}>();

const emit = defineEmits<{
  close: [];
  confirmed: [pick: RankedLocator];
}>();

const isOpen = defineModel<boolean>('open', { required: true });

interface DomSnapshotResponse {
  status: 'ok' | 'no-trace' | 'no-snapshot';
  html?: string;
  snapshotName?: string;
  viewport?: { width: number; height: number };
}

const snapshotPending = ref(false);
const snapshot = ref<DomSnapshotResponse | null>(null);
const snapshotError = ref<string | null>(null);

async function fetchSnapshot() {
  snapshotPending.value = true;
  snapshotError.value = null;
  try {
    // Same endpoint as the read-only DOM snapshot card — trace-derived DOM with
    // an ARIA-snapshot fallback. The picker adds its own interactive overlay.
    snapshot.value = await $fetch<DomSnapshotResponse>(
      `/api/test-runs/${props.runId}/cases/${props.testRunsCaseId}/dom-snapshot`,
    );
  } catch (err: unknown) {
    snapshotError.value = err instanceof Error ? err.message : 'Unknown error';
  } finally {
    snapshotPending.value = false;
  }
}

watch(isOpen, (open) => {
  if (open) {
    snapshot.value = null;
    iframeReady.value = false;
    step.value = 'pick-element';
    contentHeight.value = 0;
    userZoomed.value = false;
    fetchSnapshot();
  }
});

const PICKER_STEP = { PICK_ELEMENT: 'pick-element', REVIEW: 'review' } as const;
type PickerStep = (typeof PICKER_STEP)[keyof typeof PICKER_STEP];

const step = ref<PickerStep>('pick-element');
const iframeRef = ref<HTMLIFrameElement | null>(null);
const iframeReady = ref(false);
const pickedAttrs = ref<ElementAttributes | null>(null);
const alternatives = ref<RankedLocator[]>([]);

// ── In-iframe picker script (self-contained, serialized into the iframe) ────

function pickerScript(): string {
  return `
(function () {
  if (window.__piwiPickerInstalled) return;
  window.__piwiPickerInstalled = true;
  var doc = document;
  var g = window;
  var Z = 2147483600;

  // Highlight overlay
  var highlight = doc.createElement('div');
  highlight.id = '__piwi_picker_highlight';
  highlight.style.cssText =
    'position:fixed;pointer-events:none;z-index:' + Z + ';display:none;box-sizing:border-box;' +
    'border:2px solid #7c3aed;background:rgba(124,58,237,.12);border-radius:3px;';
  doc.body.appendChild(highlight);

  // Banner
  var banner = doc.createElement('div');
  banner.id = '__piwi_picker_banner';
  banner.style.cssText =
    'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:' + (Z + 2) + ';' +
    'background:#111827;color:#f9fafb;font:13px/1.5 system-ui,sans-serif;' +
    'padding:10px 16px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:80vw;';
  banner.innerHTML = '<div>Click an element to generate locators</div>' +
    '<div style="color:#9ca3af;margin-top:3px;font-size:11px">\u2191 parent \u00b7 \u2193 child \u00b7 Esc skip</div>';
  doc.body.appendChild(banner);
  g.parent.postMessage({ type: 'pickerReady' }, '*');

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function describe(el) {
    var tag = (el.tagName || '?').toLowerCase();

    var testId = el.getAttribute && el.getAttribute('data-testid');
    if (testId) return "getByTestId('" + testId + "')";

    if (el.labels && el.labels.length > 0) {
      var labelText = (el.labels[0].textContent || '').replace(/\\s+/g,' ').trim().slice(0,80);
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

    var cls = ((el.getAttribute && el.getAttribute('class')) || '').split(/\\s+/).find(function(c){return c.length>1;});
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

  var ACTIONABLE = ['button','a','input','select','textarea','summary','option'];
  function snapIndex(chain) {
    for (var i=0;i<Math.min(chain.length,4);i++) {
      var el = chain[i];
      var t = (el.tagName||'').toLowerCase();
      if (ACTIONABLE.indexOf(t) !== -1) return i;
      if (el.getAttribute&&(el.getAttribute('role')||el.getAttribute('data-testid'))) return i;
    }
    return 0;
  }

  var chain = [];
  var idx = 0;
  var lastRaw = null;
  var PROBED_ATTRS = 'id,class,name,data-testid,placeholder,alt,title,aria-label,aria-level,role,type,href,multiple'.split(',');

  function current() { return chain[idx] || null; }

  function refresh() {
    var el = current();
    if (!el) { highlight.style.display='none'; return; }
    var r = el.getBoundingClientRect();
    highlight.style.display='block';
    highlight.style.left=r.left+'px'; highlight.style.top=r.top+'px';
    highlight.style.width=r.width+'px'; highlight.style.height=r.height+'px';
    var foot = document.getElementById('__piwi_picker_foot');
    if (foot) foot.textContent=describe(el) + ' \u2014 click to pick \u00b7 \u2191 parent \u00b7 \u2193 child \u00b7 Esc skip';
  }

  var foot = banner.querySelector('[style*=margin]');
  if (foot) foot.id = '__piwi_picker_foot';

  function probe(el) {
    var attrs = {};
    for (var i=0;i<PROBED_ATTRS.length;i++) {
      var k = PROBED_ATTRS[i];
      var v = el.getAttribute(k) || el[k];
      attrs[k] = typeof v === 'string' ? v.slice(0,200) : v ? String(v).slice(0,200) : null;
    }
    var r = el.getBoundingClientRect();
    return {
      tagName: (el.tagName||'').toLowerCase(),
      attributes: attrs,
      textContent: (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80) || null,
      center: { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) },
      hasLabel: !!(el.labels && el.labels.length > 0),
    };
  }

  function stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  function isOwn(el) { return el === banner || el === highlight || (banner.contains && banner.contains(el)); }

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
    if (!raw || isOwn(raw)) { highlight.style.display='none'; return; }
    if (raw !== lastRaw) { lastRaw=raw; chain=buildChain(raw); idx=snapIndex(chain); }
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
    if (k === 'Escape') { doClose(); return; }
    if (k === 'ArrowUp')   { idx=Math.min(idx+1,chain.length-1); refresh(); }
    if (k === 'ArrowDown') { idx=Math.max(idx-1,0); refresh(); }
  }
  function onKey(e) {
    if (e.key==='Escape'||e.key==='ArrowUp'||e.key==='ArrowDown') { stop(e); handleKey(e.key); }
  }
  // The iframe rarely holds keyboard focus — the modal's focus-trap keeps it in
  // the parent — so the host forwards arrow/Esc presses here via postMessage.
  function onParentMsg(e) {
    var d = e.data;
    if (d && d.type === 'piwiPickerKey' && typeof d.key === 'string') handleKey(d.key);
  }

  function onClick(e) {
    stop(e);
    var el = current();
    if (!el || isOwn(e.target)) return;
    var attrs = probe(el);
    highlight.style.display='none';
    banner.innerHTML='<div style="text-align:center;color:#9ca3af;">Analyzing element\u2026</div>';
    removeListeners();
    g.parent.postMessage({ type: 'elementPicked', attrs: attrs }, '*');
  }

  var suppressed = ['mousedown','mouseup','pointerdown','pointerup','auxclick','dblclick'];
  function removeListeners() {
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    g.removeEventListener('message', onParentMsg, false);
    for (var i=0;i<suppressed.length;i++) doc.removeEventListener(suppressed[i], stop, true);
  }

  function doClose() {
    removeListeners();
    highlight.remove();
    banner.remove();
    g.parent.postMessage({ type: 'pickerClosed' }, '*');
  }

  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  g.addEventListener('message', onParentMsg, false);
  for (var i=0;i<suppressed.length;i++) doc.addEventListener(suppressed[i], stop, true);
})();
`;
}

// ── Build iframe content ─────────────────────────────────────────────────────

// The snapshot HTML is rendered verbatim into a same-origin blob iframe. The
// picker script is injected on `load` from the parent (see `onIframeLoad`)
// rather than baked into the HTML string — the server caps the DOM and may
// truncate mid-element, leaving no `</body>` to splice before, so string-based
// injection is unreliable. The picker's overlay/banner carry their own inline
// styles, so no extra <style> is needed either.
const iframeBlobUrl = ref<string | undefined>(undefined);

watch(
  () => snapshot.value?.html,
  (html) => {
    // Revoke previous blob
    if (iframeBlobUrl.value) {
      URL.revokeObjectURL(iframeBlobUrl.value);
      iframeBlobUrl.value = undefined;
    }
    if (!html) return;
    iframeBlobUrl.value = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  },
  { immediate: true },
);

/**
 * Inject the picker script into the iframe once its document has parsed. Runs
 * parent-side against the same-origin blob document, so a truncated or
 * malformed snapshot can't stop the picker from initializing.
 */
function onIframeLoad() {
  const el = iframeRef.value;
  // Ignore the load fired by `cleanupIframe()` navigating to about:blank.
  if (!el || !el.src.startsWith('blob:')) return;
  try {
    const doc = el.contentDocument;
    if (!doc?.body) return;
    const script = doc.createElement('script');
    script.textContent = pickerScript();
    doc.body.appendChild(script);
    measureContent();
  } catch {
    // Cross-origin or detached document — leave the loading overlay up.
  }
}

// ── Viewport-accurate rendering (trace-viewer style) ────────────────────────
// Size the iframe to the recorded page viewport width and its full content
// height, then scale it with a CSS transform so the page keeps its true
// proportions and can be zoomed / fit to the pane instead of reflowing to a
// narrow column.

const stageRef = ref<HTMLElement | null>(null);
const stageWidth = ref(0);
const contentHeight = ref(0);
const zoom = ref(1);
// Once the user zooms manually, stop auto-fitting on resize.
const userZoomed = ref(false);

const viewport = computed(() => snapshot.value?.viewport ?? null);

/** Scale that fits the viewport width into the pane (never upscales past 100%). */
const fitZoom = computed(() => {
  const vp = viewport.value;
  if (!vp?.width || !stageWidth.value) return 1;
  return Math.min(stageWidth.value / vp.width, 1);
});

const canvasStyle = computed(() => {
  const vp = viewport.value;
  if (!vp) return { width: '100%', height: '100%' };
  const h = contentHeight.value || vp.height;
  return { width: `${Math.round(vp.width * zoom.value)}px`, height: `${Math.round(h * zoom.value)}px` };
});
const iframeStyle = computed(() => {
  const vp = viewport.value;
  if (!vp) return { width: '100%', height: '100%', border: '0' };
  const h = contentHeight.value || vp.height;
  return {
    width: `${vp.width}px`,
    height: `${h}px`,
    transform: `scale(${zoom.value})`,
    transformOrigin: 'top left',
    border: '0',
  };
});

const zoomPct = computed(() => Math.round(zoom.value * 100));
const clampZoom = (n: number): number => Math.min(4, Math.max(0.1, n));
function zoomBy(factor: number) {
  userZoomed.value = true;
  zoom.value = clampZoom(zoom.value * factor);
}
function fitToPane() {
  userZoomed.value = false;
  zoom.value = fitZoom.value;
}

// Auto-fit to the pane until the user takes manual control.
watch([fitZoom, viewport], () => {
  if (!userZoomed.value) zoom.value = fitZoom.value;
});

// Measure the iframe's full content height so the whole page is visible and
// pickable (not just the recorded viewport slice). Reflow-aware — external CSS
// and images settle asynchronously.
let contentObserver: ResizeObserver | null = null;
function measureContent() {
  const doc = iframeRef.value?.contentDocument;
  const root = doc?.documentElement;
  if (!root) return;
  const update = () => {
    const h = Math.max(root.scrollHeight, doc?.body?.scrollHeight ?? 0, viewport.value?.height ?? 0);
    if (Math.abs(h - contentHeight.value) > 1) contentHeight.value = h;
  };
  update();
  contentObserver?.disconnect();
  contentObserver = new ResizeObserver(update);
  contentObserver.observe(root);
  if (doc?.body) contentObserver.observe(doc.body);
}

// Track the pane width for the fit calculation.
let stageObserver: ResizeObserver | null = null;
watch(stageRef, (el) => {
  stageObserver?.disconnect();
  if (!el) return;
  stageWidth.value = el.clientWidth;
  stageObserver = new ResizeObserver((entries) => {
    for (const e of entries) stageWidth.value = e.contentRect.width;
  });
  stageObserver.observe(el);
});
onBeforeUnmount(() => {
  stageObserver?.disconnect();
  contentObserver?.disconnect();
});

// ── Iframe cleanup ───────────────────────────────────────────────────────────

onBeforeUnmount(() => {
  if (iframeBlobUrl.value) URL.revokeObjectURL(iframeBlobUrl.value);
});

// ── Message handler from iframe ──────────────────────────────────────────────

function handleMessage(event: MessageEvent) {
  // Only trust messages from our own iframe — ignore stray postMessages from
  // other frames, extensions, or the snapshot's own (script-stripped) content.
  if (!iframeRef.value || event.source !== iframeRef.value.contentWindow) return;
  if (event.data?.type === 'pickerReady') {
    iframeReady.value = true;
    return;
  }
  if (event.data?.type === 'elementPicked' && event.data.attrs) {
    pickedAttrs.value = event.data.attrs as ElementAttributes;
    alternatives.value = generateAlternatives(pickedAttrs.value);
    step.value = 'review';
  }
  if (event.data?.type === 'pickerClosed') {
    // Esc inside the iframe tears the picker down — close the whole modal rather
    // than leaving a blank iframe with no way to re-pick.
    close();
  }
}

// Forward arrow/Esc keys to the picker: the iframe rarely holds focus (the
// modal's focus-trap keeps it in the host document), so keydown never reaches
// the in-iframe listener. We relay them via postMessage while picking.
function forwardKeyToPicker(e: KeyboardEvent) {
  if (!isOpen.value || step.value !== 'pick-element' || !iframeReady.value) return;
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const win = iframeRef.value?.contentWindow;
  if (!win) return;
  e.preventDefault(); // stop the modal/page from scrolling on arrow keys
  win.postMessage({ type: 'piwiPickerKey', key: e.key }, '*');
}

function cleanupIframe() {
  if (iframeRef.value) iframeRef.value.src = 'about:blank';
}

onMounted(() => {
  window.addEventListener('message', handleMessage);
  window.addEventListener('keydown', forwardKeyToPicker, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage);
  window.removeEventListener('keydown', forwardKeyToPicker, true);
});

// ── Confirmation ─────────────────────────────────────────────────────────────

const selectedAlt = ref<RankedLocator | null>(null);
const saving = ref(false);

function selectAlternative(alt: RankedLocator) {
  selectedAlt.value = alt;
}

const recommendation = computed<LocatorFixRecommendation>(() =>
  recommendLocatorFix(props.failingLocator.method, alternatives.value),
);

async function confirm() {
  if (!selectedAlt.value) return;
  saving.value = true;
  try {
    await $fetch(`/api/test-runs/${props.runId}/cases/${props.testRunsCaseId}/locator-pick`, {
      method: 'POST',
      body: {
        failingLocator: props.failingLocator,
        pickedLocator: selectedAlt.value,
        elementTag: pickedAttrs.value?.tagName ?? 'unknown',
        elementAttrs: pickedAttrs.value?.attributes ?? {},
      },
    });
    emit('confirmed', selectedAlt.value);
    isOpen.value = false;
  } catch {
    // Save failures are non-blocking — the pick still shows in the panel
    emit('confirmed', selectedAlt.value);
    isOpen.value = false;
  } finally {
    saving.value = false;
  }
}

function close() {
  cleanupIframe();
  isOpen.value = false;
}

function resetPicker() {
  pickedAttrs.value = null;
  alternatives.value = [];
  selectedAlt.value = null;
  step.value = 'pick-element';
  iframeReady.value = false;
  // Reload the iframe to restore the picker. Recreate the blob URL so the src
  // string actually changes — reassigning the same URL isn't a guaranteed
  // reload — which fires `@load` and re-injects the picker script.
  const html = snapshot.value?.html;
  if (html) {
    if (iframeBlobUrl.value) URL.revokeObjectURL(iframeBlobUrl.value);
    iframeBlobUrl.value = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  }
}

// ── Locator notes (from existing LocatorHealingPanel convention) ────────────

function locatorNote(alt: RankedLocator): string {
  const { method, score, args } = alt;
  if (args && (args.anchorTestId || args.anchorSelector || args.anchorRole)) return 'scoped to a stable ancestor';
  if (score >= 100) return 'most stable';
  if (method === 'getByRole' && args && !('name' in args)) return 'name-free role — survives renames';
  if (method === 'getByRole') return 'semantic ARIA locator';
  if (method === 'getByLabel') return 'associated <label>';
  if (method === 'getByPlaceholder') return 'input placeholder';
  if (method === 'getByText') return 'visible text';
  if (method === 'getByAltText') return 'image alt text';
  if (method === 'getByTitle') return 'title attribute';
  if (method === 'locator' && score >= 50) return 'stable selector';
  if (method === 'locator') return 'CSS class';
  return '';
}

// ── Copy ────────────────────────────────────────────────────────────────────

const { copy } = useCopy();
const copiedKey = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
function copyLocator(text: string, key: string) {
  copy(text, { toast: 'Locator copied' });
  copiedKey.value = key;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedKey.value = null;
  }, 2000);
}
onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'max-w-6xl w-[95vw]' }" @after-leave="close">
    <template #header>
      <div>
        <h3 class="text-lg font-medium">Pick a locator from the DOM snapshot</h3>
        <p class="text-sm text-gray-500 mt-0.5">
          Click the element the failing locator should target. Use &uarr;&darr; to walk the DOM tree.
        </p>
      </div>
    </template>

    <template #body>
      <!-- Loading state -->
      <div v-if="snapshotPending" class="flex items-center justify-center py-20">
        <UIcon name="i-lucide-loader" class="size-6 animate-spin text-gray-400" />
        <span class="ml-2 text-sm text-gray-500">Loading DOM snapshot...</span>
      </div>

      <!-- Error state -->
      <div v-else-if="snapshotError" class="py-8 text-center">
        <UIcon name="i-lucide-alert-triangle" class="size-8 text-red-300 mx-auto mb-2" />
        <p class="text-sm text-red-500">Failed to load snapshot</p>
        <p class="text-xs text-gray-400 mt-1">{{ snapshotError }}</p>
        <UButton size="xs" variant="outline" color="neutral" class="mt-3" @click="fetchSnapshot">Retry</UButton>
      </div>

      <!-- No snapshot available -->
      <div v-else-if="snapshot?.status !== 'ok' || !snapshot.html" class="py-8 text-center">
        <UIcon name="i-lucide-file-x" class="size-8 text-gray-300 mx-auto mb-2" />
        <p class="text-sm text-gray-500">No DOM snapshot or ARIA data available for this execution</p>
        <p class="text-xs text-gray-400 mt-1">This test run has no stored trace or ARIA snapshot to pick from.</p>
      </div>

      <template v-else>
        <!-- Source note -->
        <div
          v-if="snapshot.snapshotName"
          class="mb-2 text-xs flex items-center gap-1"
          :class="
            snapshot.snapshotName === 'aria-fallback'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-green-600 dark:text-green-400'
          "
        >
          <UIcon
            :name="snapshot.snapshotName === 'aria-fallback' ? 'i-lucide-info' : 'i-lucide-check'"
            class="size-3.5 shrink-0"
          />
          <template v-if="snapshot.snapshotName === 'aria-fallback'">
            Rendered from the ARIA snapshot — element styles are approximate
          </template>
          <template v-else> Rendered from the failure-time DOM snapshot </template>
        </div>

        <!-- Zoom toolbar — only when the recorded viewport is known -->
        <div v-if="viewport" class="flex items-center gap-1 mb-1.5 text-xs text-gray-500">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-zoom-out"
            title="Zoom out"
            @click="zoomBy(1 / 1.25)"
          />
          <span class="tabular-nums w-11 text-center select-none">{{ zoomPct }}%</span>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-zoom-in"
            title="Zoom in"
            @click="zoomBy(1.25)"
          />
          <UButton size="xs" variant="outline" color="neutral" class="ml-1" @click="fitToPane">Fit</UButton>
          <span class="ml-auto text-gray-400 tabular-nums">{{ viewport.width }}&times;{{ viewport.height }}</span>
        </div>

        <!-- Iframe with the snapshot. When the viewport is known the iframe is
           sized to it and scaled with a CSS transform (proportions preserved);
           otherwise it fills the pane (ARIA fallback has no viewport). -->
        <div
          ref="stageRef"
          class="relative border border-default rounded-lg"
          :class="[
            step === 'pick-element' ? 'h-[75vh]' : 'h-80',
            viewport ? 'overflow-auto bg-gray-100 dark:bg-gray-800' : 'overflow-hidden',
          ]"
        >
          <!-- Loading overlay until the picker script initializes -->
          <div
            v-if="!iframeReady"
            class="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-900 z-10"
          >
            <UIcon name="i-lucide-loader" class="size-5 animate-spin text-gray-400" />
            <span class="ml-2 text-sm text-gray-500">Initializing picker...</span>
          </div>
          <div :style="canvasStyle">
            <iframe
              ref="iframeRef"
              :src="iframeBlobUrl"
              :style="iframeStyle"
              class="bg-white"
              sandbox="allow-scripts allow-same-origin"
              title="DOM snapshot"
              @load="onIframeLoad"
            />
          </div>
        </div>

        <!-- Review step: picked element + alternatives -->
        <div v-if="step === 'review' && pickedAttrs" class="mt-4 space-y-3">
          <!-- Picked element summary -->
          <div class="flex items-center gap-3 bg-elevated rounded-lg p-3">
            <UIcon name="i-lucide-crosshair" class="size-5 text-primary shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium">
                Picked: <code class="text-xs">{{ pickedAttrs.tagName }}</code>
                <template v-if="pickedAttrs.attributes['id']">
                  <code class="text-xs text-gray-400 ml-1">#{{ pickedAttrs.attributes['id'] }}</code>
                </template>
                <template v-if="pickedAttrs.attributes['data-testid']">
                  <UBadge size="xs" color="primary" variant="subtle" class="ml-1">
                    {{ pickedAttrs.attributes['data-testid'] }}
                  </UBadge>
                </template>
              </p>
              <p v-if="pickedAttrs.textContent" class="text-xs text-gray-500 mt-0.5 truncate">
                "{{ pickedAttrs.textContent }}"
              </p>
            </div>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-rotate-ccw"
              title="Pick a different element"
              @click="resetPicker"
            />
          </div>

          <!-- Alternatives list -->
          <div class="space-y-1">
            <LocatorAlternativeRow
              v-for="(alt, i) in alternatives"
              :key="i"
              :alt="alt"
              :note="locatorNote(alt)"
              :copied="copiedKey === `picked-${i}`"
              :dense="true"
              :class="selectedAlt?.locator === alt.locator ? 'ring-2 ring-primary/50 rounded' : ''"
              class="cursor-pointer"
              @copy="copyLocator(alt.locator, `picked-${i}`)"
              @click="selectAlternative(alt)"
            />
          </div>

          <!-- Recommendation -->
          <div
            v-if="recommendation.recommended"
            class="rounded-lg border border-primary/40 bg-primary/5 p-3 flex items-center gap-3"
          >
            <UIcon name="i-lucide-star" class="size-5 text-primary shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-primary">
                Recommended (score: {{ recommendation.recommended.score }})
              </p>
              <code class="text-sm font-mono block truncate mt-0.5">{{ recommendation.recommended.locator }}</code>
            </div>
            <UButton
              size="sm"
              color="primary"
              variant="solid"
              :trailing-icon="copiedKey === 'rec' ? 'i-lucide-check' : 'i-lucide-copy'"
              @click="copyLocator(recommendation.recommended.locator, 'rec')"
            >
              Copy
            </UButton>
          </div>
        </div>
      </template>
    </template>

    <template #footer>
      <div class="flex justify-between w-full">
        <UButton
          v-if="step === 'review'"
          size="sm"
          variant="outline"
          color="neutral"
          icon="i-lucide-rotate-ccw"
          @click="resetPicker"
        >
          Pick a different element
        </UButton>
        <div v-else />
        <div class="flex gap-2">
          <UButton size="sm" variant="outline" color="neutral" @click="close">Cancel</UButton>
          <UButton
            v-if="step === 'review'"
            size="sm"
            color="primary"
            :loading="saving"
            :disabled="!selectedAlt"
            @click="confirm"
          >
            Confirm pick
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
