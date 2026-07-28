import {
  getConnectionSettings,
  setConnectionSettings,
  clearConnectionSettings,
} from '../shared/connection-settings.js';
import { testConnection, fetchProjects, fetchCatalog, type ProjectOption } from '../shared/piwi-client.js';
import { setCachedCatalog } from '../shared/catalog-cache.js';

const instanceUrlEl = document.getElementById('instance-url') as HTMLInputElement;
const apiKeyEl = document.getElementById('api-key') as HTMLInputElement;
const projectEl = document.getElementById('project') as HTMLSelectElement;
const statusEl = document.getElementById('status')!;
const testBtn = document.getElementById('test-connection') as HTMLButtonElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect') as HTMLButtonElement;

function setStatus(text: string, kind: 'ok' | 'error' | '' = ''): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function currentFormSettings(projectId: number | null): {
  instanceUrl: string;
  apiKey: string;
  projectId: number | null;
} {
  return { instanceUrl: instanceUrlEl.value.trim(), apiKey: apiKeyEl.value.trim(), projectId };
}

function populateProjects(projects: ProjectOption[], selectedId: number | null): void {
  projectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = projects.length === 0 ? 'No projects found' : 'Select a project…';
  projectEl.appendChild(placeholder);
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = p.label || p.name;
    if (p.id === selectedId) opt.selected = true;
    projectEl.appendChild(opt);
  }
  projectEl.disabled = projects.length === 0;
}

async function loadInitial(): Promise<void> {
  const settings = await getConnectionSettings();
  instanceUrlEl.value = settings.instanceUrl;
  apiKeyEl.value = settings.apiKey;
  if (settings.instanceUrl) {
    try {
      const projects = await fetchProjects(settings);
      populateProjects(projects, settings.projectId);
    } catch {
      // Instance unreachable at load time — leave the select disabled; "Test connection" will surface the error.
    }
  }
}

testBtn.addEventListener('click', () => {
  void (async () => {
    const settings = currentFormSettings(null);
    setStatus('Testing…');
    const result = await testConnection(settings);
    if (!result.ok) {
      setStatus(result.error, 'error');
      return;
    }
    try {
      const projects = await fetchProjects(settings);
      populateProjects(projects, null);
      setStatus(`Connected — ${projects.length} project${projects.length === 1 ? '' : 's'} found.`, 'ok');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Connected, but failed to list projects.', 'error');
    }
  })();
});

saveBtn.addEventListener('click', () => {
  void (async () => {
    const projectId = projectEl.value ? Number(projectEl.value) : null;
    const settings = currentFormSettings(projectId);
    if (!settings.instanceUrl) {
      setStatus('Enter an instance URL first.', 'error');
      return;
    }
    await setConnectionSettings(settings);
    if (projectId != null) {
      try {
        const catalog = await fetchCatalog(settings);
        await setCachedCatalog(projectId, catalog);
        setStatus(
          `Saved — cached ${catalog.length} function${catalog.length === 1 ? '' : 's'} for the recorder.`,
          'ok',
        );
        return;
      } catch (err) {
        setStatus(err instanceof Error ? `Saved, but ${err.message.toLowerCase()}` : 'Saved.', 'error');
        return;
      }
    }
    setStatus('Saved.', 'ok');
  })();
});

disconnectBtn.addEventListener('click', () => {
  void (async () => {
    await clearConnectionSettings();
    instanceUrlEl.value = '';
    apiKeyEl.value = '';
    populateProjects([], null);
    setStatus('Disconnected.', 'ok');
  })();
});

void loadInitial();
