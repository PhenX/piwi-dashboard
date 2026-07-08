import { describe, it, expect, vi } from 'vitest';
import type { Locator } from '@playwright/test';
import { ariaSnapshotBestEffort, probeElementAttrs } from '../src/internal/capture/capture-fixtures.js';

/** A minimal fake Locator exposing only what ariaSnapshotBestEffort touches. */
function fakeLocator(ariaSnapshot?: (opts?: unknown) => Promise<string>): Locator {
  return { ariaSnapshot } as unknown as Locator;
}

/**
 * A minimal fake DOM element exposing only what probeElementAttrs touches:
 * getAttribute, direct properties, getBoundingClientRect, ownerDocument
 * (CSS.escape + querySelectorAll), tagName, textContent, labels.
 */
function fakeElement(opts: {
  tagName?: string;
  attrs?: Record<string, string>;
  props?: Record<string, unknown>;
  rect?: { x: number; y: number; width: number; height: number };
  textContent?: string;
  labelCount?: number;
  /** Maps a CSS selector to the number of matches querySelectorAll should report. */
  selectorMatches?: Record<string, number>;
  /** Throw instead of returning a count for a given selector (simulates an invalid selector). */
  throwingSelectors?: Set<string>;
  /** Make ownerDocument access itself throw, to exercise the outer best-effort catch. */
  brokenDocument?: boolean;
}): unknown {
  const {
    tagName = 'div',
    attrs = {},
    props = {},
    rect = { x: 0, y: 0, width: 10, height: 10 },
    textContent = '',
    labelCount = 0,
    selectorMatches = {},
    throwingSelectors = new Set<string>(),
  } = opts;

  const querySelectorAll = (sel: string) => {
    if (throwingSelectors.has(sel)) throw new Error(`invalid selector: ${sel}`);
    return { length: selectorMatches[sel] ?? 0 };
  };

  return {
    tagName: tagName.toUpperCase(), // real DOM tagName is uppercase; probe lowercases it
    getAttribute: (key: string) => (key in attrs ? attrs[key] : null),
    ...props,
    getBoundingClientRect: () => rect,
    textContent,
    labels: labelCount > 0 ? { length: labelCount } : null,
    ownerDocument: opts.brokenDocument
      ? undefined
      : {
          defaultView: { CSS: { escape: (s: string) => s } },
          querySelectorAll,
        },
  };
}

describe('ariaSnapshotBestEffort', () => {
  it('returns null when the installed Playwright predates locator.ariaSnapshot (< 1.49)', async () => {
    const locator = fakeLocator(undefined);
    expect(await ariaSnapshotBestEffort(locator)).toBeNull();
  });

  it('calls ariaSnapshot with mode: "ai" first and returns its result (>= 1.59)', async () => {
    const ariaSnapshot = vi.fn().mockResolvedValue('- button "Submit"');
    const locator = fakeLocator(ariaSnapshot);
    const result = await ariaSnapshotBestEffort(locator, 500);
    expect(result).toBe('- button "Submit"');
    expect(ariaSnapshot).toHaveBeenCalledTimes(1);
    expect(ariaSnapshot).toHaveBeenCalledWith({ timeout: 500, mode: 'ai' });
  });

  it('omits the timeout key entirely when none is given', async () => {
    const ariaSnapshot = vi.fn().mockResolvedValue('- text');
    const locator = fakeLocator(ariaSnapshot);
    await ariaSnapshotBestEffort(locator);
    expect(ariaSnapshot).toHaveBeenCalledWith({ mode: 'ai' });
  });

  it('falls back to { ref: true } when mode: "ai" rejects (1.52)', async () => {
    const ariaSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error('mode not supported'))
      .mockResolvedValueOnce('- ref-annotated snapshot');
    const locator = fakeLocator(ariaSnapshot);
    const result = await ariaSnapshotBestEffort(locator, 250);
    expect(result).toBe('- ref-annotated snapshot');
    expect(ariaSnapshot).toHaveBeenNthCalledWith(1, { timeout: 250, mode: 'ai' });
    expect(ariaSnapshot).toHaveBeenNthCalledWith(2, { timeout: 250, ref: true });
  });

  it('returns null (never throws) when both attempts reject', async () => {
    const ariaSnapshot = vi.fn().mockRejectedValue(new Error('nope'));
    const locator = fakeLocator(ariaSnapshot);
    await expect(ariaSnapshotBestEffort(locator)).resolves.toBeNull();
    expect(ariaSnapshot).toHaveBeenCalledTimes(2);
  });
});

describe('probeElementAttrs', () => {
  it('captures tagName (lowercased), attribute values, and geometry center', () => {
    const el = fakeElement({
      tagName: 'BUTTON',
      attrs: { type: 'submit' },
      rect: { x: 10, y: 20, width: 100, height: 50 },
    });
    const out = probeElementAttrs(el, ['type']);
    expect(out.tagName).toBe('button');
    expect(out.attributes).toEqual({ type: 'submit' });
    expect(out.center).toEqual({ x: 60, y: 45 });
  });

  it('falls back to a direct property when getAttribute returns null', () => {
    const el = fakeElement({ props: { value: 'a direct prop, not an attribute' } });
    const out = probeElementAttrs(el, ['value']);
    expect(out.attributes.value).toBe('a direct prop, not an attribute');
  });

  it('truncates attribute values to 200 chars and non-string values are stringified', () => {
    const el = fakeElement({ props: { 'aria-level': 3 }, attrs: { title: 'x'.repeat(250) } });
    const out = probeElementAttrs(el, ['title', 'aria-level']);
    expect(out.attributes.title).toHaveLength(200);
    expect(out.attributes['aria-level']).toBe('3');
  });

  it('records null for an attribute that is absent entirely', () => {
    const el = fakeElement({});
    const out = probeElementAttrs(el, ['data-missing']);
    expect(out.attributes['data-missing']).toBeNull();
  });

  it('collapses whitespace and truncates textContent to 80 chars', () => {
    const el = fakeElement({ textContent: `line one\n\n   line   two   ${'z'.repeat(100)}` });
    const out = probeElementAttrs(el, []);
    expect(out.textContent).not.toContain('\n');
    expect(out.textContent.length).toBeLessThanOrEqual(80);
    expect(out.textContent.startsWith('line one line two')).toBe(true);
  });

  it('sets hasLabel true only when the element has associated <label>s', () => {
    expect(probeElementAttrs(fakeElement({ labelCount: 1 }), []).hasLabel).toBe(true);
    expect(probeElementAttrs(fakeElement({ labelCount: 0 }), []).hasLabel).toBe(false);
  });

  it('computes selectorCounts for data-testid, id, name, and each class', () => {
    const el = fakeElement({
      attrs: { 'data-testid': 'save-btn', id: 'save', name: 'saveField', class: 'btn primary' },
      selectorMatches: {
        '[data-testid="save-btn"]': 1,
        '#save': 1,
        '[name="saveField"]': 2, // ambiguous — a real form field named the same on the page
        '.btn': 3,
        '.primary': 1,
      },
    });
    const out = probeElementAttrs(el, ['data-testid', 'id', 'name', 'class']);
    expect(out.selectorCounts.testId).toBe(1);
    expect(out.selectorCounts.id).toBe(1);
    expect(out.selectorCounts.name).toBe(2);
    expect(out.selectorCounts.classes).toEqual({ btn: 3, primary: 1 });
  });

  it('omits a selectorCounts key entirely when the element has no such attribute', () => {
    const el = fakeElement({});
    const out = probeElementAttrs(el, []);
    expect(out.selectorCounts).toEqual({});
  });

  it('ignores a selector that throws (invalid CSS) rather than failing the whole probe', () => {
    const el = fakeElement({
      attrs: { id: 'weird:id' },
      throwingSelectors: new Set(['#weird:id']),
    });
    const out = probeElementAttrs(el, ['id']);
    expect(out.selectorCounts.id).toBeUndefined();
    expect(out.tagName).toBe('div'); // the rest of the probe still completed
  });

  it('never fails the whole probe when ownerDocument access itself throws', () => {
    const el = fakeElement({ attrs: { id: 'x' }, brokenDocument: true });
    const out = probeElementAttrs(el, ['id']);
    expect(out.selectorCounts).toEqual({});
    expect(out.tagName).toBe('div');
  });

  it('caps the class list probed to the first 10 classes', () => {
    const classes = Array.from({ length: 15 }, (_, i) => `c${i}`);
    const el = fakeElement({
      attrs: { class: classes.join(' ') },
      selectorMatches: Object.fromEntries(classes.map((c) => [`.${c}`, 1])),
    });
    const out = probeElementAttrs(el, ['class']);
    expect(Object.keys(out.selectorCounts.classes ?? {})).toHaveLength(10);
  });
});
