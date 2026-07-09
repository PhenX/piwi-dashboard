import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getReporterVersion } from '../src/internal/support/reporter-version.js';

describe('getReporterVersion', () => {
  it("returns the reporter package's own version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
    expect(getReporterVersion()).toBe(pkg.version);
  });

  it('is stable across repeated calls (memoized)', () => {
    expect(getReporterVersion()).toBe(getReporterVersion());
  });
});
