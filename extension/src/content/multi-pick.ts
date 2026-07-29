import {
  installPickerOverlay,
  removePickerOverlay,
  highlightLocator,
  type PickerOverlayArg,
} from '@piwitests/picker-dom';
import { derivePattern, type PatternResult } from './multi-pick-derive.js';
import { TAG_TO_ROLE, INPUT_TYPE_TO_ROLE } from '@piwitests/core/locator-generation';
import { COPY_MODES, COPY_MODE_LABELS, renderCopyMode } from '../shared/copy-modes.js';
import { getLastCopyMode, setLastCopyMode } from '../shared/storage.js';

const ROLE_MAPS = { tagRoles: TAG_TO_ROLE, inputRoles: INPUT_TYPE_TO_ROLE };
const MIN_PICKS = 2;
const MAX_PICKS = 3;
const PANEL_HOST_ID = 'piwi-multi-pick-panel-host';

const PICK_GLOBALS = ['__piwiPickState', '__piwiPickedElement'] as const;

function clearPickGlobals(): void {
  for (const key of PICK_GLOBALS) delete (globalThis as any)[key];
}

/** Poll for a global the picker overlay sets, mirroring `pick.ts`'s own helper — multi-pick only ever needs the element-pick step, never the anchors step. */
function waitForGlobal<T>(key: string): Promise<T> {
  return new Promise((resolve) => {
    const check = () => {
      const value = (globalThis as any)[key];
      if (value !== undefined) {
        resolve(value as T);
        return;
      }
      setTimeout(check, 120);
    };
    check();
  });
}

async function pickOne(): Promise<Element | null> {
  clearPickGlobals();
  const overlayArg: PickerOverlayArg = { transport: 'global', failing: null };
  installPickerOverlay(overlayArg);
  const state = await waitForGlobal<string>('__piwiPickState');
  const el = state === 'picked' ? ((globalThis as any).__piwiPickedElement as Element) : null;
  // A pick (as opposed to a skip) leaves the banner/highlight mounted — fine
  // for pick.ts's single-shot flow, but this runs the overlay 2-3 times in a
  // row, so each cycle must tear its own down before the next installs one.
  removePickerOverlay();
  clearPickGlobals();
  return el;
}

/** A dismissible bottom bar shown between mandatory picks, once the 2-pick minimum is met: derive now, pick a 3rd, or cancel. Not shown while a pick itself is in progress, so it never contends with the picker overlay's own key handling. */
function showBetweenPicksBar(count: number): Promise<'pick-more' | 'derive' | 'cancel'> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = 'piwi-multi-pick-bar-host';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      .bar {
        position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); pointer-events: auto;
        display: flex; align-items: center; gap: 8px; background: #111827; color: #f9fafb;
        border-radius: 10px; padding: 8px 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4);
        font: 13px ui-sans-serif, system-ui, -apple-system, sans-serif;
      }
      @media (prefers-color-scheme: light) {
        .bar { background: #ffffff; color: #111827; box-shadow: 0 8px 30px rgba(0,0,0,.2); }
      }
      button {
        border-radius: 6px; padding: 5px 10px; font: inherit; font-size: 12.5px; cursor: pointer;
        border: 1px solid rgba(128,128,128,.3); background: rgba(128,128,128,.12); color: inherit;
      }
      button:hover, button:focus-visible { background: rgba(128,128,128,.25); }
      button.primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
      .close { border: none; background: none; opacity: .7; font-size: 16px; line-height: 1; padding: 2px 6px; }
    `;
    root.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const label = document.createElement('span');
    label.textContent = `${count} similar items picked.`;
    const deriveBtn = document.createElement('button');
    deriveBtn.type = 'button';
    deriveBtn.className = 'primary';
    deriveBtn.textContent = 'Derive pattern';
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.textContent = `Pick another (up to ${MAX_PICKS})`;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'close';
    closeBtn.setAttribute('aria-label', 'Cancel multi-pick');
    closeBtn.textContent = '×';
    bar.append(label, moreBtn, deriveBtn, closeBtn);
    root.appendChild(bar);

    const finish = (result: 'pick-more' | 'derive' | 'cancel') => {
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      resolve(result);
    };
    // Escape is the only global shortcut — Enter is deliberately *not*
    // hijacked here: deriveBtn is focused by default, so Enter/Space already
    // activates it natively, and Tab must still reach moreBtn/closeBtn and
    // have Enter/Space activate whichever of those is actually focused
    // instead of always deriving.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish('cancel');
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    deriveBtn.addEventListener('click', () => finish('derive'));
    moreBtn.addEventListener('click', () => finish('pick-more'));
    closeBtn.addEventListener('click', () => finish('cancel'));
    deriveBtn.focus();
  });
}

/** A transient, auto-dismissing message — used only for "no common pattern found" today. */
function showMessage(text: string): Promise<void> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = 'piwi-multi-pick-message-host';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .bar {
        position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); pointer-events: auto;
        background: #111827; color: #f9fafb; border-radius: 10px; padding: 10px 14px;
        box-shadow: 0 8px 30px rgba(0,0,0,.4); font: 13px ui-sans-serif, system-ui, -apple-system, sans-serif;
        max-width: min(480px, 90vw); cursor: pointer;
      }
      @media (prefers-color-scheme: light) {
        .bar { background: #ffffff; color: #111827; box-shadow: 0 8px 30px rgba(0,0,0,.2); }
      }
    `;
    root.appendChild(style);
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.textContent = text;
    root.appendChild(bar);

    const finish = () => {
      document.removeEventListener('keydown', onKeyDown, true);
      clearTimeout(timer);
      host.remove();
      resolve();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    bar.addEventListener('click', finish);
    const timer = setTimeout(finish, 4000);
  });
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

async function renderPatternPanel(result: PatternResult): Promise<void> {
  document.getElementById(PANEL_HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    .backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,.35);
      display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh;
    }
    .panel {
      background: #111827; color: #f9fafb; border-radius: 12px; padding: 16px;
      width: min(640px, 92vw); max-height: 78vh; overflow: auto;
      box-shadow: 0 8px 40px rgba(0,0,0,.5); font-size: 13px; line-height: 1.5;
    }
    @media (prefers-color-scheme: light) {
      .panel { background: #ffffff; color: #111827; box-shadow: 0 8px 40px rgba(0,0,0,.2); }
    }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .title { font-weight: 600; font-size: 14px; }
    .sub { color: #9ca3af; font-size: 12px; }
    .close {
      background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 18px;
      line-height: 1; padding: 4px 8px; border-radius: 6px;
    }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
    .row { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
    code { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; margin-bottom: 6px; }
    .warn { color: #fbbf24; font-size: 11px; margin-bottom: 6px; }
    .copy-row { display: flex; gap: 6px; flex-wrap: wrap; }
    button.copy {
      background: rgba(128,128,128,.12); color: inherit; border: 1px solid rgba(128,128,128,.3);
      border-radius: 6px; padding: 4px 9px; font-size: 11.5px; cursor: pointer;
    }
    button.copy:hover, button.copy:focus-visible { background: rgba(128,128,128,.25); }
    button.copy[data-active="true"] { border-color: #7c3aed; color: #a78bfa; }
  `;
  root.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Piwi multi-pick pattern');
  panel.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `${result.rows.length} locators from ${result.baseLocator}`;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = 'Esc to close';
  titleWrap.append(title, sub);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  header.append(titleWrap, closeBtn);
  panel.appendChild(header);

  let activeMode = await getLastCopyMode();

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      resolve();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    closeBtn.addEventListener('click', finish);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish();
    });

    for (const row of result.rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      const code = document.createElement('code');
      code.innerHTML = highlightLocator(row.locator);
      rowEl.appendChild(code);

      if (row.indexBased) {
        const warn = document.createElement('div');
        warn.className = 'warn';
        warn.textContent = '⚠ index-based (nth) — breaks if the list reorders';
        rowEl.appendChild(warn);
      }

      const copyRow = document.createElement('div');
      copyRow.className = 'copy-row';
      for (const mode of COPY_MODES) {
        const btn = document.createElement('button');
        btn.className = 'copy';
        btn.type = 'button';
        btn.dataset.active = String(mode === activeMode);
        btn.textContent = COPY_MODE_LABELS[mode];
        btn.addEventListener('click', () => {
          void copyToClipboard(renderCopyMode({ locator: row.locator }, mode), btn);
          activeMode = mode;
          void setLastCopyMode(mode);
          for (const sibling of copyRow.querySelectorAll('button.copy')) {
            (sibling as HTMLElement).dataset.active = String(sibling === btn);
          }
        });
        copyRow.appendChild(btn);
      }
      rowEl.appendChild(copyRow);
      panel.appendChild(rowEl);
    }

    backdrop.appendChild(panel);
    root.appendChild(backdrop);
    panel.focus();
  });
}

/**
 * Runs the multi-pick flow (A7): pick 2-3 similar items, then derive a
 * shared list-locator pattern. Requires the mandatory first two picks, then
 * offers a 3rd (stronger sample) or deriving now — Escape during any
 * individual pick cancels the whole session, and Escape/close on the
 * between-picks bar or results panel each cancel just that step.
 */
async function runMultiPick(): Promise<void> {
  const g = globalThis as any;
  if (g.__piwiMultiPicking) return;
  g.__piwiMultiPicking = true;
  try {
    const picked: Element[] = [];
    for (let i = 0; i < MIN_PICKS; i++) {
      const el = await pickOne();
      if (!el) return;
      picked.push(el);
    }

    while (picked.length < MAX_PICKS) {
      const action = await showBetweenPicksBar(picked.length);
      if (action === 'cancel') return;
      if (action === 'derive') break;
      const el = await pickOne();
      if (!el) return;
      picked.push(el);
    }

    const result = derivePattern(picked, ROLE_MAPS);
    if (result.rows.length === 0) {
      await showMessage(
        "Couldn't find a pattern — pick items that share a role (e.g. table rows) or a CSS class (e.g. cards).",
      );
      return;
    }
    await renderPatternPanel(result);
  } finally {
    g.__piwiMultiPicking = false;
  }
}

void runMultiPick();
