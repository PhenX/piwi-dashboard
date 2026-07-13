import type { Page, TestInfo } from '@playwright/test';
import {
  approximateAccessibleName,
  generateAlternatives,
  renderFailing,
  type AncestorAnchor,
  type FailedLocatorInfo,
  type LocatorSnapshot,
  type RankedLocator,
  type RolePosition,
  type SelectorCounts,
} from './locator-healing.js';

/**
 * Failure-time locator picker: when enabled (opt-in via the
 * `pickLocatorOnFailure` reporter option / `PIWI_PICK_LOCATOR_ON_FAIL`), a
 * test whose locator action failed gets a picker overlay injected into the
 * still-open page. The human clicks the element the locator should have
 * matched, the existing alternative-generation machinery ranks replacement
 * locators for it, and the human confirms one. The confirmed pick is folded
 * into the failing call site's locator snapshot (so it rides the normal
 * `piwi-locators` wire into the dashboard's healing panel) and attached as
 * `piwi-user-pick` plus a report annotation.
 *
 * Gated exactly like failure-time inspection (`inspect-on-failure.ts`):
 * headed browser, never CI, final attempt only.
 */

/** Element shape the in-page probe returns — structural view of what the picker needs. */
interface ProbedAttrs {
  tagName: string;
  attributes: Record<string, string | null>;
  textContent: string | null;
  center: { x: number; y: number } | null;
  hasLabel?: boolean;
  selectorCounts?: SelectorCounts;
  rolePosition?: RolePosition | null;
  ancestors?: AncestorAnchor[];
}

/**
 * The probe dependency, passed in by the capture fixture to avoid an import
 * cycle. `fn` is the fixture's in-page element probe (`probeElementAttrs`);
 * `el` is a browser-side element, hence `any` (no DOM lib in this package).
 */
export interface PickerProbe {
  fn: (el: any, arg: any) => ProbedAttrs;
  arg: unknown;
}

/** A confirmed pick — everything the fixture records about the human's choice. */
export interface UserPickResult {
  failing: {
    method: string;
    args: unknown[];
    /** The failed locator rendered as source, e.g. `getByText('Pay now')`. */
    rendered: string;
    /** Test call site (`file:line:col`) of the failed action, when captured. */
    location: string | null;
  };
  /** The alternative the human confirmed (also first in `alternatives`). */
  picked: RankedLocator;
  /** Full ranked list for the picked element, the confirmed pick first. */
  alternatives: RankedLocator[];
  /** Wire-shaped element snapshot of the picked element. */
  element: NonNullable<LocatorSnapshot['element']>;
}

/**
 * Runs inside the browser via `evaluate()` — installs the element-picking
 * overlay: a hover highlight, an instruction banner, and capture-phase
 * listeners that suppress the app's own handlers while picking. Resolves
 * through `__piwiPickState` ('picked' | 'skipped') polled from Node; the
 * picked element is parked in `__piwiPickedElement` for an `evaluateHandle`
 * read. Must stay fully self-contained (no module-closure references).
 */
export function installPickerOverlay(arg: { failing: string }): void {
  const g = globalThis as any;
  const doc = g.document;
  if (!doc || !doc.body) {
    g.__piwiPickState = 'skipped';
    return;
  }
  const Z = 2147483600;

  const highlight = doc.createElement('div');
  highlight.style.cssText =
    `position:fixed;pointer-events:none;z-index:${Z};display:none;box-sizing:border-box;` +
    'border:2px solid #7c3aed;background:rgba(124,58,237,.12);border-radius:3px;';
  const banner = doc.createElement('div');
  banner.style.cssText =
    `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:${Z + 2};` +
    'background:#111827;color:#f9fafb;font:13px/1.5 system-ui,sans-serif;' +
    'padding:10px 16px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:80vw;';
  banner.textContent = `Piwi locator picker — click the element that should replace ${arg.failing}. Press Esc to skip.`;
  doc.body.appendChild(highlight);
  doc.body.appendChild(banner);

  const stop = (e: any) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const isOwn = (el: any) => el === banner || el === highlight || (banner.contains && banner.contains(el));
  const onMove = (e: any) => {
    const el = e.target;
    if (!el || isOwn(el)) {
      highlight.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left = r.left + 'px';
    highlight.style.top = r.top + 'px';
    highlight.style.width = r.width + 'px';
    highlight.style.height = r.height + 'px';
  };
  const onClick = (e: any) => {
    stop(e);
    const el = e.target;
    if (!el || isOwn(el)) return;
    g.__piwiPickedElement = el;
    g.__piwiPickState = 'picked';
    removeListeners();
    highlight.style.display = 'none';
    banner.textContent = 'Piwi locator picker — analyzing element…';
  };
  const onKey = (e: any) => {
    if (e.key !== 'Escape') return;
    stop(e);
    g.__piwiPickState = 'skipped';
    cleanup();
  };
  // Suppress the app's own pointer handlers while picking — a pick must never
  // navigate or mutate the failing page under inspection.
  const suppressed = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick'];
  const removeListeners = () => {
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    for (const t of suppressed) doc.removeEventListener(t, stop, true);
  };
  const cleanup = () => {
    removeListeners();
    highlight.remove();
    banner.remove();
  };
  g.__piwiPickCleanup = cleanup;
  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  for (const t of suppressed) doc.addEventListener(t, stop, true);
}

/**
 * Runs inside the browser via `evaluate()` — replaces the pick overlay with a
 * confirmation panel listing the ranked replacement locators. The chosen index
 * lands in `__piwiPickChoice` (-1 = skipped), polled from Node. Must stay
 * fully self-contained.
 */
export function showPickerChoices(arg: { failing: string; choices: Array<{ locator: string; score: number }> }): void {
  const g = globalThis as any;
  const doc = g.document;
  if (!doc || !doc.body) {
    g.__piwiPickChoice = -1;
    return;
  }
  const Z = 2147483600;

  const wrap = doc.createElement('div');
  wrap.style.cssText =
    `position:fixed;inset:0;z-index:${Z + 3};background:rgba(0,0,0,.45);` +
    'display:flex;align-items:center;justify-content:center;font:13px/1.5 system-ui,sans-serif;';
  const panel = doc.createElement('div');
  panel.style.cssText =
    'background:#111827;color:#f9fafb;border-radius:10px;padding:20px;' +
    'max-width:640px;width:90vw;max-height:70vh;overflow:auto;box-shadow:0 8px 40px rgba(0,0,0,.5);';
  const title = doc.createElement('div');
  title.style.cssText = 'font-weight:600;margin-bottom:4px;';
  title.textContent = 'Pick a replacement locator';
  const sub = doc.createElement('div');
  sub.style.cssText = 'color:#9ca3af;margin-bottom:12px;';
  sub.textContent = `Replaces ${arg.failing} — ranked by stability score.`;
  panel.appendChild(title);
  panel.appendChild(sub);

  const done = (choice: number) => {
    g.__piwiPickChoice = choice;
    doc.removeEventListener('keydown', onKey, true);
    wrap.remove();
  };
  const onKey = (e: any) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    done(-1);
  };

  arg.choices.forEach((c, i) => {
    const btn = doc.createElement('button');
    btn.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;' +
      'text-align:left;background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:6px;' +
      'padding:8px 12px;margin:0 0 8px;cursor:pointer;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;';
    const code = doc.createElement('span');
    code.textContent = c.locator;
    code.style.cssText = 'word-break:break-all;';
    const score = doc.createElement('span');
    score.textContent = String(c.score);
    score.style.cssText = 'color:#a78bfa;flex-shrink:0;';
    btn.appendChild(code);
    btn.appendChild(score);
    btn.addEventListener('click', (e: any) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      done(i);
    });
    panel.appendChild(btn);
  });

  const skip = doc.createElement('button');
  skip.style.cssText =
    'background:none;border:none;color:#9ca3af;cursor:pointer;padding:6px 0 0;font:12px system-ui,sans-serif;';
  skip.textContent = 'Skip — keep the failure as-is (Esc)';
  skip.addEventListener('click', (e: any) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    done(-1);
  });
  panel.appendChild(skip);

  doc.addEventListener('keydown', onKey, true);
  wrap.appendChild(panel);
  doc.body.appendChild(wrap);
}

/** Best-effort in-page cleanup of every picker artifact. */
async function cleanupPicker(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const g = globalThis as any;
      if (typeof g.__piwiPickCleanup === 'function') g.__piwiPickCleanup();
      delete g.__piwiPickCleanup;
      delete g.__piwiPickState;
      delete g.__piwiPickChoice;
      delete g.__piwiPickedElement;
    });
  } catch {
    // The page may be gone — nothing left to clean.
  }
}

/**
 * Drive the full pick flow on the failing page: install the overlay, wait for
 * the human to click an element (or Esc), probe it, rank replacement locators
 * with the standard generation machinery, and wait for the human to confirm
 * one. The test timeout is lifted while waiting. Returns null when skipped or
 * when anything breaks — the picker must never mask the test's own failure.
 */
export async function runLocatorPicker(
  page: Page,
  testInfo: TestInfo,
  failed: FailedLocatorInfo,
  probe: PickerProbe,
): Promise<UserPickResult | null> {
  try {
    testInfo.setTimeout(0);
    const rendered = renderFailing(failed);
    console.log(
      `\n[piwi] "${testInfo.title}" ${testInfo.status} — locator picker open in the browser: ` +
        `click the element that should replace ${rendered} (Esc to skip).`,
    );

    await page.evaluate(installPickerOverlay, { failing: rendered });
    await page.waitForFunction(() => (globalThis as any).__piwiPickState !== undefined, undefined, {
      timeout: 0,
      polling: 250,
    });
    const state = (await page.evaluate(() => (globalThis as any).__piwiPickState)) as string;
    if (state !== 'picked') {
      await cleanupPicker(page);
      return null;
    }

    const handle = await page.evaluateHandle(() => (globalThis as any).__piwiPickedElement);
    const attrs = (await (handle as any).evaluate(probe.fn, probe.arg)) as ProbedAttrs;
    await handle.dispose();

    const accessibleName = approximateAccessibleName({ ...attrs, accessibleName: null });
    const ranked = generateAlternatives({ ...attrs, accessibleName });
    if (ranked.length === 0) {
      console.log('[piwi] No stable locator could be generated for the picked element — nothing recorded.');
      await cleanupPicker(page);
      return null;
    }

    await page.evaluate(showPickerChoices, {
      failing: rendered,
      choices: ranked.map((r) => ({ locator: r.locator, score: r.score })),
    });
    await page.waitForFunction(() => (globalThis as any).__piwiPickChoice !== undefined, undefined, {
      timeout: 0,
      polling: 250,
    });
    const choice = (await page.evaluate(() => (globalThis as any).__piwiPickChoice)) as number;
    await cleanupPicker(page);
    if (typeof choice !== 'number' || choice < 0 || choice >= ranked.length) return null;

    const picked: RankedLocator = { ...ranked[choice]!, pickedByUser: true };
    const alternatives = [picked, ...ranked.filter((_, i) => i !== choice)];
    const element: UserPickResult['element'] = {
      tagName: attrs.tagName,
      attributes: attrs.attributes,
      textContent: attrs.textContent,
      accessibleName,
      center: attrs.center,
      ...(attrs.rolePosition ? { rolePosition: attrs.rolePosition } : {}),
      ...(attrs.ancestors && attrs.ancestors.length > 0 ? { ancestors: attrs.ancestors } : {}),
    };

    const location = failed.location ?? null;
    console.log(
      `[piwi] Replacement picked for ${rendered}${location ? ` at ${location}` : ''}:\n[piwi]   ${picked.locator}`,
    );
    return {
      failing: { method: failed.method, args: failed.args, rendered, location },
      picked,
      alternatives,
      element,
    };
  } catch {
    return null;
  }
}

/**
 * Fold a confirmed pick into the captured snapshots: the failed action's
 * placeholder (same call site, no element — capture never probes an action
 * that threw) is filled with the picked element and the confirmed-first
 * alternative list, so the pick rides the normal `piwi-locators` attachment
 * into the dashboard's `locator_snapshots` and healing panel. No-op when the
 * failing call site was never captured (no location). Exported for tests.
 */
export function applyPickToSnapshots(snapshots: LocatorSnapshot[], pick: UserPickResult): boolean {
  if (!pick.failing.location) return false;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const snap = snapshots[i]!;
    if (snap.location !== pick.failing.location || snap.element) continue;
    snapshots[i] = {
      location: snap.location,
      used: snap.used,
      element: pick.element,
      alternatives: pick.alternatives.slice(0, 10),
    };
    return true;
  }
  return false;
}
