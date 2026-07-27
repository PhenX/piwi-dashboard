import { describe, test, expect, vi, beforeEach } from 'vitest';

// Back the storage adapter with an in-memory file map so the whole inlining
// path (ZIP read → .trace/.network parse → resource reads) runs end to end
// without touching disk. `vi.hoisted` lets the factory below reach the map.
const { storageFiles } = vi.hoisted(() => ({ storageFiles: new Map<string, Buffer>() }));
vi.mock('../../server/storage', () => ({
  getStorage: () => ({
    readFile: async (path: string) => {
      const bytes = storageFiles.get(path);
      if (!bytes) throw new Error(`ENOENT: ${path}`);
      return bytes;
    },
  }),
}));

import { getTraceDomSnapshot } from '~~/server/utils/dom-snapshot';
import { buildZip } from '~~/server/utils/trace-zip';

/**
 * A minimal slim trace ZIP: one main-frame snapshot linking an external
 * stylesheet, and a `.network` stream mapping that stylesheet and its
 * background image to stored resources — the exact shape the picker inlines.
 */
function buildTraceZip(): Buffer {
  const frameSnapshot = {
    type: 'frame-snapshot',
    snapshot: {
      snapshotName: 's1',
      frameId: 'f1',
      isMainFrame: true,
      frameUrl: 'http://app.local/page',
      doctype: 'html',
      viewport: { width: 800, height: 600 },
      html: [
        'HTML',
        {},
        ['HEAD', {}, ['LINK', { rel: 'stylesheet', href: '/app.css' }]],
        ['BODY', {}, ['DIV', { class: 'logo' }, 'hi']],
      ],
    },
  };
  const resourceSnap = (url: string, sha1: string, mimeType: string) => ({
    type: 'resource-snapshot',
    snapshot: { request: { url }, response: { content: { _sha1: sha1, mimeType } } },
  });
  const network = [
    resourceSnap('http://app.local/app.css', 'css1', 'text/css'),
    resourceSnap('http://app.local/img/logo.png', 'img1', 'image/png'),
    resourceSnap('http://app.local/theme.css', 'theme1', 'text/css'),
    resourceSnap('http://app.local/img/sprite.svg', 'svg1', 'image/svg+xml'),
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');
  return buildZip([
    { name: '0-trace.trace', data: Buffer.from(JSON.stringify(frameSnapshot), 'utf8') },
    { name: '0-trace.network', data: Buffer.from(network, 'utf8') },
  ]);
}

const BLOB = 'project-7/blobs/abc.zip';
const HEX_SECRET = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'; // 40 hex chars → masked
// The stylesheet pulls in a background image, an @import'ed sheet, and a
// fragment-addressed SVG sprite, and carries a token-shaped secret — one fixture
// exercises every inlining path plus masking.
const CSS =
  `@import url(/theme.css);` +
  `.logo{background:url(/img/logo.png)}` +
  `.k{--t:"${HEX_SECRET}"}` +
  `.i{background:url(/img/sprite.svg#star)}`;
const THEME_CSS = `.t{background:url(/img/logo.png)}`; // the imported sheet has its own asset
const PNG = Buffer.from('PNGBYTES');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><symbol id="star"></symbol></svg>');

beforeEach(() => {
  storageFiles.clear();
  storageFiles.set(BLOB, buildTraceZip());
  storageFiles.set('project-7/trace-resources/css1', Buffer.from(CSS, 'utf8'));
  storageFiles.set('project-7/trace-resources/img1', PNG);
  storageFiles.set('project-7/trace-resources/theme1', Buffer.from(THEME_CSS, 'utf8'));
  storageFiles.set('project-7/trace-resources/svg1', SVG);
});

describe('getTraceDomSnapshot — stylesheet + asset inlining', () => {
  test('inlines the stylesheet, embeds its url() image as a data URI, and masks secrets last', async () => {
    const res = await getTraceDomSnapshot(BLOB, 1_000_000, { inlineStyles: true });
    expect(res.status).toBe('ok');
    // The <link> became an inline <style>.
    expect(res.html).toContain('<style>');
    expect(res.html).not.toContain('<link rel="stylesheet"');
    // The CSS url() now points at the base64-embedded image — proving assets are
    // inlined AND that the later secret-mask left the fresh data URI intact.
    expect(res.html).toContain(`url("data:image/png;base64,${PNG.toString('base64')}")`);
    // …while the token-shaped secret in the same sheet is still scrubbed.
    expect(res.html).toContain('[masked-hex]');
    expect(res.html).not.toContain(HEX_SECRET);
  });

  test('recursively embeds an @import chain, inlining the imported sheet AND its own assets', async () => {
    const res = await getTraceDomSnapshot(BLOB, 1_000_000, { inlineStyles: true });
    // The @import becomes an embedded stylesheet…
    const m = /url\("(data:text\/css;base64,[^"#)]+)"\)/.exec(res.html!);
    expect(m).not.toBeNull();
    // …and decoding it shows the imported sheet's OWN url() image was embedded too.
    const importedCss = Buffer.from(m![1].split('base64,')[1]!, 'base64').toString('utf8');
    expect(importedCss).toContain(`url("data:image/png;base64,${PNG.toString('base64')}")`);
  });

  test('embeds a fragment-addressed SVG sprite and preserves the #fragment on the data URI', async () => {
    const res = await getTraceDomSnapshot(BLOB, 1_000_000, { inlineStyles: true });
    expect(res.html).toContain(`url("data:image/svg+xml;base64,${SVG.toString('base64')}#star")`);
  });

  test('leaves the external <link> untouched when inlineStyles is off (the read-only card path)', async () => {
    const res = await getTraceDomSnapshot(BLOB, 1_000_000);
    expect(res.status).toBe('ok');
    expect(res.html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(res.html).not.toContain('data:image/png');
  });

  test('keeps the <link> when the stylesheet resource is missing (graceful degradation)', async () => {
    storageFiles.delete('project-7/trace-resources/css1');
    const res = await getTraceDomSnapshot(BLOB, 1_000_000, { inlineStyles: true });
    expect(res.status).toBe('ok');
    expect(res.html).toContain('<link rel="stylesheet" href="/app.css">');
  });
});
