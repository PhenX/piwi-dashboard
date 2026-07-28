const statusEl = document.getElementById('status')!;

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function inject(file: string): Promise<void> {
  const tabId = await activeTabId();
  if (tabId == null) {
    statusEl.textContent = 'No active tab to pick from.';
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    window.close();
  } catch {
    statusEl.textContent = "Can't run on this page (browser/store pages are off-limits to extensions).";
  }
}

document.getElementById('pick')!.addEventListener('click', () => void inject('pick.js'));
document.getElementById('hover-inspect')!.addEventListener('click', () => void inject('hover-inspect.js'));
document.getElementById('locator-console')!.addEventListener('click', () => void inject('locator-console.js'));
document.getElementById('multi-pick')!.addEventListener('click', () => void inject('multi-pick.js'));
document.getElementById('lint-overlay')!.addEventListener('click', () => void inject('lint-overlay.js'));
