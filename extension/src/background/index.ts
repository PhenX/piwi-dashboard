import { startRecording, getRecordingState } from '../shared/recording-storage.js';
import { getConnectionSettings } from '../shared/connection-settings.js';
import { fetchCatalog } from '../shared/piwi-client.js';
import { setCachedCatalog, isCatalogStale } from '../shared/catalog-cache.js';
import type { RefreshCatalogResult } from '../shared/catalog-refresh.js';

/**
 * Service worker: the keyboard-shortcut trigger for picking (the toolbar
 * icon's click opens the popup instead, per `action.default_popup` in the
 * manifest — the popup injects the content script itself, needing no
 * message through here). `chrome.commands` firing is itself the qualifying
 * user gesture for `activeTab`, so this can inject directly.
 */
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'pick-element') return;
  void runPickCommand(tab);
});

async function runPickCommand(tab?: chrome.tabs.Tab): Promise<void> {
  // The event usually carries the tab, but not on every platform or path —
  // falling back to the active tab beats silently doing nothing, which is
  // indistinguishable from the shortcut not being bound at all.
  const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['pick.js'] });
  } catch (err) {
    // Restricted page (chrome://, the Web Store, the PDF viewer): nothing to
    // inject into. Logged rather than left as an unhandled rejection.
    console.warn('[Piwi Picker] the pick shortcut cannot run on this page:', err);
  }
}

// chrome.storage.session defaults to extension-page-only access; the pick
// session (C3/C7) and the recording (`recording-storage.ts`) are read and
// written directly from content scripts, so this widens access once at
// startup rather than routing every storage call through a background
// message handler.
//
// Kept as a promise because this worker is torn down when idle and restarted
// on demand: a content script injected at `document_start` can easily run
// before the restart has applied the wider access level, and a session-storage
// read from a content script *throws* until it has. `piwi-ping` below lets a
// content script wait for exactly that (see `shared/session-access.ts`) —
// without it the recorder's HUD failed to appear at random.
const sessionAccessReady = chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  .catch(() => undefined);

const RECORD_SCRIPT_ID = 'piwi-record-panel';

/**
 * `chrome.scripting.registerContentScripts`/`unregisterContentScripts` and
 * `chrome.action.*` aren't reachable from a content script, so the recorder
 * routes its start/stop through here even though `popup.ts` and
 * `record-panel.ts` could otherwise talk to `chrome.storage` directly (and
 * do, for everything else). The popup requests the host permission itself
 * (it needs to happen inside its own click handler to count as a user
 * gesture) and only sends the already-granted origin pattern here.
 */
async function handleStartRecording(originPattern: string, tabId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await startRecording(originPattern);
    // Best-effort: a previous recording that ended without a clean `stop`
    // (crashed tab, browser killed mid-session) can leave a stale
    // registration behind — `persistAcrossSessions: false` means it never
    // survives a full browser restart, only the current one.
    await chrome.scripting.unregisterContentScripts({ ids: [RECORD_SCRIPT_ID] }).catch(() => undefined);
    await chrome.scripting.registerContentScripts([
      {
        id: RECORD_SCRIPT_ID,
        js: ['record-panel.js'],
        matches: [originPattern],
        runAt: 'document_start',
        persistAcrossSessions: false,
      },
    ]);
    // The registration above only applies to *future* navigations — the
    // already-loaded current page needs its own one-off injection.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['record-panel.js'] });
    await chrome.action.setBadgeText({ text: 'REC' });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to start recording' };
  }
}

/**
 * Tells every tab still running the recorder that capture is over, so each one
 * drops its HUD and its "this tab is being recorded" border.
 *
 * `chrome.tabs.sendMessage` rather than `chrome.runtime.sendMessage`: the
 * latter reaches extension pages and this worker but never a content script,
 * so a stop from the popup left the recorder's surfaces standing on every page
 * it was attached to. Scoped to the origin the user granted for this recording
 * — the only tabs the script was ever registered for, and the only ones this
 * extension has host access to.
 */
async function notifyRecorderTabs(originPattern: string | null, exceptTabId?: number): Promise<void> {
  if (!originPattern) return;
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ url: originPattern });
  } catch {
    return; // Malformed pattern, or access revoked mid-recording — nothing to notify.
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null || tab.id === exceptTabId) return;
      // A tab with no recorder attached (never navigated into the recording,
      // or already torn down) rejects with "no receiving end" — expected.
      await chrome.tabs.sendMessage(tab.id, { type: 'piwi-recording-stopped' }).catch(() => undefined);
    }),
  );
}

async function handleRecordingStopped(senderTabId?: number): Promise<void> {
  // Read before unregistering: the granted pattern is the only record of which
  // tabs could be running the recorder.
  const { grantedOriginPattern } = await getRecordingState();
  await chrome.scripting.unregisterContentScripts({ ids: [RECORD_SCRIPT_ID] }).catch(() => undefined);
  await chrome.action.setBadgeText({ text: '' });
  // The sender, if it was a content script, has already torn itself down.
  await notifyRecorderTabs(grantedOriginPattern, senderTabId);
}

/**
 * Re-fetches one project's function catalog into the cache. This lives in the
 * background worker rather than in the panels that display the catalog for
 * the same reason `piwi-client.ts` has always said: the API key must never be
 * reachable from a web page's JS context. Content scripts ask for a refresh
 * over `chrome.runtime.sendMessage` (`catalog-refresh.ts`) and only ever read
 * the resulting cache.
 *
 * Before this existed the catalog was written exactly once — by the options
 * page's save handler — so a function added in the dashboard afterwards never
 * appeared in the extension at all.
 */
async function handleRefreshCatalog(projectId: unknown, force: boolean): Promise<RefreshCatalogResult> {
  if (typeof projectId !== 'number' || !Number.isFinite(projectId)) {
    return { ok: false, error: 'No project to refresh.' };
  }
  const settings = await getConnectionSettings();
  if (!settings.instanceUrl.trim()) return { ok: false, error: 'Not connected to a Piwi instance.' };

  if (!force && !(await isCatalogStale(projectId))) return { ok: true, refreshed: false, count: null };

  try {
    const entries = await fetchCatalog(settings, projectId);
    await setCachedCatalog(projectId, entries);
    return { ok: true, refreshed: true, count: entries.length };
  } catch (err) {
    // The caller already rendered whatever was cached, so a failed refresh
    // degrades to "showing older data" rather than showing nothing.
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to refresh the catalog.' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'piwi-ping') {
    // Resolves only once session storage is readable from content scripts —
    // the whole point of the ping.
    void sessionAccessReady.then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'piwi-start-recording') {
    void handleStartRecording(message.originPattern, message.tabId).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (message?.type === 'piwi-refresh-catalog') {
    void handleRefreshCatalog(message.projectId, message.force === true).then(sendResponse);
    return true;
  }
  if (message?.type === 'piwi-recording-stopped') {
    // Also received here even though a content script or the popup already
    // wrote `active: false` to storage directly — this handler owns the
    // chrome.scripting/chrome.action side effects, and the fan-out to every
    // other tab still showing the recorder, regardless of who requested the
    // stop.
    void handleRecordingStopped(sender.tab?.id).then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});
