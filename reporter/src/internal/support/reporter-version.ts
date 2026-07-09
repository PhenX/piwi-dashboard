import * as fs from 'node:fs';
import * as path from 'node:path';

let cachedVersion: string | null = null;

/** Read the reporter package's own version from `package.json`, memoized. Falls back to `'unknown'` if it can't be read (e.g. an unusual install layout). */
export function getReporterVersion(): string {
  if (cachedVersion) return cachedVersion;

  try {
    const pkgPath = path.resolve(__dirname, '../../../package.json');
    const pkg: unknown = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const version = (pkg as { version?: unknown }).version;
    cachedVersion = typeof version === 'string' ? version : 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }

  return cachedVersion;
}
