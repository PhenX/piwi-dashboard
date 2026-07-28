import { getRecordingState, stopRecording } from '../shared/recording-storage.js';

const statusEl = document.getElementById('status')!;
const recordBtn = document.getElementById('record') as HTMLButtonElement;
const recordLabel = document.getElementById('record-label')!;
const recordHint = document.getElementById('record-hint')!;

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function inject(file: string): Promise<void> {
  const tab = await activeTab();
  if (tab?.id == null) {
    statusEl.textContent = 'No active tab to pick from.';
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
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
document.getElementById('assertion-panel')!.addEventListener('click', () => void inject('assertion-panel.js'));
document.getElementById('session-panel')!.addEventListener('click', () => void inject('session-panel.js'));
document.getElementById('agent-context-panel')!.addEventListener('click', () => void inject('agent-context-panel.js'));

document.getElementById('options-link')!.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

type RecordUiState = 'idle' | 'recording' | 'stopped';

async function recordUiState(): Promise<{ state: RecordUiState; steps: number }> {
  const rec = await getRecordingState();
  if (rec.active) return { state: 'recording', steps: rec.events.length };
  if (rec.events.length > 0) return { state: 'stopped', steps: rec.events.length };
  return { state: 'idle', steps: 0 };
}

async function refreshRecordButton(): Promise<void> {
  const { state, steps } = await recordUiState();
  if (state === 'recording') {
    recordLabel.textContent = `Stop recording (${steps})`;
    recordHint.textContent = 'Steps captured so far';
  } else if (state === 'stopped') {
    recordLabel.textContent = `Review recording (${steps})`;
    recordHint.textContent = 'Not exported yet';
  } else {
    recordLabel.textContent = 'Record actions';
    recordHint.textContent = 'Multi-page → TypeScript';
  }
}

async function startRecordingFlow(): Promise<void> {
  const tab = await activeTab();
  if (tab?.id == null || !tab.url) {
    statusEl.textContent = 'No active tab to record.';
    return;
  }
  let origin: string;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    statusEl.textContent = "Can't record on this page.";
    return;
  }
  const originPattern = `${origin}/*`;

  const granted = await chrome.permissions.request({ origins: [originPattern] });
  if (!granted) {
    statusEl.textContent = 'Permission for this site is needed to record across pages.';
    return;
  }

  const response = (await chrome.runtime.sendMessage({
    type: 'piwi-start-recording',
    originPattern,
    tabId: tab.id,
  })) as {
    ok: boolean;
    error?: string;
  };
  if (!response?.ok) {
    statusEl.textContent = response?.error ?? 'Failed to start recording.';
    return;
  }
  window.close();
}

async function stopRecordingFlow(): Promise<void> {
  await stopRecording();
  try {
    await chrome.runtime.sendMessage({ type: 'piwi-recording-stopped' });
  } catch {
    // Background may already be asleep between messages — the storage write above already stuck.
  }
  await inject('record-panel.js');
}

async function reviewRecordingFlow(): Promise<void> {
  await inject('record-panel.js');
}

recordBtn.addEventListener('click', () => {
  void (async () => {
    const { state } = await recordUiState();
    if (state === 'recording') await stopRecordingFlow();
    else if (state === 'stopped') await reviewRecordingFlow();
    else await startRecordingFlow();
  })();
});

void refreshRecordButton();
