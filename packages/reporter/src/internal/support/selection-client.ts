/**
 * Thin HTTP client for the dashboard's selection resolve endpoint, shared by the
 * `piwi select` / `piwi run` CLI and the `resolveSelection()` config helper.
 * Resolution happens server-side; this only names the project, calls resolve,
 * and hands back the structured result.
 */

export interface SelectionResolution {
  key: string | null;
  version: number | null;
  tests: Array<{ testCaseId: number; filePath: string; title: string; line: number | null }>;
  resolvedHash: string;
  estimate: { count: number; totalDurationMs: number | null };
  warnings: Array<{ code: string; message: string }>;
  materialization: { format: string; args: string[]; command: string };
}

export interface SelectionClientOptions {
  serverUrl: string;
  apiKey?: string | null;
  /** Project name or numeric id. */
  project: string;
  key: string;
  format?: string;
  budgetMs?: number | null;
  pkgRunner?: string;
}

function authHeaders(apiKey?: string | null): Record<string, string> {
  return apiKey ? { 'X-API-Key': apiKey } : {};
}

/** Resolve a project name to its id, or pass a numeric id straight through. */
export async function resolveProjectId(options: SelectionClientOptions): Promise<number> {
  if (!options.project) throw new Error('No project — pass --project or set PIWI_PROJECT_NAME');
  if (/^\d+$/.test(options.project)) return Number(options.project);

  const res = await fetch(`${options.serverUrl}/api/projects/menu`, { headers: authHeaders(options.apiKey) });
  if (!res.ok) throw new Error(`Could not list projects (dashboard returned ${res.status})`);
  const body = (await res.json()) as { items?: Array<{ id: number; name: string }> };
  const match = body.items?.find((p) => p.name.toLowerCase() === options.project.toLowerCase());
  if (!match) throw new Error(`No project named "${options.project}" on this dashboard`);
  return match.id;
}

/** Resolve a saved (or built-in) selection to its runnable materialization. */
export async function fetchResolution(
  options: SelectionClientOptions,
  projectId: number,
): Promise<SelectionResolution> {
  const params = new URLSearchParams({ format: options.format ?? 'args' });
  if (options.pkgRunner) params.set('pkgRunner', options.pkgRunner);
  if (options.budgetMs != null) params.set('budgetMs', String(options.budgetMs));
  const url = `${options.serverUrl}/api/projects/${projectId}/selections/${encodeURIComponent(options.key)}/resolve?${params}`;
  const res = await fetch(url, { headers: authHeaders(options.apiKey) });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || `Dashboard returned ${res.status} resolving "${options.key}"`);
  }
  return (await res.json()) as SelectionResolution;
}
