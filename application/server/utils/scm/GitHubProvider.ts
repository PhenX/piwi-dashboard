import { ScmProvider, truncatePatch, MAX_SCM_FILES, MAX_FILE_BYTES, FETCH_TIMEOUT_MS } from './ScmProvider';
import type { ScmCommitDetail, ScmChanges, ScmFileContent } from './ScmProvider';
import { TtlCache } from './cache';

const listBranchesCache = new TtlCache<string[]>(3 * 60 * 1000);
const listCommitsCache = new TtlCache<ScmCommitDetail[]>(3 * 60 * 1000);
const fetchChangesCache = new TtlCache<ScmChanges>(10 * 60 * 1000);
const fetchCommitDiffCache = new TtlCache<ScmChanges>(10 * 60 * 1000);
// Content is immutable per SHA, so cache it (incl. negative lookups) for longer.
const fetchFileCache = new TtlCache<ScmFileContent | null>(30 * 60 * 1000);
const fetchTreeCache = new TtlCache<string[]>(10 * 60 * 1000);

export class GitHubProvider extends ScmProvider {
  readonly provider = 'github' as const;

  constructor(
    private readonly repoPath: string,
    token: string | null,
  ) {
    super(token);
  }

  protected override makeHeaders() {
    return {
      ...super.makeHeaders(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async listBranches(limit = 100): Promise<string[]> {
    const key = `${this.keyPrefix}:branches:${this.repoPath}:${limit}`;
    const hit = listBranchesCache.get(key);
    if (hit !== undefined) return hit;

    const res = await fetch(`https://api.github.com/repos/${this.repoPath}/branches?per_page=${limit}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ name: string }>;
    const result = data.map((b) => b.name);
    listBranchesCache.set(key, result);
    return result;
  }

  async listCommits(limit = 50, branch?: string): Promise<ScmCommitDetail[]> {
    const key = `${this.keyPrefix}:${this.repoPath}:${limit}:${branch ?? ''}`;
    const hit = listCommitsCache.get(key);
    if (hit !== undefined) return hit;

    const url = new URL(`https://api.github.com/repos/${this.repoPath}/commits`);
    url.searchParams.set('per_page', String(limit));
    if (branch) url.searchParams.set('sha', branch);

    const res = await fetch(url.toString(), {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      sha: string;
      commit: { message: string; author: { name: string; date: string } | null };
    }>;
    const result = data.map((c) => ({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: (c.commit.message.split('\n')[0] ?? '').trim(),
      author: c.commit.author?.name ?? '',
      date: c.commit.author?.date ?? '',
    }));
    listCommitsCache.set(key, result);
    return result;
  }

  async fetchChanges(fromSha: string, toSha: string): Promise<ScmChanges | null> {
    const key = `${this.keyPrefix}:${this.repoPath}:${fromSha}:${toSha}`;
    const hit = fetchChangesCache.get(key);
    if (hit !== undefined) return hit;

    const res = await fetch(`https://api.github.com/repos/${this.repoPath}/compare/${fromSha}...${toSha}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      commits?: Array<{ sha: string; commit: { message: string } }>;
      files?: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>;
    };
    const result: ScmChanges = {
      commits: (data.commits ?? []).map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0] ?? '',
      })),
      files: (data.files ?? []).slice(0, MAX_SCM_FILES).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ? truncatePatch(f.patch) : undefined,
      })),
    };
    fetchChangesCache.set(key, result);
    return result;
  }

  async fetchCommitDiff(sha: string): Promise<ScmChanges | null> {
    const key = `${this.keyPrefix}:${this.repoPath}:${sha}`;
    const hit = fetchCommitDiffCache.get(key);
    if (hit !== undefined) return hit;

    const res = await fetch(`https://api.github.com/repos/${this.repoPath}/commits/${sha}`, {
      headers: this.makeHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `GitHub API error ${res.status}`);
    }
    const data = (await res.json()) as {
      files?: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>;
    };
    const result: ScmChanges = {
      commits: [],
      files: (data.files ?? []).slice(0, MAX_SCM_FILES).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ? truncatePatch(f.patch) : undefined,
      })),
    };
    fetchCommitDiffCache.set(key, result);
    return result;
  }

  async fetchFileAtRef(path: string, ref: string): Promise<ScmFileContent | null> {
    const cleanPath = path.replace(/^\//, '');
    const key = `${this.keyPrefix}:file:${this.repoPath}:${ref}:${cleanPath}`;
    const hit = fetchFileCache.get(key);
    if (hit !== undefined) return hit;

    const url = new URL(`https://api.github.com/repos/${this.repoPath}/contents/${cleanPath}`);
    url.searchParams.set('ref', ref);
    const res = await fetch(url.toString(), {
      headers: { ...this.makeHeaders(), Accept: 'application/vnd.github.raw' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      fetchFileCache.set(key, null);
      return null;
    }
    const raw = await res.text();
    const result: ScmFileContent = {
      path: cleanPath,
      content: raw.length > MAX_FILE_BYTES ? raw.slice(0, MAX_FILE_BYTES) : raw,
      truncated: raw.length > MAX_FILE_BYTES,
    };
    fetchFileCache.set(key, result);
    return result;
  }

  async fetchTree(ref: string): Promise<string[] | null> {
    const key = `${this.keyPrefix}:tree:${this.repoPath}:${ref}`;
    const hit = fetchTreeCache.get(key);
    if (hit !== undefined) return hit;

    const treePaths = async (treeish: string): Promise<string[] | null> => {
      const res = await fetch(`https://api.github.com/repos/${this.repoPath}/git/trees/${treeish}?recursive=1`, {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { tree?: Array<{ path: string; type: string }> };
      return (data.tree ?? []).filter((e) => e.type === 'blob').map((e) => e.path);
    };

    // The trees endpoint takes a tree SHA or ref. A commit SHA usually resolves
    // too, but when it doesn't, resolve the commit to its tree SHA and retry.
    let result = await treePaths(ref);
    if (result === null) {
      const commitRes = await fetch(`https://api.github.com/repos/${this.repoPath}/commits/${ref}`, {
        headers: this.makeHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!commitRes.ok) return null;
      const commit = (await commitRes.json()) as { commit?: { tree?: { sha?: string } } };
      const treeSha = commit.commit?.tree?.sha;
      if (!treeSha) return null;
      result = await treePaths(treeSha);
    }
    if (result === null) return null;
    fetchTreeCache.set(key, result);
    return result;
  }

  async probeError(branch?: string): Promise<string | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${this.repoPath}`, { headers: this.makeHeaders() });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        const msg = body?.message ?? `GitHub API returned ${res.status}`;
        if (res.status === 403 && msg.toLowerCase().includes('rate limit')) {
          return 'GitHub API rate limit exceeded. Set an SCM token in Settings → AI to increase the limit.';
        }
        if (res.status === 404)
          return 'Repository not found on GitHub. Check the remote URL in your test run metadata.';
        if (res.status === 401) return 'GitHub API authentication failed. Check your SCM token in Settings → AI.';
        return `GitHub API error: ${msg}`;
      }
      return `No commits found on ${branch ? `branch '${branch}'` : 'the default branch'}.`;
    } catch {
      return 'Could not reach the GitHub API. Check your network connection.';
    }
  }
}
