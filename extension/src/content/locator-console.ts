import { parseLocatorExpression } from '../shared/locator-expr.js';
import { evaluateLocatorChain } from './locator-eval.js';
import { TAG_TO_ROLE, INPUT_TYPE_TO_ROLE } from '@piwitests/core/locator-generation';

const ROLE_MAPS = { tagRoles: TAG_TO_ROLE, inputRoles: INPUT_TYPE_TO_ROLE };
const HOST_ID = 'piwi-locator-console-host';
const MAX_HIGHLIGHTS = 50;

/**
 * Toggleable "debugging half of the picker": type a locator expression, see
 * every match highlighted in-page and a live count/strict-mode verdict, with
 * no `eval` involved anywhere (`parseLocatorExpression` + `evaluateLocatorChain`
 * are both hand-rolled). A second trigger (or Escape) closes it — state lives
 * on `globalThis`, same toggle pattern as hover-inspect.
 *
 * Unlike the full-backdrop results panel, the host stays `pointer-events:
 * none` so the page underneath remains clickable/scrollable while the console
 * is open; only the input bar itself opts back into pointer events.
 */
function toggleLocatorConsole(): void {
  const g = globalThis as any;
  if (g.__piwiLocatorConsoleOff) {
    g.__piwiLocatorConsoleOff();
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .bar {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); pointer-events: auto;
      display: flex; align-items: center; gap: 8px; background: #111827; color: #f9fafb;
      border-radius: 10px; padding: 8px 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4);
      font: 13px ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: min(720px, 92vw);
    }
    @media (prefers-color-scheme: light) {
      .bar { background: #ffffff; color: #111827; box-shadow: 0 8px 30px rgba(0,0,0,.2); }
    }
    input {
      background: rgba(128,128,128,.12); color: inherit; border: 1px solid rgba(128,128,128,.3);
      border-radius: 6px; padding: 5px 8px; font: 12.5px ui-monospace, monospace; width: 360px; max-width: 40vw;
    }
    input:focus-visible { outline: 2px solid #7c3aed; outline-offset: 1px; }
    .verdict { font-size: 12px; white-space: nowrap; flex-shrink: 0; }
    .verdict.ok { color: #4ade80; }
    .verdict.warn { color: #fbbf24; }
    .verdict.err { color: #f87171; }
    .close {
      background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 16px;
      line-height: 1; padding: 2px 6px; border-radius: 6px; flex-shrink: 0;
    }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.2); }
    .box {
      position: fixed; pointer-events: none; box-sizing: border-box; border: 2px solid #7c3aed;
      background: rgba(124,58,237,.10); border-radius: 3px;
    }
  `;
  root.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'bar';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = `getByRole('button', { name: 'Pay' })`;
  input.setAttribute('aria-label', 'Locator expression');
  input.spellcheck = false;
  const verdict = document.createElement('span');
  verdict.className = 'verdict';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close locator console');
  closeBtn.textContent = '×';
  bar.append(input, verdict, closeBtn);
  root.appendChild(bar);

  let boxes: HTMLDivElement[] = [];
  const clearBoxes = () => {
    for (const b of boxes) b.remove();
    boxes = [];
  };

  let lastElements: Element[] = [];
  const drawBoxes = () => {
    clearBoxes();
    for (const el of lastElements.slice(0, MAX_HIGHLIGHTS)) {
      const r = el.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'box';
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      root.appendChild(box);
      boxes.push(box);
    }
  };

  const update = () => {
    const expr = input.value.trim();
    if (!expr) {
      verdict.className = 'verdict';
      verdict.textContent = '';
      lastElements = [];
      clearBoxes();
      return;
    }
    try {
      const chain = parseLocatorExpression(expr);
      const { elements, exact } = evaluateLocatorChain(chain, ROLE_MAPS);
      lastElements = elements;
      drawBoxes();
      const approx = exact ? '' : ' · approximate match';
      if (elements.length === 1) {
        verdict.className = 'verdict ok';
        verdict.textContent = `✓ 1 match — passes strict mode${approx}`;
      } else if (elements.length === 0) {
        verdict.className = 'verdict warn';
        verdict.textContent = `0 matches${approx}`;
      } else {
        const shown = elements.length > MAX_HIGHLIGHTS ? ` (first ${MAX_HIGHLIGHTS} highlighted)` : '';
        verdict.className = 'verdict warn';
        verdict.textContent = `⚠ ${elements.length} matches — fails strict mode${shown}${approx}`;
      }
    } catch (e) {
      lastElements = [];
      clearBoxes();
      verdict.className = 'verdict err';
      verdict.textContent = e instanceof Error ? e.message : 'invalid expression';
    }
  };
  input.addEventListener('input', update);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      off();
    }
  };
  const reposition = () => drawBoxes();

  const off = () => {
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition, true);
    host.remove();
    delete g.__piwiLocatorConsoleOff;
  };
  g.__piwiLocatorConsoleOff = off;
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition, true);
  closeBtn.addEventListener('click', off);

  input.focus();
}

toggleLocatorConsole();
