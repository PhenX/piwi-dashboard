import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedCatalog, setCachedCatalog, pruneCachedCatalogs } from '../../src/shared/catalog-cache.js';
import type { TestFunctionEntry } from '@piwitests/core/function-match';

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

function entry(id: number, name: string): TestFunctionEntry {
  return {
    id,
    name,
    kind: 'helper',
    module: './helpers/x',
    receiver: null,
    importName: null,
    params: [],
    urlPattern: null,
    steps: [{ action: 'click', target: {} }],
    paramSources: [],
  };
}

describe('catalog cache', () => {
  it('starts empty for any project', async () => {
    expect(await getCachedCatalog(1)).toEqual([]);
    expect(await getCachedCatalog(null)).toEqual([]);
  });

  it('caches a project independently of others', async () => {
    await setCachedCatalog(1, [entry(1, 'login')]);
    await setCachedCatalog(2, [entry(2, 'checkout')]);
    expect((await getCachedCatalog(1)).map((e) => e.name)).toEqual(['login']);
    expect((await getCachedCatalog(2)).map((e) => e.name)).toEqual(['checkout']);
  });

  it('re-caching a project overwrites just that project', async () => {
    await setCachedCatalog(1, [entry(1, 'login')]);
    await setCachedCatalog(2, [entry(2, 'checkout')]);
    await setCachedCatalog(1, [entry(1, 'login'), entry(3, 'logout')]);
    expect((await getCachedCatalog(1)).map((e) => e.name)).toEqual(['login', 'logout']);
    expect((await getCachedCatalog(2)).map((e) => e.name)).toEqual(['checkout']);
  });

  it('pruneCachedCatalogs drops entries not in the keep list', async () => {
    await setCachedCatalog(1, [entry(1, 'login')]);
    await setCachedCatalog(2, [entry(2, 'checkout')]);
    await setCachedCatalog(3, [entry(3, 'search')]);
    await pruneCachedCatalogs([1, 3]);
    expect(await getCachedCatalog(1)).toHaveLength(1);
    expect(await getCachedCatalog(2)).toEqual([]);
    expect(await getCachedCatalog(3)).toHaveLength(1);
  });
});
