import type { RankedLocator } from '@piwitests/picker-dom';
import { highlightLocator } from '@piwitests/picker-dom';
import { TAG_TO_ROLE, INPUT_TYPE_TO_ROLE } from '@piwitests/core/locator-generation';
import { COPY_MODES, COPY_MODE_LABELS, renderCopyMode } from '../shared/copy-modes.js';
import { getLastCopyMode, setLastCopyMode } from '../shared/storage.js';
import { liveCount } from './live-count.js';

const ROLE_MAPS = { tagRoles: TAG_TO_ROLE, inputRoles: INPUT_TYPE_TO_ROLE };

const HOST_ID = 'piwi-picker-results-host';

/**
 * Renders the ranked-locator results panel in a closed shadow root — the
 * copy modes are extension-specific (the reporter's equivalent panel,
 * `showPickerChoices`, exists to commit a single replacement, not to browse
 * several source-code renderings of each candidate), so this is native
 * extension UI rather than a reuse of picker-dom's confirm step.
 *
 * Resolves once the user dismisses the panel (Escape or the close button).
 */
export async function renderResultsPanel(ranked: RankedLocator[]): Promise<void> {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
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
    @media (prefers-reduced-motion: no-preference) {
      .panel { animation: piwi-in 120ms ease-out; }
    }
    @keyframes piwi-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .title { font-weight: 600; font-size: 14px; }
    .sub { color: #9ca3af; font-size: 12px; }
    .close {
      background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 18px;
      line-height: 1; padding: 4px 8px; border-radius: 6px;
    }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
    .row {
      border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px;
    }
    .row-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .score {
      color: #a78bfa; font-variant-numeric: tabular-nums; font-size: 11px; flex-shrink: 0;
      border: 1px solid #a78bfa55; border-radius: 999px; padding: 1px 7px;
    }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
    .copy-row { display: flex; gap: 6px; flex-wrap: wrap; }
    button.copy {
      background: rgba(128,128,128,.12); color: inherit; border: 1px solid rgba(128,128,128,.3);
      border-radius: 6px; padding: 4px 9px; font-size: 11.5px; cursor: pointer;
    }
    button.copy:hover, button.copy:focus-visible { background: rgba(128,128,128,.25); }
    button.copy[data-active="true"] { border-color: #7c3aed; color: #a78bfa; }
    button.copy .done { color: #4ade80; }
    .footer { color: #9ca3af; font-size: 11px; margin-top: 4px; }
    .unique { color: #4ade80; font-size: 11px; }
    .ambiguous { color: #fbbf24; font-size: 11px; }
  `;
  root.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Piwi locator picker results');
  panel.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `${ranked.length} locator${ranked.length === 1 ? '' : 's'} — ranked by stability`;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = 'Esc to close · Tab between rows';
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish();
      }
    };
    const finish = () => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      resolve();
    };
    document.addEventListener('keydown', onKeyDown, true);
    closeBtn.addEventListener('click', finish);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish();
    });

    for (const [i, alt] of ranked.entries()) {
      const row = document.createElement('div');
      row.className = 'row';
      const top = document.createElement('div');
      top.className = 'row-top';
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = String(alt.score);
      const code = document.createElement('code');
      code.innerHTML = highlightLocator(alt.locator);
      top.append(score, code);
      row.appendChild(top);

      const copyRow = document.createElement('div');
      copyRow.className = 'copy-row';
      for (const mode of COPY_MODES) {
        const btn = document.createElement('button');
        btn.className = 'copy';
        btn.type = 'button';
        btn.dataset.active = String(mode === activeMode);
        btn.textContent = COPY_MODE_LABELS[mode];
        btn.addEventListener('click', () => {
          void copyToClipboard(renderCopyMode(alt, mode), btn);
          activeMode = mode;
          void setLastCopyMode(mode);
          for (const sibling of copyRow.querySelectorAll('button.copy')) {
            (sibling as HTMLElement).dataset.active = String(sibling === btn);
          }
        });
        copyRow.appendChild(btn);
      }
      row.appendChild(copyRow);

      // Live re-check: a page can re-render between the pick and this panel
      // opening, so re-verify uniqueness right now rather than trusting the
      // count captured at pick time. Ambiguous candidates are flagged, not
      // dropped — some shapes aren't safely re-checkable (see live-count.ts)
      // and show no badge rather than a guessed one.
      const { count } = liveCount(alt, ROLE_MAPS);
      if (count != null) {
        const badge = document.createElement('div');
        if (count === 1) {
          badge.className = 'unique';
          badge.textContent = '✓ matches exactly 1 element right now';
        } else {
          badge.className = 'ambiguous';
          badge.textContent = `⚠ matches ${count} elements right now — add .first() or .filter({ hasText: … })`;
        }
        row.appendChild(badge);
      }

      panel.appendChild(row);

      if (i === 0) {
        const footer = document.createElement('div');
        footer.className = 'footer';
        footer.textContent = 'Top pick — highest stability score.';
        row.appendChild(footer);
      }
    }

    backdrop.appendChild(panel);
    root.appendChild(backdrop);
    panel.focus();
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
