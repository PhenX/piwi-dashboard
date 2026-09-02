/**
 * Entry identity and on-disk naming.
 *
 * An entry is keyed per test by the *normalized template*, so one file serves
 * every parameter value (`test.each`-friendly) and re-phrasings that differ only
 * in whitespace or case collapse to the same key. Duplicate templates within a
 * single test are disambiguated by **source position order** — the ordinal of a
 * call site among its siblings, sorted by file position — rather than by dynamic
 * call order, so a branch that skips one call never shifts another's identity.
 *
 * Storage layout (Playwright-snapshots style, committed to git):
 *   <spec-dir>/<dir>/<spec-file>/<test-slug>.<prompt-slug>.<hash8>.json
 */
import * as crypto from 'node:crypto';
import * as path from 'node:path';

/** Default directory name that holds a spec's entries. Configurable via options. */
export const DEFAULT_AI_DIR = '__piwi__';

/** Collapse whitespace, trim, and lower-case so equivalent phrasings share a key. */
export function normalizeTemplate(template: string): string {
  return template.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Stable 8-hex identity for a normalized template within a test. The ordinal is
 * folded in only when non-zero, so the common (unique-template) case keeps a
 * clean hash and adding a duplicate never renames the original.
 */
export function hashTemplate(normalized: string, ordinal = 0): string {
  const input = ordinal > 0 ? `${normalized}#${ordinal}` : normalized;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
}

/** Lower-case, hyphenate, and truncate arbitrary text into a filesystem-safe slug. */
export function slug(text: string, maxLength = 40): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || 'x').slice(0, maxLength).replace(/-+$/g, '') || 'x';
}

/** The directory holding one spec file's entries. */
export function entryDir(specFile: string, dir: string = DEFAULT_AI_DIR): string {
  return path.join(path.dirname(specFile), dir, path.basename(specFile));
}

/**
 * The absolute path of a single entry file. `hash8` encodes the test identity
 * alongside the normalized template (and the ordinal for duplicates), so two
 * tests that slugify to the same name never collide on one file.
 */
export function entryPath(params: {
  specFile: string;
  testTitle: string;
  template: string;
  ordinal?: number;
  dir?: string;
}): string {
  const basis = `${normalizeTemplate(params.testTitle)}::${normalizeTemplate(params.template)}`;
  const hash = hashTemplate(basis, params.ordinal ?? 0);
  const name = `${slug(params.testTitle)}.${slug(params.template)}.${hash}.json`;
  return path.join(entryDir(params.specFile, params.dir), name);
}

// ── Source-position ordinals ─────────────────────────────────────────────────

/** Parse a `file:line:col` caller location into a sortable tuple, or null. */
function parseLocation(location: string): { line: number; col: number } | null {
  const match = /:(\d+):(\d+)$/.exec(location);
  if (!match) return null;
  return { line: Number(match[1]), col: Number(match[2]) };
}

/** Order call-site locations by their position in the file (line, then column). */
export function orderByPosition(locations: readonly string[]): string[] {
  return [...new Set(locations)].sort((a, b) => {
    const pa = parseLocation(a);
    const pb = parseLocation(b);
    if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
    return pa.line - pb.line || pa.col - pb.col;
  });
}

/**
 * The ordinal of `location` among a set of same-template call sites, by source
 * position. Sites are sorted by position first, so the ordinal is independent of
 * the order in which the calls actually ran.
 */
export function ordinalForLocation(sites: readonly string[], location: string): number {
  const ordered = orderByPosition(sites);
  const index = ordered.indexOf(location);
  return index < 0 ? 0 : index;
}

/**
 * Statically find every line in `source` that mentions the given template as a
 * string literal, returned as `line:col` positions. Used to assign stable
 * ordinals to duplicate templates without depending on which branches ran, and
 * by `piwi ai check` to detect orphaned and duplicate entries.
 */
export function findTemplateSites(source: string, template: string): string[] {
  const needle = template.trim();
  if (!needle) return [];
  const sites: string[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let from = 0;
    for (;;) {
      const col = lines[i].indexOf(needle, from);
      if (col < 0) break;
      sites.push(`${i + 1}:${col + 1}`);
      from = col + needle.length;
    }
  }
  return sites;
}
