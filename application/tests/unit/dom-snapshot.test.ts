import { describe, test, expect } from 'vitest';
import {
  renderSnapshotHtml,
  sanitizeDomSnapshot,
  extractDomSnapshot,
  resolveCaseDomSnapshot,
} from '~~/server/utils/dom-snapshot';
import { renderAriaSnapshotHtml } from '~~/server/utils/dom-snapshot-aria';
import type { TraceFrameSnapshot, ParsedTraceData } from '~~/server/utils/trace-parser';

function snap(overrides: Partial<TraceFrameSnapshot>): TraceFrameSnapshot {
  return { frameId: 'frame@1', isMainFrame: true, html: ['HTML', {}], ...overrides };
}

function traceData(frameSnapshots: TraceFrameSnapshot[]): ParsedTraceData {
  return {
    actions: [],
    consoleEntries: [],
    networkRequests: [],
    frameSnapshots,
    failingAction: null,
    failingActionIndex: -1,
    eventCount: 0,
    timeoutFallback: false,
    traceEndTime: 0,
  };
}

describe('renderSnapshotHtml', () => {
  test('renders a plain tree with attributes, text and void elements', () => {
    const html = renderSnapshotHtml(
      [
        snap({
          snapshotName: 'before@call@1',
          doctype: 'html',
          html: [
            'HTML',
            { lang: 'en' },
            [
              'BODY',
              {},
              ['H1', {}, 'Checkout'],
              ['INPUT', { id: 'email', type: 'email' }],
              ['DIV', { class: 'x' }, 'a < b'],
            ],
          ],
        }),
      ],
      'before@call@1',
    );
    expect(html).toBe(
      '<!DOCTYPE html>\n<html lang="en"><body><h1>Checkout</h1><input id="email" type="email"><div class="x">a &lt; b</div></body></html>',
    );
  });

  test('never emits __playwright_* attributes or inline handlers', () => {
    const html = renderSnapshotHtml(
      [
        snap({
          snapshotName: 's1',
          html: ['HTML', {}, ['BODY', {}, ['INPUT', { __playwright_value_: 'hunter2', id: 'pw', onclick: 'evil()' }]]],
        }),
      ],
      's1',
    );
    expect(html).toContain('<input id="pw">');
    expect(html).not.toContain('hunter2');
    expect(html).not.toContain('onclick');
  });

  test('drops script bodies but keeps the tag as a marker', () => {
    const html = renderSnapshotHtml(
      [snap({ snapshotName: 's1', html: ['HTML', {}, ['SCRIPT', {}, 'window.secret = "abc";']] })],
      's1',
    );
    expect(html).toBe('<html><script></script></html>');
  });

  const styleHeavy = (): Parameters<typeof renderSnapshotHtml>[0] => [
    snap({
      snapshotName: 's1',
      html: [
        'HTML',
        {},
        ['HEAD', {}, ['STYLE', {}, '.a{color:red}'.repeat(500)], ['LINK', { rel: 'stylesheet', href: '/app.css' }]],
        ['BODY', {}, ['BUTTON', { style: 'color:blue' }, 'Go']],
      ],
    }),
  ];

  test('keeps inline <style> bodies by default (full fidelity)', () => {
    const html = renderSnapshotHtml(styleHeavy(), 's1');
    expect(html).toContain('.a{color:red}');
    expect(html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(html).toContain('<button style="color:blue">Go</button>');
  });

  test('drops inline <style> bodies under dropStyles, keeping <link> and inline style attrs', () => {
    const html = renderSnapshotHtml(styleHeavy(), 's1', { dropStyles: true });
    expect(html).toContain('<style></style>');
    expect(html).not.toContain('color:red');
    expect(html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(html).toContain('<button style="color:blue">Go</button>');
  });

  test('resolves back-references against the earlier snapshot of the same frame', () => {
    const first = snap({
      snapshotName: 's1',
      html: ['HTML', {}, ['BODY', {}, ['DIV', { id: 'stable' }, 'unchanged content']]],
    });
    // Post-order node list of s1: ['unchanged content', DIV, BODY, HTML] → DIV is index 1.
    const second = snap({
      snapshotName: 's2',
      html: ['HTML', {}, ['BODY', {}, [[1, 1]], ['P', {}, 'new']]],
    });
    const html = renderSnapshotHtml([first, second], 's2');
    expect(html).toBe('<html><body><div id="stable">unchanged content</div><p>new</p></body></html>');
  });

  test('resolves chained references (a ref whose target itself refs further back)', () => {
    const s1 = snap({ snapshotName: 's1', html: ['HTML', {}, ['DIV', {}, 'root text']] });
    // s1 nodes: ['root text', DIV, HTML] → DIV at 1
    const s2 = snap({ snapshotName: 's2', html: ['HTML', {}, ['MAIN', {}, [[1, 1]]]] });
    // s2 nodes (refs skipped): [MAIN, HTML] → MAIN at 0
    const s3 = snap({ snapshotName: 's3', html: ['HTML', {}, [[1, 0]]] });
    const html = renderSnapshotHtml([s1, s2, s3], 's3');
    expect(html).toBe('<html><main><div>root text</div></main></html>');
  });

  test('emits a placeholder for unresolvable references instead of failing', () => {
    const html = renderSnapshotHtml([snap({ snapshotName: 's1', html: ['HTML', {}, ['BODY', {}, [[5, 99]]]] })], 's1');
    expect(html).toBe('<html><body><!-- [unresolved snapshot reference] --></body></html>');
  });

  test('returns null for an unknown snapshot name', () => {
    expect(renderSnapshotHtml([snap({ snapshotName: 's1' })], 'nope')).toBeNull();
  });

  test('prefers the main-frame snapshot when an iframe shares the name', () => {
    const iframe = snap({
      snapshotName: 's1',
      frameId: 'frame@iframe',
      isMainFrame: false,
      html: ['HTML', {}, ['BODY', {}, 'iframe content']],
    });
    const main = snap({ snapshotName: 's1', html: ['HTML', {}, ['BODY', {}, 'main content']] });
    expect(renderSnapshotHtml([iframe, main], 's1')).toContain('main content');
  });
});

describe('sanitizeDomSnapshot', () => {
  test('masks base64 data URIs, JWTs and long hex tokens', () => {
    const input =
      '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==">' +
      '<div data-auth="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpM">' +
      '<span>4a7d1ed414474e4033ac29ccb8653d9b4a7d1ed414474e40</span>';
    const { html, truncated } = sanitizeDomSnapshot(input, 10_000);
    expect(html).toContain('data:[masked]');
    expect(html).toContain('[masked-token]');
    expect(html).toContain('[masked-hex]');
    expect(html).not.toContain('iVBORw0KGgo');
    expect(html).not.toContain('eyJhbGciOiJIUzI1NiI');
    expect(truncated).toBe(false);
  });

  test('caps the output with a truncation marker', () => {
    const { html, truncated } = sanitizeDomSnapshot('<div>' + 'x'.repeat(500) + '</div>', 100);
    expect(truncated).toBe(true);
    expect(html.length).toBeLessThan(150);
    expect(html).toContain('<!-- [truncated] -->');
  });
});

describe('renderAriaSnapshotHtml', () => {
  test('renders each node with data-role/data-name plus real ARIA attrs for the picker', () => {
    const html = renderAriaSnapshotHtml('- button "Submit"\n- heading "Title" [level=2]')!;
    expect(html).toContain('data-role="button"');
    expect(html).toContain('data-name="Submit"');
    // Real ARIA attributes so the picker probe resolves getByRole('button', { name }).
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-label="Submit"');
    expect(html).toContain('data-role="heading"');
    expect(html).toContain('aria-level="2"');
    // Rendered as a tree, not a flat list.
    expect(html).toContain('pw-node');
  });

  test('nests children under their parent inside a tree container', () => {
    const html = renderAriaSnapshotHtml('- navigation "Main":\n  - link "Home"\n  - link "About"')!;
    const body = html.slice(html.indexOf('<body>'));
    // The parent row is followed by a children container holding both links.
    expect(body).toMatch(/data-name="Main"[^]*pw-children[^]*data-name="Home"[^]*data-name="About"/);
    expect((body.match(/data-role="link"/g) ?? []).length).toBe(2);
  });

  test('renders a heading state marker as a badge without polluting the name', () => {
    const html = renderAriaSnapshotHtml('- button "Save" [disabled]')!;
    expect(html).toContain('data-name="Save"');
    expect(html).toContain('data-badges="disabled"');
  });

  test('renders text nodes as pickable text (getByText) with no role locator', () => {
    const html = renderAriaSnapshotHtml('- text: Hello world')!;
    expect(html).toContain('data-pw-text');
    expect(html).toContain('data-pw-pick');
    expect(html).toContain('Hello world');
    // No aria-label / standalone role attribute (getByRole) for a bare text node.
    const body = html.slice(html.indexOf('<body>'));
    expect(body).not.toContain('aria-label=');
    expect(body).not.toMatch(/\srole=/); // data-role is fine; a real `role=` is not
  });

  test('does not leak its own styling classes onto pickable rows (no class= to probe)', () => {
    // The picker probes the picked element's `class`; ARIA rows must carry none,
    // or every pick would offer a bogus `locator('.pw-row')` alternative.
    const html = renderAriaSnapshotHtml('- button "Go"')!;
    const body = html.slice(html.indexOf('<body>'));
    expect(body).not.toContain('class=');
  });

  test('hoists nameless generic wrappers so their children stay at the top level', () => {
    const html = renderAriaSnapshotHtml('- generic:\n  - button "Go"')!;
    expect(html).toContain('data-role="button"');
    expect(html).not.toContain('data-role="generic"');
  });

  test('returns null when the ARIA snapshot yields no candidates', () => {
    expect(renderAriaSnapshotHtml('')).toBeNull();
    expect(renderAriaSnapshotHtml('not a yaml list at all')).toBeNull();
  });

  test('escapes the untrusted accessible name in both text and attribute contexts', () => {
    // `<` would inject markup into the chip text; `"` would break out of data-name.
    const html = renderAriaSnapshotHtml('- button "a\\"b<img src=x onerror=alert(1)>"')!;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('data-name="a&quot;b'); // quote escaped inside the attribute
  });

  // The demo picker renders these seeded ARIA snapshots (scripts/generate-demo-seed.mjs
  // `ariaSnapshotForCluster`) for failure clusters without a trace. Verify the exact
  // shapes — nested indentation, `[disabled]` markers, trailing `:` — parse into the
  // pickable chips the picker needs, so trace-less clusters aren't blank in the demo.
  test('renders the seeded strict-mode cluster snapshot into pickable button chips', () => {
    const html = renderAriaSnapshotHtml(
      '- document:\n  - button "Primary"\n  - button "Disabled" [disabled]\n  - button "Loading"',
    )!;
    expect(html).toContain('data-name="Primary"');
    expect(html).toContain('data-name="Disabled"'); // the `[disabled]` marker is ignored
    expect(html).toContain('data-name="Loading"');
    expect((html.match(/data-role="button"/g) ?? []).length).toBe(3);
  });

  test('renders the seeded getByLabel checkout cluster snapshot into pickable field chips', () => {
    const html = renderAriaSnapshotHtml(
      '- document:\n  - form "Checkout":\n    - combobox "Contact method"\n' +
        '    - textbox "Card number"\n    - textbox "Expiry date"\n    - textbox "CVV"\n    - button "Pay"',
    )!;
    expect(html).toContain('data-role="combobox"');
    expect(html).toContain('data-name="Contact method"');
    expect((html.match(/data-role="textbox"/g) ?? []).length).toBe(3);
    expect(html).toContain('data-name="Pay"');
  });
});

describe('resolveCaseDomSnapshot', () => {
  test('falls back to the ARIA tree when there is no trace', async () => {
    const res = await resolveCaseDomSnapshot(null, '- button "Go"');
    expect(res.status).toBe('ok');
    expect(res.snapshotName).toBe('aria-fallback');
    expect(res.source).toBe('aria');
    expect(res.availableSources).toEqual(['aria']);
    expect(res.html).toContain('data-role="button"');
  });

  test('source:aria renders the ARIA tree without parsing the trace, and lists both sources', async () => {
    // A trace path is present, but source:aria short-circuits before touching it,
    // so the toggle can still offer to switch back to the DOM view.
    const res = await resolveCaseDomSnapshot('demo/trace.zip', '- button "Go"', undefined, { source: 'aria' });
    expect(res.status).toBe('ok');
    expect(res.source).toBe('aria');
    expect(res.availableSources).toEqual(['dom', 'aria']);
    expect(res.html).toContain('data-role="button"');
  });

  test('returns no-trace when neither a trace nor an ARIA snapshot exists', async () => {
    expect((await resolveCaseDomSnapshot(null, null)).status).toBe('no-trace');
    expect((await resolveCaseDomSnapshot(null, 'no candidates here')).status).toBe('no-trace');
  });
});

describe('extractDomSnapshot — styled/lean two-pass', () => {
  // A page whose inline <style> dwarfs the body, with the body content last.
  const bigStyle = '.x{color:red}'.repeat(4000); // ~52k chars
  const page = (): TraceFrameSnapshot[] => [
    snap({
      snapshotName: 'after@call@1',
      viewport: { width: 1280, height: 720 },
      html: ['HTML', {}, ['HEAD', {}, ['STYLE', {}, bigStyle]], ['BODY', {}, ['BUTTON', {}, 'Click me']]],
    }),
  ];

  test('keeps inline styles when the styled render fits under the cap, and returns the viewport', () => {
    const res = extractDomSnapshot(traceData(page()), 1_000_000);
    expect(res.status).toBe('ok');
    expect(res.truncated).toBe(false);
    expect(res.html).toContain('.x{color:red}'); // styles preserved
    expect(res.html).toContain('<button>Click me</button>');
    expect(res.viewport).toEqual({ width: 1280, height: 720 });
  });

  test('falls back to a lean render (styles dropped) so the body survives a tiny cap', () => {
    // Cap smaller than the inline CSS — a styled render would truncate the body away.
    const res = extractDomSnapshot(traceData(page()), 5_000);
    expect(res.status).toBe('ok');
    expect(res.truncated).toBe(false); // lean render fits
    expect(res.html).toContain('<style></style>'); // CSS dropped
    expect(res.html).not.toContain('.x{color:red}');
    expect(res.html).toContain('<button>Click me</button>'); // body preserved
  });
});
