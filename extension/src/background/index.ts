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
// session (C3/C7) is read and written directly from session-panel.ts, a
// content script, so this widens access once at startup rather than routing
// every storage call through a background message handler.
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
