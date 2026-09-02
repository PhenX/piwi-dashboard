/**
 * Helpers for reading a run's `metadata` JSON and diffing the environment / SCM /
 * browser context of two runs. Shared by the run-comparison handler and the
 * server-side regression-context builder so the diff stays identical on both.
 */

/** One field that changed between two runs, for the "what changed" summary. */
export interface MetaDiffEntry {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
}

/** The slice of `test_runs.metadata` these helpers read. */
interface RunMetadataLike {
  scm?: { branch?: string | null } | null;
  ci?: { provider?: string | null } | null;
  htmlReport?: { projects?: Array<{ use?: { browserName?: string | null } | null }> } | null;
}

/** Build a provider-specific "compare two commits" URL, or null when the host is unknown. */
export function buildCompareUrl(repositoryUrl: string, fromSha: string, toSha: string): string | null {
  try {
    const { hostname } = new URL(repositoryUrl);
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      return `${repositoryUrl}/compare/${fromSha}...${toSha}`;
    }
    if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
      return `${repositoryUrl}/-/compare/${fromSha}...${toSha}`;
    }
    if (hostname === 'bitbucket.org') {
      return `${repositoryUrl}/branches/compare/${toSha}..${fromSha}#diff`;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Comma-separated list of the distinct browser names configured in a run's report. */
export function getBrowserList(meta: RunMetadataLike | null | undefined): string {
  const projects = meta?.htmlReport?.projects;
  if (!projects?.length) return '';
  const names = [...new Set(projects.map((p) => p.use?.browserName).filter(Boolean))] as string[];
  return names.join(', ');
}

/** Diff two runs' environment, branch, CI provider and browser set. */
export function computeMetadataDiff(
  prevMeta: RunMetadataLike | null | undefined,
  currMeta: RunMetadataLike | null | undefined,
  prevEnv: string | null,
  currEnv: string | null,
): MetaDiffEntry[] {
  const diff: MetaDiffEntry[] = [];

  if (prevEnv !== currEnv) {
    diff.push({ key: 'environment', label: 'Environment', before: prevEnv, after: currEnv });
  }
  const prevBranch: string | null = prevMeta?.scm?.branch ?? null;
  const currBranch: string | null = currMeta?.scm?.branch ?? null;
  if (prevBranch !== currBranch) {
    diff.push({ key: 'branch', label: 'Branch', before: prevBranch, after: currBranch });
  }
  const prevCi: string | null = prevMeta?.ci?.provider ?? null;
  const currCi: string | null = currMeta?.ci?.provider ?? null;
  if (prevCi !== currCi) {
    diff.push({ key: 'ci_provider', label: 'CI provider', before: prevCi, after: currCi });
  }
  const prevBrowsers = getBrowserList(prevMeta);
  const currBrowsers = getBrowserList(currMeta);
  if (prevBrowsers !== currBrowsers) {
    diff.push({ key: 'browsers', label: 'Browsers', before: prevBrowsers || null, after: currBrowsers || null });
  }

  return diff;
}
