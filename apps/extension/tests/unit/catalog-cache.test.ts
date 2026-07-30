import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCachedCatalog,
  setCachedCatalog,
  pruneCachedCatalogs,
  isCatalogStale,
  CATALOG_TTL_MS,
} from '../../src/shared/catalog-cache.js';
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

describe('isCatalogStale', () => {
  it('a project that was never cached is stale, so a mapping fills itself in on first use', async () => {
    expect(await isCatalogStale(1)).toBe(true);
  });

  it('a just-cached project is fresh', async () => {
    await setCachedCatalog(1, [entry(1, 'login')]);
    expect(await isCatalogStale(1)).toBe(false);
  });

  it('goes stale once the entry is older than the TTL', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await setCachedCatalog(1, [entry(1, 'login')]);
    expect(await isCatalogStale(1)).toBe(false);

    vi.spyOn(Date, 'now').mockReturnValue(now + CATALOG_TTL_MS + 1);
    expect(await isCatalogStale(1)).toBe(true);
    vi.restoreAllMocks();
  });

  it('an entry cached under an older shape with no fetchedAt counts as stale', async () => {
    await (globalThis as any).chrome.storage.local.set({
      piwiCatalogCache: { '1': { entries: [entry(1, 'login')] } },
    });
    expect(await isCatalogStale(1)).toBe(true);
  });

  it('staleness is tracked per project', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await setCachedCatalog(1, [entry(1, 'login')]);
    vi.spyOn(Date, 'now').mockReturnValue(now + CATALOG_TTL_MS + 1);
    await setCachedCatalog(2, [entry(2, 'checkout')]);
    expect(await isCatalogStale(1)).toBe(true);
    expect(await isCatalogStale(2)).toBe(false);
    vi.restoreAllMocks();
  });
});
