import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSessionPicks,
  addSessionPick,
  removeSessionPick,
  clearSessionPicks,
} from '../../src/shared/session-storage.js';

function fakeChromeStorage() {
  const store: Record<string, unknown> = {};
  return {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        },
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  };
}

beforeEach(() => {
  (globalThis as any).chrome = fakeChromeStorage();
});

describe('session pick storage', () => {
  it('starts empty', async () => {
    expect(await getSessionPicks()).toEqual([]);
  });

  it('accumulates picks in insertion order', async () => {
    await addSessionPick({ name: 'a', locator: `getByTestId('a')`, pageUrl: 'https://x.test/' });
    await addSessionPick({ name: 'b', locator: `getByTestId('b')`, pageUrl: 'https://x.test/' });
    expect((await getSessionPicks()).map((p) => p.name)).toEqual(['a', 'b']);
  });

  it('removes a pick by name', async () => {
    await addSessionPick({ name: 'a', locator: `getByTestId('a')`, pageUrl: 'https://x.test/' });
    await addSessionPick({ name: 'b', locator: `getByTestId('b')`, pageUrl: 'https://x.test/' });
    await removeSessionPick('a');
    expect((await getSessionPicks()).map((p) => p.name)).toEqual(['b']);
  });

  it('clears all picks', async () => {
    await addSessionPick({ name: 'a', locator: `getByTestId('a')`, pageUrl: 'https://x.test/' });
    await clearSessionPicks();
    expect(await getSessionPicks()).toEqual([]);
  });
});
