import { startTool, endTool, installEscapeToCancel } from '../shared/tool-session.js';
import { probeElementAttrs } from '@piwitests/picker-dom';
import {
  generateAlternatives,
  approximateAccessibleName,
  CAPTURED_ATTRIBUTES,
} from '@piwitests/core/locator-generation';

const HOST_ID = 'piwi-hover-inspect-host';
const PROBE_ARG = {
  keep: [...CAPTURED_ATTRIBUTES],
  includeStructural: false,
  includeLabelText: false,
};

/**
 * Toggleable "what would Piwi call this?" mode: the best-ranked locator for
 * whatever's under the cursor, shown in a tooltip, no click needed. A second
 * trigger (or Escape) turns it back off — state lives on `globalThis` so a
 * fresh injection of this same module toggles rather than stacking.
 */
function toggleHoverInspect(): void {
  const g = globalThis as any;
  if (g.__piwiHoverInspectOff) {
    g.__piwiHoverInspectOff();
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .box { position: fixed; pointer-events: none; box-sizing: border-box; border: 2px solid #7c3aed; background: rgba(124,58,237,.10); border-radius: 3px; display: none; }
    .tip {
      position: fixed; pointer-events: none; background: #111827; color: #f9fafb; font: 12px/1.4 ui-monospace, monospace;
      padding: 5px 9px; border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,.4); display: none; max-width: 60vw;
    }
    @media (prefers-color-scheme: light) { .tip { background: #ffffff; color: #111827; box-shadow: 0 4px 20px rgba(0,0,0,.2); } }
  `;
  const box = document.createElement('div');
  box.className = 'box';
  const tip = document.createElement('div');
  tip.className = 'tip';
  root.append(style, box, tip);

  let lastEl: Element | null = null;
  const onMove = (e: MouseEvent) => {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || host.contains(target)) return;
    if (target === lastEl) {
      position(target, e);
      return;
    }
    lastEl = target;
    const attrs = probeElementAttrs(target as any, PROBE_ARG);
    const accessibleName = approximateAccessibleName({ ...attrs, accessibleName: null });
    const ranked = generateAlternatives({ ...attrs, accessibleName });
    if (ranked.length === 0) {
      box.style.display = 'none';
      tip.style.display = 'none';
      return;
    }
    tip.textContent = ranked[0]!.locator;
    tip.style.display = 'block';
    box.style.display = 'block';
    position(target, e);
  };
  const position = (target: Element, e: MouseEvent) => {
    const r = target.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    const tipTop = r.top > 32 ? r.top - 28 : r.bottom + 6;
    tip.style.left = `${Math.min(e.clientX, window.innerWidth - 320)}px`;
    tip.style.top = `${tipTop}px`;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') off();
  };

  let toolEpoch = 0;
  const off = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    delete g.__piwiHoverInspectOff;
    endTool(toolEpoch);
  };
  g.__piwiHoverInspectOff = off;
  toolEpoch = startTool('hover-inspect', off);
  installEscapeToCancel();
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('keydown', onKey, true);
}

toggleHoverInspect();
