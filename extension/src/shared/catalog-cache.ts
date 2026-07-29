import type { TestFunctionEntry } from '@piwitests/core/function-match';

/**
 * The last-fetched function catalog for every mapped project, cached so
 * `record-panel.ts`/`test-function-panel.ts` (content scripts, with no host
 * permission for the Piwi instance's origin) can read it locally instead of
 * fetching — only the options page ever calls `piwi-client.ts`.
 * `chrome.storage.local`: useful across a browser restart even with no
 * recording running, and small (a handful of projects' catalogs, not
 * per-session data). Keyed by project id (as a string — object keys are
 * always strings once round-tripped through `chrome.storage`'s JSON
 * serialization) since a connection now maps many projects at once
 * (`ConnectionSettings.projectMappings`), not just one.
 */
const CACHE_KEY = 'piwiCatalogCache';

interface CatalogCacheEntry {
  entries: TestFunctionEntry[];
  fetchedAt: number;
}

type CatalogCacheStore = Record<string, CatalogCacheEntry>;

async function readStore(): Promise<CatalogCacheStore> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const value = stored[CACHE_KEY];
  return value && typeof value === 'object' ? (value as CatalogCacheStore) : {};
}

export async function getCachedCatalog(projectId: number | null): Promise<TestFunctionEntry[]> {
  if (projectId == null) return [];
  const store = await readStore();
  return store[String(projectId)]?.entries ?? [];
}

export async function setCachedCatalog(projectId: number, entries: TestFunctionEntry[]): Promise<void> {
  const store = await readStore();
  store[String(projectId)] = { entries, fetchedAt: Date.now() };
  await chrome.storage.local.set({ [CACHE_KEY]: store });
}

/** Drops cache entries for projects no longer referenced by any mapping — called after saving the options page's mapping list so a removed mapping's catalog doesn't linger indefinitely. */
export async function pruneCachedCatalogs(keepProjectIds: number[]): Promise<void> {
  const store = await readStore();
  const keep = new Set(keepProjectIds.map(String));
  const pruned: CatalogCacheStore = {};
  for (const [id, entry] of Object.entries(store)) {
    if (keep.has(id)) pruned[id] = entry;
  }
  await chrome.storage.local.set({ [CACHE_KEY]: pruned });
}
