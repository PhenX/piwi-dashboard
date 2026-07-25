import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Packaging guards for the published npm surface. These assert the invariants a
 * consumer relies on — a single public entry, fixtures re-exported from it, and
 * a peer dependency on Playwright — NOT the internal symbols of compiled files
 * (those are covered by the per-module unit tests and by typecheck, and grepping
 * `dist/*.js` for identifier names just breaks on harmless renames).
 */

const pkgPath = join(import.meta.dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const dist = (...segments: string[]) => join(import.meta.dirname, '..', 'dist', ...segments);

describe('package metadata', () => {
  it('names the package and points main/types at the built entry', () => {
    expect(pkg.name).toBe('@piwitests/reporter');
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
  });

  it('declares Playwright as a peer dependency', () => {
    expect(pkg.peerDependencies?.['@playwright/test']).toBeTruthy();
  });

  it('ships the dist/ directory', () => {
    expect(pkg.files).toContain('dist/');
  });
});

describe('public export surface', () => {
  it('exposes one code entry (".") with no ./fixtures subpath', () => {
    // Fixtures are imported from '@piwitests/reporter', not a subpath — the
    // package intentionally has a single public code entry. "./package.json"
    // is metadata for tooling (bundlers, license scanners), not an API.
    expect(Object.keys(pkg.exports)).toEqual(['.', './package.json']);
    expect(pkg.exports['.'].types).toBe('./dist/index.d.ts');
    expect(pkg.exports['.'].import).toBe('./dist/index.js');
    expect(pkg.exports['./package.json']).toBe('./package.json');
  });
});

// The built entry can only be inspected after `npm run reporter:build`. Gate on
// its presence so the unit suite stays green without a build, while still
// verifying the single-entry re-export invariant once dist/ exists (e.g. in CI).
describe.runIf(existsSync(dist('index.js')))('built entry (requires a build)', () => {
  it('re-exports the capture fixtures from the single entry', () => {
    const source = readFileSync(dist('index.js'), 'utf-8');
    expect(source).toContain('piwiFixtures');
    expect(source).toContain('extendPiwiFixtures');
  });

  it('exports the options type from the published .d.ts', () => {
    const types = readFileSync(dist('index.d.ts'), 'utf-8');
    expect(types).toMatch(/interface PiwiDashboardOptions\b/);
    // Consumers `import type { PiwiDashboardOptions } from '@piwitests/reporter'`,
    // so the declaration must also be re-exported from the entry.
    expect(types).toMatch(/export \{[^}]*\bPiwiDashboardOptions\b/s);
  });

  it('keeps Playwright config options out of PiwiDashboardOptions', () => {
    const types = readFileSync(dist('index.d.ts'), 'utf-8');
    // It used to `extends PlaywrightTestConfig`, which made editors complete
    // `testDir` / `use` / `timeout` on the reporter's own options object and let
    // them typecheck there even though the reporter ignores them. The Playwright
    // config goes in `wrapConfig`'s first argument, not its second.
    expect(types).not.toMatch(/interface PiwiDashboardOptions\s+extends/);
  });
});
