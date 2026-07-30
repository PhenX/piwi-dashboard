import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectProject, installCommand } from '../src/cli/detect.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-detect-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, contents = '') {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

describe('detectProject', () => {
  it('finds the TypeScript config and derives an unscoped project name', () => {
    write('package.json', JSON.stringify({ name: '@acme/checkout' }));
    write('playwright.config.ts');
    const shape = detectProject(root);
    expect(shape.configPath).toBe(path.join(root, 'playwright.config.ts'));
    expect(shape.configLang).toBe('ts');
    expect(shape.suggestedProjectName).toBe('checkout');
  });

  it('treats a .js config as JavaScript', () => {
    write('package.json', JSON.stringify({ name: 'app' }));
    write('playwright.config.js');
    expect(detectProject(root).configLang).toBe('js');
  });

  it('falls back to the folder name when package.json has no name', () => {
    write('package.json', JSON.stringify({}));
    expect(detectProject(root).suggestedProjectName).toBe(path.basename(root));
  });

  it('detects the reporter across dependencies and devDependencies', () => {
    write('package.json', JSON.stringify({ devDependencies: { '@piwitests/reporter': '^0.20.0' } }));
    expect(detectProject(root).reporterInstalled).toBe(true);
  });

  it('picks the package manager from a lockfile', () => {
    write('package.json', JSON.stringify({ name: 'app' }));
    write('pnpm-lock.yaml');
    expect(detectProject(root).packageManager).toBe('pnpm');
  });

  it('lets the corepack packageManager field win over a lockfile', () => {
    write('package.json', JSON.stringify({ name: 'app', packageManager: 'yarn@4.0.0' }));
    write('package-lock.json');
    expect(detectProject(root).packageManager).toBe('yarn');
  });

  it('defaults to npm and reports no config for a bare directory', () => {
    const shape = detectProject(root);
    expect(shape.packageManager).toBe('npm');
    expect(shape.configPath).toBeNull();
    expect(shape.packageJson).toBeNull();
  });
});

describe('installCommand', () => {
  it('names the reporter as a dev dependency for each manager', () => {
    expect(installCommand('npm')).toBe('npm install --save-dev @piwitests/reporter');
    expect(installCommand('pnpm')).toBe('pnpm add -D @piwitests/reporter');
    expect(installCommand('yarn')).toBe('yarn add -D @piwitests/reporter');
    expect(installCommand('bun')).toBe('bun add -d @piwitests/reporter');
  });
});
