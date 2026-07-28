/**
 * The optional connection to a Piwi instance — instance URL, API key, and the
 * project the recorder matches against. `chrome.storage.local` (same bucket
 * as `storage.ts`'s last-used copy mode): a remembered device setting, not a
 * working session, so it survives the browser restarting. Never sent
 * anywhere except in requests the user's own actions trigger (see
 * `piwi-client.ts` — everything happens from the background service worker).
 */
export interface ConnectionSettings {
  instanceUrl: string;
  apiKey: string;
  projectId: number | null;
}

const CONNECTION_KEY = 'piwiConnection';

const EMPTY: ConnectionSettings = { instanceUrl: '', apiKey: '', projectId: null };

export async function getConnectionSettings(): Promise<ConnectionSettings> {
  const stored = await chrome.storage.local.get(CONNECTION_KEY);
  const value = stored[CONNECTION_KEY];
  if (!value || typeof value !== 'object') return { ...EMPTY };
  const v = value as Partial<ConnectionSettings>;
  return {
    instanceUrl: typeof v.instanceUrl === 'string' ? v.instanceUrl : '',
    apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
    projectId: typeof v.projectId === 'number' ? v.projectId : null,
  };
}

export async function setConnectionSettings(settings: ConnectionSettings): Promise<void> {
  await chrome.storage.local.set({ [CONNECTION_KEY]: settings });
}

export async function clearConnectionSettings(): Promise<void> {
  await chrome.storage.local.remove(CONNECTION_KEY);
}

/** True once both an instance URL and a project are configured — the minimum needed to fetch a catalog. */
export function isConnected(settings: ConnectionSettings): boolean {
  return settings.instanceUrl.trim().length > 0 && settings.projectId != null;
}
