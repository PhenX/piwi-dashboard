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
