import { describe, test, expect, vi, beforeEach } from 'vitest';

// In-memory storage so the whole trace-snapshot path (ZIP read → parse → entry
// read → aria conversion) runs without disk. `vi.hoisted` shares the map.
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

import {
  getTraceSnapshotsFromBlob,
  getTraceSnapshotResourceFromBlob,
  getTraceFallbackAriaTextFromBlob,
} from '~~/server/utils/trace-evidence';
import { buildZip } from '~~/server/utils/trace-zip';

const ariaBefore = JSON.stringify([{ role: 'dialog', name: 'Pay', children: [{ role: 'button', name: 'Confirm' }] }]);
const ariaAfter = JSON.stringify([
  { role: 'dialog', name: 'Pay', children: [{ role: 'button', name: 'Confirm', disabled: true }] },
]);

/** A slim trace ZIP: two actions (the second failing), each with before/after aria + screen snapshots. */
function buildSnapshotTrace(): Buffer {
  const events = [
    { type: 'before', callId: 'c1', startTime: 100, class: 'Frame', method: 'goto', pageId: 'p1' },
    { type: 'aria-snapshot', callId: 'c1', phase: 'before', file: 'aria/c1-before.json' },
    { type: 'screenshot', callId: 'c1', phase: 'before', file: 'screenshots/c1-before.png' },
    { type: 'after', callId: 'c1', endTime: 200 },
    { type: 'before', callId: 'c2', startTime: 300, class: 'Frame', method: 'click', pageId: 'p1' },
    { type: 'aria-snapshot', callId: 'c2', phase: 'before', file: 'aria/c2-before.json' },
    { type: 'screenshot', callId: 'c2', phase: 'before', file: 'screenshots/c2-before.png' },
    { type: 'aria-snapshot', callId: 'c2', phase: 'after', file: 'aria/c2-after.json' },
    { type: 'after', callId: 'c2', endTime: 1800, error: { message: 'Timeout 1500ms exceeded.' } },
  ];
  const traceText = events.map((e) => JSON.stringify(e)).join('\n');
  return buildZip([
    { name: 'trace.trace', data: Buffer.from(traceText, 'utf8') },
    { name: 'aria/c1-before.json', data: Buffer.from(JSON.stringify([{ role: 'document' }]), 'utf8') },
    { name: 'aria/c2-before.json', data: Buffer.from(ariaBefore, 'utf8') },
    { name: 'aria/c2-after.json', data: Buffer.from(ariaAfter, 'utf8') },
    { name: 'screenshots/c1-before.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    { name: 'screenshots/c2-before.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]) },
  ]);
}

const BLOB = 'project-1/blobs/snap.zip';

beforeEach(() => {
  storageFiles.clear();
  storageFiles.set(BLOB, buildSnapshotTrace());
});

describe('getTraceSnapshotsFromBlob', () => {
  test('lists per-action aria/screen availability, marks the failing step, and diffs before→failure', async () => {
    const res = await getTraceSnapshotsFromBlob(BLOB);
    expect(res.status).toBe('ok');
    expect(res.failingCallId).toBe('c2');
    expect(res.hasAria).toBe(true);
    expect(res.hasScreen).toBe(true);
    expect(res.steps).toHaveLength(2);

    const [s1, s2] = res.steps;
    expect(s1).toMatchObject({
      callId: 'c1',
      failed: false,
      aria: { before: true, after: false },
      screen: { before: true, after: false },
    });
    expect(s2).toMatchObject({
      callId: 'c2',
      failed: true,
      aria: { before: true, after: true },
      screen: { before: true, after: false },
    });

    // The failing action's dialog button flips to disabled between before and after.
    expect(res.pageDiff?.summary.changed).toBe(1);
    expect(res.pageDiff?.hunks[0]).toMatchObject({ role: 'button', name: 'Confirm' });
  });

  test('reports no-trace for a missing blob and no-snapshots when nothing was recorded', async () => {
    expect((await getTraceSnapshotsFromBlob('nope.zip')).status).toBe('no-trace');

    const plain = buildZip([
      { name: 'trace.trace', data: Buffer.from(JSON.stringify({ type: 'before', callId: 'x', startTime: 1 }), 'utf8') },
    ]);
    storageFiles.set('plain.zip', plain);
    expect((await getTraceSnapshotsFromBlob('plain.zip')).status).toBe('no-snapshots');
  });
});

describe('getTraceSnapshotResourceFromBlob', () => {
  test('serves the aria JSON and the PNG for a phase, addressed by callId', async () => {
    const aria = await getTraceSnapshotResourceFromBlob(BLOB, 'c2', 'aria', 'before');
    expect(aria?.contentType).toBe('application/json');
    expect(aria!.bytes.toString('utf8')).toBe(ariaBefore);

    const png = await getTraceSnapshotResourceFromBlob(BLOB, 'c1', 'screen', 'before');
    expect(png?.contentType).toBe('image/png');
    expect([...png!.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test('returns null for a phase that was not captured or an unknown callId', async () => {
    expect(await getTraceSnapshotResourceFromBlob(BLOB, 'c1', 'screen', 'after')).toBeNull();
    expect(await getTraceSnapshotResourceFromBlob(BLOB, 'ghost', 'aria', 'before')).toBeNull();
  });
});

describe('getTraceFallbackAriaTextFromBlob', () => {
  test("renders the failing action's before-phase aria tree as text", async () => {
    const text = await getTraceFallbackAriaTextFromBlob(BLOB);
    expect(text).toBe(['- dialog "Pay"', '  - button "Confirm"'].join('\n'));
  });
});
