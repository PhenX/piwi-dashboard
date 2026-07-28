import { probeElementAttrs, type ProbeArg } from '@piwitests/picker-dom';
import {
  generateAlternatives,
  approximateAccessibleName,
  resolveAriaRole,
  CAPTURED_ATTRIBUTES,
  TAG_TO_ROLE,
  INPUT_TYPE_TO_ROLE,
} from '@piwitests/core/locator-generation';
import {
  normalizeSteps,
  buildSession,
  type RawCaptureEvent,
  type RecordedTarget,
  type RecordedStep,
} from '@piwitests/core/recording';
import { rankFunctionMatches, type TestFunctionEntry, type RankedFunctionMatch } from '@piwitests/core/function-match';
import { renderSpec } from '@piwitests/core/codegen';
import { classifyInputKind, isPasswordInput } from './record-capture.js';
import {
  getRecordingState,
  appendRecordingEvent,
  stopRecording,
  discardRecording,
  type RecordingState,
} from '../shared/recording-storage.js';
import { getCachedCatalog } from '../shared/catalog-cache.js';
import { getConnectionSettings } from '../shared/connection-settings.js';

const HUD_HOST_ID = 'piwi-record-hud-host';
const PANEL_HOST_ID = 'piwi-record-review-host';

const ROLE_SOURCES = [...new Set(['[role]', 'input', 'select', ...Object.keys(TAG_TO_ROLE)])].join(',');
const PROBE_ARG: ProbeArg = {
  keep: [...CAPTURED_ATTRIBUTES],
  tagRoles: TAG_TO_ROLE,
  inputRoles: INPUT_TYPE_TO_ROLE,
  roleSources: ROLE_SOURCES,
  includeStructural: true,
  includeLabelText: false,
};

/** The DOM shapes a click/action can reasonably land on — a click deeper inside one of these snaps up to it, same intent as the picker overlay's own snapping (not the identical algorithm — see AGENTS.md note in this file's own doc comment below). */
const ACTIONABLE_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [contenteditable="true"], [data-testid]';

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Element → `RecordedTarget`, mirroring `top-locator.ts`'s probe pipeline but
 * keeping the top few ranked alternatives (not just the winner) and the
 * role/testId/text a catalog pattern match needs. Lives here rather than a
 * separate pure file because it calls `generateAlternatives`, which per
 * `extension/AGENTS.md`'s two-strategy rule can only be tested by driving
 * the real built bundle — same reasoning as `agent-context.ts`.
 */
function deriveRecordedTarget(el: Element): RecordedTarget {
  const attrs = probeElementAttrs(el, PROBE_ARG);
  const accessibleName = approximateAccessibleName({ ...attrs, accessibleName: null });
  const role = resolveAriaRole({ ...attrs, accessibleName });
  const ranked = generateAlternatives({ ...attrs, accessibleName });
  return {
    tagName: attrs.tagName,
    role,
    accessibleName,
    testId: attrs.attributes['data-testid'] ?? null,
    text: el.textContent ? normalizeText(el.textContent).slice(0, 200) : null,
    alternatives: ranked.slice(0, 5).map((r) => ({ locator: r.locator, method: r.method, score: r.score })),
  };
}

function nearestActionable(el: Element): Element {
  return el.closest(ACTIONABLE_SELECTOR) ?? el;
}

function withinOwnUi(e: Event): boolean {
  const path = e.composedPath();
  return path.some((n) => n instanceof HTMLElement && (n.id === HUD_HOST_ID || n.id === PANEL_HOST_ID));
}

async function copyToClipboard(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const original = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}

const SHARED_STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
`;

function renderHud(state: RecordingState, catalog: TestFunctionEntry[]): void {
  document.getElementById(HUD_HOST_ID)?.remove();
  document.getElementById(PANEL_HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HUD_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:auto 16px 16px auto;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    ${SHARED_STYLE}
    .bar {
      display: flex; flex-direction: column; gap: 8px; background: #111827; color: #f9fafb;
      border-radius: 12px; padding: 10px 12px; box-shadow: 0 8px 30px rgba(0,0,0,.4);
      font-size: 12.5px; min-width: 260px; max-width: 340px;
    }
    @media (prefers-color-scheme: light) {
      .bar { background: #ffffff; color: #111827; box-shadow: 0 8px 30px rgba(0,0,0,.2); border: 1px solid #e5e7eb; }
    }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; flex-shrink: 0; animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
    .title { font-weight: 600; flex: 1; }
    button { border-radius: 6px; padding: 4px 9px; font: inherit; font-size: 11.5px; cursor: pointer;
      border: 1px solid rgba(128,128,128,.3); background: rgba(128,128,128,.12); color: inherit; }
    button:hover, button:focus-visible { background: rgba(128,128,128,.25); }
    button.stop { background: #dc2626; border-color: #dc2626; color: #fff; }
    .section-title { color: #9ca3af; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; margin-top: 2px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; word-break: break-all; display: block; }
    .match { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
    .match-name { font-family: ui-monospace, monospace; font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .match-bar { width: 34px; height: 4px; border-radius: 2px; background: rgba(128,128,128,.25); overflow: hidden; flex-shrink: 0; }
    .match-bar-fill { height: 100%; background: #7c3aed; }
    .match-badge { font-size: 9.5px; padding: 1px 4px; border-radius: 4px; flex-shrink: 0; }
    .match-badge.complete { background: rgba(34,197,94,.2); color: #22c55e; }
    .match-badge.partial { color: #9ca3af; }
    .empty { color: #9ca3af; font-size: 11px; }
  `;
  root.appendChild(style);

  const steps = normalizeSteps(state.events);
  const matches = catalog.length > 0 ? rankFunctionMatches(steps, catalog).slice(0, 3) : [];
  const lastTarget = [...state.events].reverse().find((e) => e.target)?.target ?? null;

  const bar = document.createElement('div');
  bar.className = 'bar';

  const topRow = document.createElement('div');
  topRow.className = 'row';
  const dot = document.createElement('div');
  dot.className = 'dot';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `Recording — ${steps.length} step${steps.length === 1 ? '' : 's'}`;
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'stop';
  stopBtn.textContent = 'Stop';
  stopBtn.addEventListener('click', () => void handleStop());
  topRow.append(dot, title, stopBtn);
  bar.appendChild(topRow);

  if (lastTarget?.alternatives[0]) {
    const locTitle = document.createElement('div');
    locTitle.className = 'section-title';
    locTitle.textContent = 'Last locator';
    const code = document.createElement('code');
    code.textContent = lastTarget.alternatives[0].locator;
    bar.append(locTitle, code);
  }

  if (catalog.length > 0) {
    const matchTitle = document.createElement('div');
    matchTitle.className = 'section-title';
    matchTitle.textContent = 'Matching functions';
    bar.appendChild(matchTitle);
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No catalog match yet';
      bar.appendChild(empty);
    } else {
      for (const m of matches) bar.appendChild(renderMatchRow(m));
    }
  }

  root.appendChild(bar);
}

function renderMatchRow(m: RankedFunctionMatch): HTMLElement {
  const row = document.createElement('div');
  row.className = 'match';
  const name = document.createElement('div');
  name.className = 'match-name';
  name.textContent = m.entry.name;
  const barWrap = document.createElement('div');
  barWrap.className = 'match-bar';
  const fill = document.createElement('div');
  fill.className = 'match-bar-fill';
  fill.style.width = `${Math.round(m.score * 100)}%`;
  barWrap.appendChild(fill);
  const badge = document.createElement('span');
  badge.className = `match-badge ${m.complete ? 'complete' : 'partial'}`;
  badge.textContent = m.complete ? 'ready' : `${m.matchedIndices.length}/${m.entry.steps.length}`;
  row.append(name, barWrap, badge);
  return row;
}

function describeStep(step: RecordedStep): string {
  const target = step.target;
  const label = target?.testId
    ? `testId=${target.testId}`
    : (target?.accessibleName ?? target?.text ?? target?.tagName ?? '');
  const value = step.redacted ? '••••••' : step.value;
  return `${step.action}${label ? ` — ${label}` : ''}${value ? ` = "${value}"` : ''}`;
}

async function renderReviewPanel(events: RawCaptureEvent[]): Promise<void> {
  document.getElementById(HUD_HOST_ID)?.remove();
  document.getElementById(PANEL_HOST_ID)?.remove();

  const steps = normalizeSteps(events);
  const session = buildSession(steps, events[0]?.timestamp ?? Date.now());
  const connection = await getConnectionSettings();
  const catalog = await getCachedCatalog(connection.projectId);
  const withCatalog = renderSpec(session, { catalog });
  const raw = renderSpec(session);

  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    ${SHARED_STYLE}
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; padding-top: 6vh; }
    .panel { background: #111827; color: #f9fafb; border-radius: 12px; padding: 16px; width: min(680px, 92vw); max-height: 84vh;
      overflow: auto; box-shadow: 0 8px 40px rgba(0,0,0,.5); font-size: 13px; line-height: 1.5; }
    @media (prefers-color-scheme: light) { .panel { background: #ffffff; color: #111827; box-shadow: 0 8px 40px rgba(0,0,0,.2); } }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .title { font-weight: 600; font-size: 14px; }
    .sub { color: #9ca3af; font-size: 12px; }
    .close { background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 6px; }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
    .steps { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; max-height: 240px; overflow: auto; margin-bottom: 12px; }
    .step { padding: 6px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px;
      border-bottom: 1px solid rgba(128,128,128,.15); display: flex; gap: 8px; align-items: center; }
    .step:last-child { border-bottom: none; }
    .step-idx { color: #9ca3af; flex-shrink: 0; width: 20px; }
    .step-fn { margin-left: auto; font-size: 10px; padding: 1px 5px; border-radius: 4px; background: rgba(124,58,237,.2); color: #a78bfa; flex-shrink: 0; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    button.action { background: rgba(128,128,128,.12); color: inherit; border: 1px solid rgba(128,128,128,.3);
      border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
    button.action:hover, button.action:focus-visible { background: rgba(128,128,128,.25); }
    button.action.primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
    button.action.danger:hover, button.action.danger:focus-visible { background: rgba(248,113,113,.2); border-color: #f87171; }
    .empty { color: #9ca3af; font-size: 12.5px; padding: 16px; text-align: center; }
  `;
  root.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Piwi recording review');
  panel.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent =
    steps.length === 0 ? 'Nothing recorded' : `${steps.length} recorded step${steps.length === 1 ? '' : 's'}`;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent =
    withCatalog.matchedSpans.length > 0
      ? `${withCatalog.matchedSpans.length} step${withCatalog.matchedSpans.length === 1 ? '' : 's'} matched to your function catalog`
      : catalog.length > 0
        ? 'No catalog matches — exported as raw locators'
        : 'Not connected to a Piwi instance — exported as raw locators';
  titleWrap.append(title, sub);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => host.remove());
  header.append(titleWrap, closeBtn);
  panel.appendChild(header);

  if (steps.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No steps were captured.';
    panel.appendChild(empty);
  } else {
    const stepsWrap = document.createElement('div');
    stepsWrap.className = 'steps';
    steps.forEach((step, i) => {
      const row = document.createElement('div');
      row.className = 'step';
      const idx = document.createElement('span');
      idx.className = 'step-idx';
      idx.textContent = String(i + 1);
      const desc = document.createElement('span');
      desc.textContent = describeStep(step);
      row.append(idx, desc);
      const span = withCatalog.matchedSpans.find((s) => i >= s.startStep && i <= s.endStep);
      if (span) {
        const fnBadge = document.createElement('span');
        fnBadge.className = 'step-fn';
        fnBadge.textContent = span.functionName;
        row.appendChild(fnBadge);
      }
      stepsWrap.appendChild(row);
    });
    panel.appendChild(stepsWrap);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  if (steps.length > 0) {
    const copyPrimary = document.createElement('button');
    copyPrimary.type = 'button';
    copyPrimary.className = 'action primary';
    copyPrimary.textContent = catalog.length > 0 ? 'Copy as TypeScript (with your functions)' : 'Copy as TypeScript';
    copyPrimary.addEventListener('click', () => void copyToClipboard(withCatalog.code, copyPrimary));
    actions.appendChild(copyPrimary);

    if (catalog.length > 0 && withCatalog.matchedSpans.length > 0) {
      const copyRaw = document.createElement('button');
      copyRaw.type = 'button';
      copyRaw.className = 'action';
      copyRaw.textContent = 'Copy raw TypeScript';
      copyRaw.addEventListener('click', () => void copyToClipboard(raw.code, copyRaw));
      actions.appendChild(copyRaw);
    }
  }

  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.className = 'action danger';
  discardBtn.textContent = 'Discard';
  discardBtn.addEventListener('click', async () => {
    await discardRecording();
    host.remove();
  });
  actions.appendChild(discardBtn);
  panel.appendChild(actions);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) host.remove();
  });
  document.addEventListener(
    'keydown',
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKeyDown, true);
        host.remove();
      }
    },
    true,
  );

  backdrop.appendChild(panel);
  root.appendChild(backdrop);
  panel.focus();
}

async function handleStop(): Promise<void> {
  const state = await stopRecording();
  try {
    chrome.runtime.sendMessage({ type: 'piwi-recording-stopped' });
  } catch {
    // Extension context can be gone (e.g. reloaded mid-recording) — the storage write above already stuck.
  }
  await renderReviewPanel(state.events);
}

function buildEvent(
  kind: RawCaptureEvent['kind'],
  el: Element | null,
  extra: Partial<RawCaptureEvent> = {},
): RawCaptureEvent {
  return {
    kind,
    target: el ? deriveRecordedTarget(el) : null,
    value: null,
    checked: null,
    inputType: null,
    isPasswordField: false,
    pageUrl: location.href,
    timestamp: Date.now(),
    ...extra,
  };
}

async function refreshHud(): Promise<void> {
  const [state, connection] = await Promise.all([getRecordingState(), getConnectionSettings()]);
  if (!state.active) return;
  const catalog = await getCachedCatalog(connection.projectId);
  renderHud(state, catalog);
}

function attachListeners(): void {
  document.addEventListener(
    'click',
    (e) => {
      if (withinOwnUi(e)) return;
      const raw = e.target;
      if (!(raw instanceof Element)) return;
      const el = nearestActionable(raw);
      const kind = classifyInputKind(el.tagName, (el as HTMLInputElement).type ?? null);
      if (kind === 'checkbox' || kind === 'radio') return; // the resulting `change` event records this one
      void appendRecordingEvent(buildEvent('click', el)).then(() => void refreshHud());
    },
    true,
  );

  document.addEventListener(
    'input',
    (e) => {
      if (withinOwnUi(e)) return;
      const el = e.target;
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
      const typeAttr = el instanceof HTMLInputElement ? el.type : null;
      const passwordField = isPasswordInput(el.tagName, typeAttr);
      // The raw value never enters the event at all for a password field —
      // redacting later in normalizeSteps would still mean the plaintext sat
      // in chrome.storage.session in the meantime.
      void appendRecordingEvent(
        buildEvent('input', el, {
          value: passwordField ? null : el.value,
          isPasswordField: passwordField,
        }),
      ).then(() => void refreshHud());
    },
    true,
  );

  document.addEventListener(
    'change',
    (e) => {
      if (withinOwnUi(e)) return;
      const el = e.target;
      if (!(el instanceof Element)) return;
      const typeAttr = el instanceof HTMLInputElement ? el.type : null;
      const kind = classifyInputKind(el.tagName, typeAttr);
      if (kind === 'checkbox' || kind === 'radio') {
        void appendRecordingEvent(
          buildEvent('change', el, { inputType: kind, checked: (el as HTMLInputElement).checked }),
        ).then(() => void refreshHud());
      } else if (kind === 'select') {
        void appendRecordingEvent(
          buildEvent('change', el, { inputType: 'select', value: (el as HTMLSelectElement).value }),
        ).then(() => void refreshHud());
      }
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (withinOwnUi(e)) return;
      if (e.key !== 'Enter') return;
      const el = e.target instanceof Element ? e.target : null;
      void appendRecordingEvent(buildEvent('keydown', el, { value: 'Enter' })).then(() => void refreshHud());
    },
    true,
  );
}

/**
 * The recorder's entry point — injected once for the very first page of a
 * recording (via `chrome.scripting.executeScript` from the popup) and once
 * per navigation after that (via a dynamic content-script registration
 * scoped to the granted origin, see `background/index.ts`). Renders the
 * always-on HUD while recording, or the review/export panel once stopped but
 * not yet discarded — the same module handles both so a stray injection on
 * an already-stopped recording still shows something useful instead of
 * nothing.
 */
async function runRecordPanel(): Promise<void> {
  const g = globalThis as any;
  if (g.__piwiRecordPanelActive) return;
  g.__piwiRecordPanelActive = true;

  const state = await getRecordingState();
  if (state.active) {
    // Seed this page's own URL so a mid-recording navigation's `RecordedStep`s
    // carry the right `pageUrl`; only the very first one across the whole
    // recording survives into a `page.goto()` — see `normalizeSteps`.
    await appendRecordingEvent(buildEvent('navigate', null, { value: location.href }));
    attachListeners();
    await refreshHud();
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'piwi-recording-stopped')
        void getRecordingState().then((s) => void renderReviewPanel(s.events));
    });
  } else if (state.events.length > 0) {
    await renderReviewPanel(state.events);
  }
}

void runRecordPanel();
