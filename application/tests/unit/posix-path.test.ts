import { describe, test, expect } from 'vitest';
import { posix } from 'node:path';
import { dirnamePosix, isAbsolutePosix, joinPosix, normalizePosix, relativePosix } from '#shared/utils/posix-path';

/**
 * These replace `node:path` in the import parsers so they can run in the demo's
 * service worker. Node's own implementation is the reference: every case is
 * asserted against it, so a divergence shows up here rather than as a subtly
 * wrong spec path on an imported run.
 */
const CASES: Array<[string, string]> = [
  ['/repo/tests', '/repo/tests/checkout.spec.ts'],
  ['/repo', '/repo/e2e/login.spec.ts'],
  ['/repo/packages/app/tests', '/repo/packages/app/tests/a/b.spec.ts'],
  ['/repo/tests', '/repo/other/x.spec.ts'],
  ['/a/b/c', '/a/b'],
  ['/same', '/same'],
];

describe('posix path helpers match node:path', () => {
  test('relative', () => {
    for (const [from, to] of CASES) {
      expect(relativePosix(from, to), `${from} → ${to}`).toBe(posix.relative(from, to));
    }
  });

  test('join and normalize', () => {
    const inputs: string[][] = [
      ['/repo/tests', '..'],
      ['/repo/tests', '../..'],
      ['/repo', 'e2e/login.spec.ts'],
      ['/repo/tests', './a/./b.spec.ts'],
      ['tests', '../shared/x.ts'],
    ];
    for (const parts of inputs) {
      expect(joinPosix(...parts), parts.join(' + ')).toBe(posix.join(...parts));
    }

    for (const value of ['/a/b/../c', 'a/./b', '/a/../..', '../x', 'a//b']) {
      // Node keeps a trailing slash on inputs that had one; nothing here does,
      // except root, which must stay `/`.
      const expected = posix.normalize(value);
      expect(normalizePosix(value), value).toBe(expected.length > 1 ? expected.replace(/\/$/, '') : expected);
    }
  });

  test('dirname and isAbsolute', () => {
    for (const value of ['/repo/tests/a.spec.ts', '../playwright.config.ts', 'playwright.config.ts', '/top', '/']) {
      expect(dirnamePosix(value), value).toBe(posix.dirname(value));
      expect(isAbsolutePosix(value), value).toBe(posix.isAbsolute(value));
    }
  });
});

describe('the shapes the blob-report resolver relies on', () => {
  test('a config one level above the test root yields the reporter-style prefix', () => {
    // rootDir=/repo/tests, configFile=../playwright.config.ts → base is /repo.
    const base = normalizePosix(joinPosix('/repo/tests', dirnamePosix('../playwright.config.ts')));
    expect(base).toBe('/repo');
    expect(relativePosix(base, joinPosix('/repo/tests', 'checkout.spec.ts'))).toBe('tests/checkout.spec.ts');
  });

  test('a config at the test root leaves the path untouched', () => {
    const base = normalizePosix(joinPosix('/repo', dirnamePosix('playwright.config.ts')));
    expect(base).toBe('/repo');
    expect(relativePosix(base, joinPosix('/repo', 'e2e/checkout.spec.ts'))).toBe('e2e/checkout.spec.ts');
  });

  test('a file outside the base is reported as escaping it', () => {
    expect(relativePosix('/repo/tests', '/elsewhere/x.spec.ts').startsWith('..')).toBe(true);
  });
});
