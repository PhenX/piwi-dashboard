import { TAG_TO_ROLE, INPUT_TYPE_TO_ROLE } from '@piwitests/core/locator-generation';
import { testCatalogAgainstPage, type FunctionTestResult } from './test-function-scan.js';
import { getCachedCatalog } from '../shared/catalog-cache.js';
import { getConnectionSettings } from '../shared/connection-settings.js';
import { projectCatalogUrl } from '../shared/piwi-client.js';
import { getActiveProjectOverride, resolveActiveProject } from '../shared/active-project.js';

const HOST_ID = 'piwi-test-function-host';
const MAPS = { tagRoles: TAG_TO_ROLE, inputRoles: INPUT_TYPE_TO_ROLE };

function verdictLabel(verdict: FunctionTestResult['verdict']): string {
  if (verdict === 'ready') return 'ready to use here';
  if (verdict === 'partial') return 'partial match';
  return 'not found on this page';
}

function stepLabel(step: FunctionTestResult['steps'][number]): string {
  if (step.verdict === 'unique') return `${step.action}() → 1 match`;
  if (step.verdict === 'ambiguous') return `${step.action}() → ${step.matchCount} matches (ambiguous)`;
  return `${step.action}() → no match`;
}

function renderResult(result: FunctionTestResult): HTMLElement {
  const row = document.createElement('div');
  row.className = `row ${result.verdict}`;

  const top = document.createElement('div');
  top.className = 'row-top';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = result.entry.name;
  const badge = document.createElement('span');
  badge.className = `badge ${result.verdict}`;
  badge.textContent = verdictLabel(result.verdict);
  top.append(name, badge);
  row.appendChild(top);

  const steps = document.createElement('div');
  steps.className = 'steps';
  for (const step of result.steps) {
    const line = document.createElement('div');
    line.className = `step ${step.verdict}`;
    line.textContent = stepLabel(step);
    steps.appendChild(line);
  }
  row.appendChild(steps);

  return row;
}

async function renderPanel(): Promise<void> {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh; }
    .panel { background: #111827; color: #f9fafb; border-radius: 12px; padding: 16px; width: min(560px, 92vw); max-height: 78vh;
      overflow: auto; box-shadow: 0 8px 40px rgba(0,0,0,.5); font-size: 13px; line-height: 1.5; }
    @media (prefers-color-scheme: light) { .panel { background: #ffffff; color: #111827; box-shadow: 0 8px 40px rgba(0,0,0,.2); } }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .title { font-weight: 600; font-size: 14px; }
    .sub { color: #9ca3af; font-size: 12px; }
    .manage-link { color: #7c3aed; text-decoration: none; }
    .manage-link:hover, .manage-link:focus-visible { text-decoration: underline; }
    .close { background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 6px; }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
    .empty { color: #9ca3af; font-size: 12.5px; padding: 8px 0; }
    .row { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
    .row-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
    .badge { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; flex-shrink: 0; }
    .badge.ready { background: rgba(34,197,94,.2); color: #22c55e; }
    .badge.partial { background: rgba(234,179,8,.2); color: #eab308; }
    .badge.not-found { background: rgba(128,128,128,.2); color: #9ca3af; }
    .steps { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
    .step { font-size: 11.5px; color: #9ca3af; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .step.unique { color: #22c55e; }
    .step.ambiguous { color: #eab308; }
  `;
  root.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Test catalog functions against this page');
  panel.tabIndex = -1;

  const [connection, override] = await Promise.all([getConnectionSettings(), getActiveProjectOverride()]);
  const activeProject = resolveActiveProject(connection, override, location.href);
  const catalog = await getCachedCatalog(activeProject?.projectId ?? null);

  const header = document.createElement('div');
  header.className = 'header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'Test functions on this page';
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.append('Esc to close');
  if (activeProject != null && connection.instanceUrl.trim()) {
    sub.append(' · ');
    const manageLink = document.createElement('a');
    manageLink.className = 'manage-link';
    manageLink.href = projectCatalogUrl(connection.instanceUrl, activeProject.projectId);
    manageLink.target = '_blank';
    manageLink.rel = 'noopener noreferrer';
    manageLink.textContent = `Manage ${activeProject.projectLabel}'s catalog in Piwi ↗`;
    sub.appendChild(manageLink);
  }
  titleWrap.append(title, sub);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  header.append(titleWrap, closeBtn);
  panel.appendChild(header);

  if (catalog.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      activeProject == null
        ? 'No project mapped to this page — add a URL pattern for it in the extension’s config, or pick a project from the popup.'
        : `No functions in ${activeProject.projectLabel}’s catalog yet — add one in the dashboard, or extract one from a recording.`;
    panel.appendChild(empty);
  } else {
    const results = testCatalogAgainstPage(catalog, MAPS);
    const order = { ready: 0, partial: 1, 'not-found': 2 };
    results.sort((a, b) => order[a.verdict] - order[b.verdict]);
    for (const result of results) panel.appendChild(renderResult(result));
  }

  const finish = () => host.remove();
  closeBtn.addEventListener('click', finish);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) finish();
  });
  document.addEventListener(
    'keydown',
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKeyDown, true);
        finish();
      }
    },
    true,
  );

  backdrop.appendChild(panel);
  root.appendChild(backdrop);
  panel.focus();
}

/** Re-injecting while the panel is already open just re-runs the scan against the page's current state instead of stacking a second host. */
async function runTestFunctionPanel(): Promise<void> {
  await renderPanel();
}

void runTestFunctionPanel();
