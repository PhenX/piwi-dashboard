import {
  getConnectionSettings,
  setConnectionSettings,
  clearConnectionSettings,
  type ConnectionSettings,
} from '../shared/connection-settings.js';
import { testConnection, fetchProjects, fetchCatalog, type ProjectOption } from '../shared/piwi-client.js';
import { setCachedCatalog, pruneCachedCatalogs } from '../shared/catalog-cache.js';

const instanceUrlEl = document.getElementById('instance-url') as HTMLInputElement;
const apiKeyEl = document.getElementById('api-key') as HTMLInputElement;
const mappingsEl = document.getElementById('mappings')!;
const addMappingBtn = document.getElementById('add-mapping') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const testBtn = document.getElementById('test-connection') as HTMLButtonElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect') as HTMLButtonElement;

interface EditableMapping {
  urlPattern: string;
  projectId: number | null;
  projectLabel: string;
}

/** Populated by "Test connection" (or on load, if already connected) — the pool a mapping row's project `<select>` draws from. */
let projectOptions: ProjectOption[] = [];
let mappings: EditableMapping[] = [];

function setStatus(text: string, kind: 'ok' | 'error' | '' = ''): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function currentInstanceSettings(): ConnectionSettings {
  return { instanceUrl: instanceUrlEl.value.trim(), apiKey: apiKeyEl.value.trim(), projectMappings: [] };
}

function renderMappings(): void {
  mappingsEl.innerHTML = '';

  if (mappings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-mappings';
    empty.textContent = 'No mappings yet — add one below.';
    mappingsEl.appendChild(empty);
    return;
  }

  const knownIds = new Set(projectOptions.map((p) => p.id));

  mappings.forEach((mapping, index) => {
    const row = document.createElement('div');
    row.className = 'mapping-row';

    const patternInput = document.createElement('input');
    patternInput.type = 'text';
    patternInput.className = 'mapping-pattern';
    patternInput.placeholder = 'https://shop.example.com/**';
    patternInput.setAttribute('aria-label', 'URL pattern');
    patternInput.value = mapping.urlPattern;
    patternInput.addEventListener('input', () => {
      mappings[index]!.urlPattern = patternInput.value;
    });

    const projectSelect = document.createElement('select');
    projectSelect.className = 'mapping-project';
    projectSelect.setAttribute('aria-label', 'Project');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = projectOptions.length === 0 ? 'Test connection first' : 'Select a project…';
    projectSelect.appendChild(placeholder);
    // A mapping saved before the project list was (re-)fetched still names a real project — keep showing it even if it's not in `projectOptions` yet.
    if (mapping.projectId != null && !knownIds.has(mapping.projectId)) {
      const preserved = document.createElement('option');
      preserved.value = String(mapping.projectId);
      preserved.textContent = mapping.projectLabel;
      projectSelect.appendChild(preserved);
    }
    for (const p of projectOptions) {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.label || p.name;
      projectSelect.appendChild(opt);
    }
    projectSelect.value = mapping.projectId != null ? String(mapping.projectId) : '';
    projectSelect.addEventListener('change', () => {
      const id = projectSelect.value ? Number(projectSelect.value) : null;
      mappings[index]!.projectId = id;
      mappings[index]!.projectLabel = projectSelect.selectedOptions[0]?.textContent ?? '';
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-mapping';
    removeBtn.setAttribute('aria-label', 'Remove mapping');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      mappings.splice(index, 1);
      renderMappings();
    });

    row.append(patternInput, projectSelect, removeBtn);
    mappingsEl.appendChild(row);
  });
}

addMappingBtn.addEventListener('click', () => {
  mappings.push({ urlPattern: '', projectId: null, projectLabel: '' });
  renderMappings();
});

async function loadInitial(): Promise<void> {
  const settings = await getConnectionSettings();
  instanceUrlEl.value = settings.instanceUrl;
  apiKeyEl.value = settings.apiKey;
  mappings = settings.projectMappings.map((m) => ({
    urlPattern: m.urlPattern,
    projectId: m.projectId,
    projectLabel: m.projectLabel,
  }));
  renderMappings();

  if (settings.instanceUrl) {
    try {
      projectOptions = await fetchProjects(settings);
      renderMappings();
    } catch {
      // Instance unreachable at load time — leave placeholders; "Test connection" surfaces the error.
    }
  }
}

testBtn.addEventListener('click', () => {
  void (async () => {
    const settings = currentInstanceSettings();
    setStatus('Testing…');
    const result = await testConnection(settings);
    if (!result.ok) {
      setStatus(result.error, 'error');
      return;
    }
    try {
      projectOptions = await fetchProjects(settings);
      renderMappings();
      setStatus(`Connected — ${projectOptions.length} project${projectOptions.length === 1 ? '' : 's'} found.`, 'ok');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Connected, but failed to list projects.', 'error');
    }
  })();
});

saveBtn.addEventListener('click', () => {
  void (async () => {
    const base = currentInstanceSettings();
    if (!base.instanceUrl) {
      setStatus('Enter an instance URL first.', 'error');
      return;
    }

    const valid = mappings.filter((m) => m.urlPattern.trim() && m.projectId != null);
    const incompleteCount = mappings.length - valid.length;

    const settings: ConnectionSettings = {
      ...base,
      projectMappings: valid.map((m) => ({
        urlPattern: m.urlPattern.trim(),
        projectId: m.projectId!,
        projectLabel: m.projectLabel,
      })),
    };
    await setConnectionSettings(settings);

    const distinctProjectIds = [...new Set(valid.map((m) => m.projectId!))];
    let cachedFunctionCount = 0;
    let failedFetchCount = 0;
    for (const projectId of distinctProjectIds) {
      try {
        const catalog = await fetchCatalog(settings, projectId);
        await setCachedCatalog(projectId, catalog);
        cachedFunctionCount += catalog.length;
      } catch {
        failedFetchCount++;
      }
    }
    await pruneCachedCatalogs(distinctProjectIds);

    const parts = [`Saved ${valid.length} mapping${valid.length === 1 ? '' : 's'}`];
    if (incompleteCount > 0) parts.push(`${incompleteCount} incomplete row${incompleteCount === 1 ? '' : 's'} skipped`);
    if (distinctProjectIds.length > 0) {
      parts.push(
        `cached ${cachedFunctionCount} function${cachedFunctionCount === 1 ? '' : 's'} across ${distinctProjectIds.length} project${distinctProjectIds.length === 1 ? '' : 's'}`,
      );
    }
    if (failedFetchCount > 0)
      parts.push(`${failedFetchCount} catalog fetch${failedFetchCount === 1 ? '' : 'es'} failed`);
    setStatus(`${parts.join(' — ')}.`, failedFetchCount > 0 ? 'error' : 'ok');
  })();
});

disconnectBtn.addEventListener('click', () => {
  void (async () => {
    await clearConnectionSettings();
    await pruneCachedCatalogs([]);
    instanceUrlEl.value = '';
    apiKeyEl.value = '';
    projectOptions = [];
    mappings = [];
    renderMappings();
    setStatus('Disconnected.', 'ok');
  })();
});

void loadInitial();
