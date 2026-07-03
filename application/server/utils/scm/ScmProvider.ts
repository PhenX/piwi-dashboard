export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ScmCommit {
  sha: string;
  message: string;
}

export interface ScmCommitDetail {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export interface ScmChanges {
  commits: ScmCommit[];
  files: ChangedFile[];
  /** true when the raw diff was skipped because it exceeded the size cap */
  patchesOmitted?: boolean;
}

/** Full content of a file at a specific ref (used to ground diagnosis patches). */
export interface ScmFileContent {
  path: string;
  content: string;
  /** true when the content was truncated to MAX_FILE_BYTES */
  truncated: boolean;
}

export const MAX_SCM_FILES = 30;
export const MAX_PATCH_PER_FILE = 100_000;
export const MAX_RAW_DIFF_BYTES = 200_000;
/** Cap on a single file's content fetched via fetchFileAtRef. */
export const MAX_FILE_BYTES = 200_000;
export const FETCH_TIMEOUT_MS = 10_000;

export function truncatePatch(patch: string): string {
  if (patch.length <= MAX_PATCH_PER_FILE) return patch;
  return patch.slice(0, MAX_PATCH_PER_FILE) + '\n[... patch truncated ...]';
}

/** FNV-1a 32-bit hash → 8 hex chars. Stable, dependency-free, good enough to namespace cache keys by token. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export abstract class ScmProvider {
  abstract readonly provider: 'github' | 'gitlab' | 'bitbucket';
  protected readonly token: string | null;
  /**
   * Namespaces module-level cache keys by the token in use so a token-less
   * (public, rate-limited) fetch can never serve its result to an authenticated
   * caller, or vice-versa.
   */
  protected readonly keyPrefix: string;

  constructor(token: string | null) {
    this.token = token;
    this.keyPrefix = token ? shortHash(token) : 'anon';
  }

  protected makeHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': 'piwi-dashboard' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  abstract listBranches(limit?: number): Promise<string[]>;
  abstract listCommits(limit?: number, branch?: string): Promise<ScmCommitDetail[]>;
  abstract fetchChanges(fromSha: string, toSha: string): Promise<ScmChanges | null>;
  abstract fetchCommitDiff(sha: string): Promise<ScmChanges | null>;
  abstract probeError(branch?: string): Promise<string | null>;
  /**
   * Full content of a single file at a ref (commit SHA / branch). Returns null
   * when the file does not exist at that ref or the fetch fails. Content is
   * immutable per SHA, so implementations may cache aggressively.
   */
  abstract fetchFileAtRef(path: string, ref: string): Promise<ScmFileContent | null>;
  /**
   * Recursive list of repo-relative file paths at a ref. Used to normalize
   * reporter paths to repo-relative and to validate patch paths. Returns null
   * on failure; may be capped by the provider.
   */
  abstract fetchTree(ref: string): Promise<string[] | null>;
}
