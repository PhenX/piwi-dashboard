import type { TestFunctionEntry } from '@piwitests/core/function-match';
import type { ConnectionSettings } from './connection-settings';

/**
 * Talks to a Piwi instance — the only place in this extension that makes a
 * network call. Called from the background service worker and the options
 * page only, never from a content script, so the API key is never reachable
 * from a web page's JS context (matches `extension/AGENTS.md`'s standalone
 * stance: connected mode is opt-in and clearly separated).
 */

export interface ProjectOption {
  id: number;
  name: string;
  label: string | null;
}

function normalizeBaseUrl(instanceUrl: string): string {
  return instanceUrl.trim().replace(/\/+$/, '');
}

function authHeaders(settings: ConnectionSettings): HeadersInit {
  return settings.apiKey.trim() ? { 'X-API-Key': settings.apiKey.trim() } : {};
}

export type ConnectionCheckResult = { ok: true } | { ok: false; error: string };

/** Hits `/api/projects/menu` — cheap, always available, and exercises auth the same way the rest of the client does. */
export async function testConnection(settings: ConnectionSettings): Promise<ConnectionCheckResult> {
  if (!settings.instanceUrl.trim()) return { ok: false, error: 'Enter an instance URL first.' };
  try {
    const res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/menu`, {
      headers: authHeaders(settings),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Rejected — check the API key.' };
    if (!res.ok) return { ok: false, error: `Instance responded with ${res.status}.` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach that instance — check the URL and that it's running." };
  }
}

export async function fetchProjects(settings: ConnectionSettings): Promise<ProjectOption[]> {
  if (!settings.instanceUrl.trim()) return [];
  const res = await fetch(`${normalizeBaseUrl(settings.instanceUrl)}/api/projects/menu`, {
    headers: authHeaders(settings),
  });
  if (!res.ok) throw new Error(`Failed to list projects (${res.status})`);
  return (await res.json()) as ProjectOption[];
}

interface TestFunctionsApiResponse {
  testFunctions: Array<{ entry: TestFunctionEntry }>;
}

/** The project's function catalog, ready to hand to `rankFunctionMatches`/`matchFunctionAt`/`renderSpec`. */
export async function fetchCatalog(settings: ConnectionSettings): Promise<TestFunctionEntry[]> {
  if (!settings.instanceUrl.trim() || settings.projectId == null) return [];
  const res = await fetch(
    `${normalizeBaseUrl(settings.instanceUrl)}/api/projects/${settings.projectId}/test-functions`,
    {
      headers: authHeaders(settings),
    },
  );
  if (!res.ok) throw new Error(`Failed to fetch the function catalog (${res.status})`);
  const body = (await res.json()) as TestFunctionsApiResponse;
  return body.testFunctions.map((row) => row.entry);
}
