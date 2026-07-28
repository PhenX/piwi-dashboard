import { startRecording } from '../shared/recording-storage.js';

/**
 * Service worker: the keyboard-shortcut trigger for picking (the toolbar
 * icon's click opens the popup instead, per `action.default_popup` in the
 * manifest — the popup injects the content script itself, needing no
 * message through here). `chrome.commands` firing is itself the qualifying
 * user gesture for `activeTab`, so this can inject directly.
 */
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'pick-element' || !tab?.id) return;
  void chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['pick.js'] });
});

// chrome.storage.session defaults to extension-page-only access; the pick
// session (C3/C7) and the recording (`recording-storage.ts`) are read and
// written directly from content scripts, so this widens access once at
// startup rather than routing every storage call through a background
// message handler.
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

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

async function handleRecordingStopped(): Promise<void> {
  await chrome.scripting.unregisterContentScripts({ ids: [RECORD_SCRIPT_ID] }).catch(() => undefined);
  await chrome.action.setBadgeText({ text: '' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'piwi-start-recording') {
    void handleStartRecording(message.originPattern, message.tabId).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (message?.type === 'piwi-recording-stopped') {
    // Also received here even though a content script or the popup already
    // wrote `active: false` to storage directly — this handler owns the
    // chrome.scripting/chrome.action side effects regardless of who
    // requested the stop.
    void handleRecordingStopped().then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});
