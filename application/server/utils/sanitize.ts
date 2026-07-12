import { filterAndCapNetworkRequests } from '#shared/utils/filter-network-requests';

/**
 * URL and network data sanitization helpers.
 *
 * These are used by both submit.post.ts and upload.post.ts to strip sensitive
 * information (query parameters, fragments) from network request URLs and web
 * vitals navigation URLs before they are persisted in the database and exposed
 * through unauthenticated GET endpoints.
 */

/**
 * Strip query string and fragment from a URL, keeping only scheme + host + path.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    // Not a valid absolute URL — return as-is (relative paths, data URIs, etc.)
    return url;
  }
}

/**
 * Sanitize an array of network request objects by stripping query params,
 * filtering to API/document types, and capping to failures + top 50.
 */
export function sanitizeNetworkRequests(requests: unknown[] | null | undefined): Record<string, unknown>[] | null {
  if (!requests || !Array.isArray(requests)) return null;
  const entries = filterAndCapNetworkRequests(requests as any);
  if (entries.length === 0) return null;
  return entries.map((r) => ({
    ...r,
    url: typeof r.url === 'string' ? sanitizeUrl(r.url) : r.url,
  }));
}

/**
 * Sanitize webVitals by stripping the query string from the navigation URL.
 */
export function sanitizeWebVitals(vitals: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!vitals || typeof vitals !== 'object') return null;
  const nav = vitals.navigation as Record<string, unknown> | null | undefined;
  if (!nav) return vitals;
  return {
    ...vitals,
    navigation: {
      ...nav,
      url: typeof nav.url === 'string' ? sanitizeUrl(nav.url) : nav.url,
    },
  };
}

/**
 * Sanitize console log entries by stripping the query string from the URL part
 * of each entry's `location` (formatted as `url:line:column`).
 */
/**
 * Strip userinfo (username:password) from a Git remote URL.
 * Handles `https://token@host/repo` and `https://user:pass@host/repo` patterns.
 * Returns the sanitised URL, or the original string if parsing fails.
 */
export function sanitizeGitRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) {
      parsed.username = '';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Sanitize run-level metadata by stripping credentials from SCM remote URLs.
 * This prevents token-leakage through public GET endpoints (§1.7).
 */
export function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const meta = { ...metadata };

  // Sanitize scm.remoteUrl
  const scm = meta.scm as Record<string, unknown> | null | undefined;
  if (scm && typeof scm.remoteUrl === 'string') {
    meta.scm = { ...scm, remoteUrl: sanitizeGitRemoteUrl(scm.remoteUrl) };
  }

  return meta;
}

/**
 * Defensive shape-validation of the reporter's page-state payload before it is
 * persisted. The reporter already never captures storage/cookie values — this
 * server-side pass enforces the same contract against arbitrary submitters:
 * only whitelisted fields survive, counts and string lengths are capped.
 */
export function sanitizePageState(state: unknown): Record<string, unknown> | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const s = state as Record<string, unknown>;

  const str = (v: unknown, cap: number): string | null => (typeof v === 'string' ? v.slice(0, cap) : null);
  const storage = (v: unknown): Array<{ key: string; length: number }> =>
    Array.isArray(v)
      ? v
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
          .slice(0, 50)
          .map((e) => ({
            key: typeof e.key === 'string' ? e.key.slice(0, 200) : '',
            length: typeof e.length === 'number' ? e.length : 0,
          }))
      : [];
  const cookies = Array.isArray(s.cookies)
    ? s.cookies
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .slice(0, 30)
        .map((c) => ({
          name: typeof c.name === 'string' ? c.name.slice(0, 200) : '',
          domain: typeof c.domain === 'string' ? c.domain.slice(0, 200) : '',
          path: typeof c.path === 'string' ? c.path.slice(0, 200) : '',
          httpOnly: Boolean(c.httpOnly),
          secure: Boolean(c.secure),
          ...(typeof c.sameSite === 'string' ? { sameSite: c.sameSite.slice(0, 20) } : {}),
          ...(typeof c.expires === 'number' ? { expires: c.expires } : {}),
        }))
    : [];

  const url = str(s.url, 2000);
  if (!url) return null;

  return {
    url: sanitizeUrl(url),
    hash: str(s.hash, 500),
    historyState: str(s.historyState, 2100),
    localStorage: storage(s.localStorage),
    sessionStorage: storage(s.sessionStorage),
    cookies,
  };
}

export function sanitizeConsoleLogs(
  logs: Array<Record<string, unknown>> | null | undefined,
): Array<Record<string, unknown>> | null {
  if (!logs || !Array.isArray(logs)) return null;
  return logs.map((log) => {
    if (typeof log.location !== 'string') return log;
    // location is `url:line:column`; the URL itself contains colons (https://…)
    const match = log.location.match(/^(.*):(\d+):(\d+)$/);
    if (!match) return log;
    return { ...log, location: `${sanitizeUrl(match[1]!)}:${match[2]}:${match[3]}` };
  });
}
