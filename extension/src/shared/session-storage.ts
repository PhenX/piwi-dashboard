export interface SessionPick {
  name: string;
  locator: string;
  pageUrl: string;
}

const SESSION_KEY = 'piwiPickSession';

/**
 * The running named-pick session (C3/C7), in `chrome.storage.session` rather
 * than `.local` — a working session for the current browser run, not a
 * permanent preference (same reasoning as the plan's own default for API
 * keys: session-scoped unless the user opts into persistence). Requires
 * `setAccessLevel` at the service worker to be reachable from a content
 * script — see `background/index.ts`.
 */
export async function getSessionPicks(): Promise<SessionPick[]> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const value = stored[SESSION_KEY];
  return Array.isArray(value) ? (value as SessionPick[]) : [];
}

export async function addSessionPick(pick: SessionPick): Promise<SessionPick[]> {
  const picks = [...(await getSessionPicks()), pick];
  await chrome.storage.session.set({ [SESSION_KEY]: picks });
  return picks;
}

export async function removeSessionPick(name: string): Promise<SessionPick[]> {
  const picks = (await getSessionPicks()).filter((p) => p.name !== name);
  await chrome.storage.session.set({ [SESSION_KEY]: picks });
  return picks;
}

export async function clearSessionPicks(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}
