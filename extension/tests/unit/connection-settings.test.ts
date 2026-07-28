import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConnectionSettings,
  setConnectionSettings,
  clearConnectionSettings,
  isConnected,
} from '../../src/shared/connection-settings.js';

function fakeChromeStorage() {
  const store: Record<string, unknown> = {};
  return {
    storage: {
      local: {
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

describe('connection settings', () => {
  it('defaults to empty/disconnected', async () => {
    const settings = await getConnectionSettings();
    expect(settings).toEqual({ instanceUrl: '', apiKey: '', projectId: null });
    expect(isConnected(settings)).toBe(false);
  });

  it('round-trips a saved connection', async () => {
    await setConnectionSettings({ instanceUrl: 'https://piwi.example.com', apiKey: 'pd_abc', projectId: 3 });
    const settings = await getConnectionSettings();
    expect(settings).toEqual({ instanceUrl: 'https://piwi.example.com', apiKey: 'pd_abc', projectId: 3 });
    expect(isConnected(settings)).toBe(true);
  });

  it('is not connected with a URL but no project selected', async () => {
    await setConnectionSettings({ instanceUrl: 'https://piwi.example.com', apiKey: '', projectId: null });
    expect(isConnected(await getConnectionSettings())).toBe(false);
  });

  it('clearConnectionSettings resets to empty', async () => {
    await setConnectionSettings({ instanceUrl: 'https://piwi.example.com', apiKey: 'pd_abc', projectId: 3 });
    await clearConnectionSettings();
    expect(await getConnectionSettings()).toEqual({ instanceUrl: '', apiKey: '', projectId: null });
  });

  it('tolerates garbage stored under the key (e.g. an old shape)', async () => {
    (globalThis as any).chrome.storage.local.set({ piwiConnection: 'not-an-object' });
    const settings = await getConnectionSettings();
    expect(settings).toEqual({ instanceUrl: '', apiKey: '', projectId: null });
  });
});
