import { getRecordingState, stopRecording } from '../shared/recording-storage.js';
import { getConnectionSettings, isConnected, type ProjectMapping } from '../shared/connection-settings.js';
import { getActiveProjectOverride, setActiveProjectOverride, resolveActiveProject } from '../shared/active-project.js';

const statusEl = document.getElementById('status')!;
const recordBtn = document.getElementById('record') as HTMLButtonElement;
const recordLabel = document.getElementById('record-label')!;
const recordHint = document.getElementById('record-hint')!;
const configButton = document.getElementById('config-button') as HTMLButtonElement;
const activeProjectRow = document.getElementById('active-project-row')!;
const activeProjectSelect = document.getElementById('active-project') as HTMLSelectElement;

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
document.getElementById('test-function-panel')!.addEventListener('click', () => void inject('test-function-panel.js'));

configButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

/**
 * Digit shortcuts for the action grid, in the order the tiles are rendered —
 * the `kbd` badge on each tile and its `aria-keyshortcuts` must stay in step
 * with this. Scoped to the popup rather than declared as `chrome.commands`,
 * which caps a extension at four user-visible shortcuts and would burn
 * global browser-wide bindings on actions that only make sense with this
 * popup open.
 */
const KEY_TO_ACTION_ID: Record<string, string> = {
  '1': 'record',
  '2': 'pick',
  '3': 'hover-inspect',
  '4': 'locator-console',
  '5': 'multi-pick',
  '6': 'lint-overlay',
  '7': 'assertion-panel',
  '8': 'session-panel',
  '9': 'agent-context-panel',
  '0': 'test-function-panel',
};

/**
 * Reports the *actual* binding for the pick shortcut rather than the one the
 * manifest suggests. A browser only assigns `suggested_key` when it is free —
 * another extension (or, on Firefox, the built-in Network Monitor) already
 * holding Ctrl+Shift+E means ours is silently left unbound, and hardcoding the
 * hint made that look like the extension was broken.
 */
async function renderPickShortcutHint(): Promise<void> {
  const el = document.getElementById('pick-shortcut');
  if (!el) return;
  let shortcut = '';
  try {
    const commands = await chrome.commands.getAll();
    shortcut = commands.find((c) => c.name === 'pick-element')?.shortcut ?? '';
  } catch {
    // `chrome.commands` unavailable — leave the fallback link below.
  }

  el.replaceChildren();
  if (shortcut) {
    const key = document.createElement('kbd');
    key.textContent = shortcut;
    el.append(key, ' picks without the popup');
    return;
  }
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'no pick shortcut assigned — set one';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    // chrome:// URLs can't be opened with a plain link from an extension page.
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  el.appendChild(link);
}

document.addEventListener('keydown', (e) => {
  // Let a modified key through — Ctrl+1 etc. belong to the browser — and stay
  // out of the way of the project select, where digits drive its own typeahead.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
  const id = KEY_TO_ACTION_ID[e.key];
  if (!id) return;
  e.preventDefault();
  document.getElementById(id)?.click();
});

const AUTO_OPTION_VALUE = '';

function dedupeMappings(mappings: ProjectMapping[]): Array<{ projectId: number; projectLabel: string }> {
  const seen = new Map<number, string>();
  for (const m of mappings) if (!seen.has(m.projectId)) seen.set(m.projectId, m.projectLabel);
  return [...seen].map(([projectId, projectLabel]) => ({ projectId, projectLabel }));
}

/** Populates and pre-selects the active-project picker: hidden until connected, otherwise offering every mapped project plus "Auto" (clears the manual override, falling back to URL-pattern matching). */
async function refreshActiveProjectSelect(): Promise<void> {
  const [connection, override, tab] = await Promise.all([
    getConnectionSettings(),
    getActiveProjectOverride(),
    activeTab(),
  ]);

  if (!isConnected(connection)) {
    activeProjectRow.style.display = 'none';
    return;
  }
  activeProjectRow.style.display = '';

  const options = dedupeMappings(connection.projectMappings);
  const resolved = tab?.url ? resolveActiveProject(connection, override, tab.url) : override;
  if (resolved && !options.some((o) => o.projectId === resolved.projectId)) {
    options.push({ projectId: resolved.projectId, projectLabel: resolved.projectLabel });
  }

  activeProjectSelect.innerHTML = '';
  const autoOpt = document.createElement('option');
  autoOpt.value = AUTO_OPTION_VALUE;
  autoOpt.textContent =
    tab?.url && resolveActiveProject(connection, null, tab.url)
      ? 'Auto (matched by URL)'
      : 'Auto (no match on this page)';
  activeProjectSelect.appendChild(autoOpt);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o.projectId);
    opt.textContent = o.projectLabel;
    activeProjectSelect.appendChild(opt);
  }
  activeProjectSelect.value = override ? String(override.projectId) : AUTO_OPTION_VALUE;

  activeProjectSelect.addEventListener('change', () => {
    void (async () => {
      if (activeProjectSelect.value === AUTO_OPTION_VALUE) {
        await setActiveProjectOverride(null);
        return;
      }
      const projectId = Number(activeProjectSelect.value);
      const projectLabel = activeProjectSelect.selectedOptions[0]?.textContent ?? `#${projectId}`;
      await setActiveProjectOverride({ projectId, projectLabel });
    })();
  });
}

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
void refreshActiveProjectSelect();
void renderPickShortcutHint();
