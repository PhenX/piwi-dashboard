/**
 * The handful of POSIX path operations the import parsers need, without
 * `node:path`.
 *
 * Paths recorded inside a Playwright archive come from whatever machine ran
 * the tests, so resolving them is pure string work on `/`-separated segments —
 * there is no local filesystem involved, and the parsers that do it must run in
 * the browser as well as on the server (demo mode imports through a service
 * worker). Windows separators are normalized by the callers before these are
 * used.
 */

export function isAbsolutePosix(path: string): boolean {
  return path.startsWith('/');
}

export function dirnamePosix(path: string): string {
  const index = path.lastIndexOf('/');
  if (index < 0) return '.';
  if (index === 0) return '/';
  return path.slice(0, index);
}

/**
 * Collapse `.` and `..` segments, keeping a leading `/` and any leading `..`
 * that cannot be resolved away.
 */
export function normalizePosix(path: string): string {
  const absolute = isAbsolutePosix(path);
  const out: string[] = [];

  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      // A leading `..` on a relative path has nothing to cancel against.
      if (out.length > 0 && out.at(-1) !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(segment);
  }

  const joined = out.join('/');
  if (absolute) return `/${joined}`;
  return joined || '.';
}

export function joinPosix(...parts: string[]): string {
  const joined = parts.filter(Boolean).join('/');
  return joined ? normalizePosix(joined) : '.';
}

/** The path of `to` relative to `from`, both normalized first. */
export function relativePosix(from: string, to: string): string {
  const fromParts = normalizePosix(from).split('/').filter(Boolean);
  const toParts = normalizePosix(to).split('/').filter(Boolean);

  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared++;

  const up = Array.from({ length: fromParts.length - shared }, () => '..');
  return [...up, ...toParts.slice(shared)].join('/');
}
