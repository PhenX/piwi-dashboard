import { describe, test, expect } from 'vitest';
import { renderSnapshotHtml, sanitizeDomSnapshot } from '~~/server/utils/dom-snapshot';
import type { TraceFrameSnapshot } from '~~/server/utils/trace-parser';

function snap(overrides: Partial<TraceFrameSnapshot>): TraceFrameSnapshot {
  return { frameId: 'frame@1', isMainFrame: true, html: ['HTML', {}], ...overrides };
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
            ['BODY', {}, ['H1', {}, 'Checkout'], ['INPUT', { id: 'email', type: 'email' }], ['DIV', { class: 'x' }, 'a < b']],
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
      [snap({ snapshotName: 's1', html: ['HTML', {}, ['SCRIPT', {}, 'window.secret = "abc";'] ] })],
      's1',
    );
    expect(html).toBe('<html><script></script></html>');
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
    const html = renderSnapshotHtml(
      [snap({ snapshotName: 's1', html: ['HTML', {}, ['BODY', {}, [[5, 99]]]] })],
      's1',
    );
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
