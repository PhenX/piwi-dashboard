import { describe, it, expect, beforeEach } from 'vitest';
import { getLastCopyMode, setLastCopyMode } from '../../src/shared/storage.js';

function fakeChromeStorage() {
  const store: Record<string, unknown> = {};
  return {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        },
      },
    },
  };
}

beforeEach(() => {
  (globalThis as any).chrome = fakeChromeStorage();
});

describe('getLastCopyMode / setLastCopyMode', () => {
  it('defaults to bare when nothing is stored', async () => {
    expect(await getLastCopyMode()).toBe('bare');
  });

  it('remembers a set mode', async () => {
    await setLastCopyMode('action');
    expect(await getLastCopyMode()).toBe('action');
  });

  it('falls back to bare for a corrupted/unknown stored value', async () => {
    await (globalThis as any).chrome.storage.local.set({ lastCopyMode: 'not-a-real-mode' });
    expect(await getLastCopyMode()).toBe('bare');
  });
});
