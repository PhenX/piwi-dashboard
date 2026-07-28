import type { TestFunctionEntry } from '@piwitests/core/function-match';

/**
 * The last-fetched function catalog, cached so `record-panel.ts` (a content
 * script, with no host permission for the Piwi instance's origin) can read
 * it locally instead of fetching — only the background service worker and
 * the options page ever call `piwi-client.ts`. `chrome.storage.local`:
 * useful across a browser restart even with no recording running, and small
 * (a project's catalog, not per-session data).
 */
const CACHE_KEY = 'piwiCatalogCache';

interface CatalogCache {
  projectId: number;
  entries: TestFunctionEntry[];
  fetchedAt: number;
}

export async function getCachedCatalog(projectId: number | null): Promise<TestFunctionEntry[]> {
  if (projectId == null) return [];
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const value = stored[CACHE_KEY] as CatalogCache | undefined;
  return value && value.projectId === projectId ? value.entries : [];
}

export async function setCachedCatalog(projectId: number, entries: TestFunctionEntry[]): Promise<void> {
  const cache: CatalogCache = { projectId, entries, fetchedAt: Date.now() };
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}
