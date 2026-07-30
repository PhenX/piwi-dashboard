import { describe, it, expect } from 'vitest';
import { canReusePersistedDemoDb } from '~~/app/demo/db.client';

// The in-browser demo DB is seeded once and persisted to IndexedDB, so a
// returning visitor keeps whatever schema they were first seeded with. When the
// app adds a column, queries against that frozen schema fail with
// "no such column". `canReusePersistedDemoDb` gates whether the persisted copy
// is reused (fast path) or discarded and reseeded (self-heal), keyed on the
// build's seed-version hash.
describe('canReusePersistedDemoDb', () => {
  it('reuses the persisted DB when the stored version matches the current build', () => {
    expect(canReusePersistedDemoDb('v2', 'v2')).toBe(true);
  });

  it('reseeds when the stored version is older than the current build (schema changed)', () => {
    expect(canReusePersistedDemoDb('v1', 'v2')).toBe(false);
  });

  it('reseeds legacy data that has no stored version (predates version tracking)', () => {
    expect(canReusePersistedDemoDb(null, 'v2')).toBe(false);
  });

  it('keeps the persisted DB when the current version is unknown (offline / marker missing)', () => {
    // Can't prove staleness without the yardstick — reusing beats wiping usable
    // data, and a genuinely obsolete schema would also fail to fetch a fresh seed.
    expect(canReusePersistedDemoDb('v1', null)).toBe(true);
    expect(canReusePersistedDemoDb(null, null)).toBe(true);
  });
});
