import { type CopyMode, COPY_MODES } from './copy-modes.js';

const LAST_COPY_MODE_KEY = 'lastCopyMode';

/** The user's last-used copy mode, remembered across picks. Defaults to the bare locator. */
export async function getLastCopyMode(): Promise<CopyMode> {
  const stored = await chrome.storage.local.get(LAST_COPY_MODE_KEY);
  const value = stored[LAST_COPY_MODE_KEY];
  return typeof value === 'string' && (COPY_MODES as readonly string[]).includes(value) ? (value as CopyMode) : 'bare';
}

export async function setLastCopyMode(mode: CopyMode): Promise<void> {
  await chrome.storage.local.set({ [LAST_COPY_MODE_KEY]: mode });
}
