import { describe, it, expect, afterEach } from 'vitest';
import { wrapConfig } from '../src/public/config-wrapper.js';
import { PIWI_DEFAULTED_CAPTURE_ENV } from '../src/internal/config/env.js';

describe('wrapConfig', () => {
  it('preserves other config properties', () => {
    const config = wrapConfig({
      testDir: './tests',
      timeout: 30_000,
      retries: 2,
      fullyParallel: true,
    });
    expect(config.testDir).toBe('./tests');
    expect(config.timeout).toBe(30_000);
    expect(config.retries).toBe(2);
    expect(config.fullyParallel).toBe(true);
  });

  it('forwards failOnFlakyTests into the Playwright config only when set', () => {
    const config = wrapConfig({ testDir: './tests' }, { failOnFlakyTests: true });
    expect(config.failOnFlakyTests).toBe(true);
    const off = wrapConfig({ testDir: './tests' });
    expect('failOnFlakyTests' in off).toBe(false);
  });

  it('forwards failOnFlakyTests from PIWI_FAIL_ON_FLAKY_TESTS', () => {
    const previous = process.env.PIWI_FAIL_ON_FLAKY_TESTS;
    try {
      process.env.PIWI_FAIL_ON_FLAKY_TESTS = 'true';
      expect(wrapConfig({ testDir: './tests' }).failOnFlakyTests).toBe(true);

      // An explicit option still wins over the env var.
      process.env.PIWI_FAIL_ON_FLAKY_TESTS = 'true';
      expect('failOnFlakyTests' in wrapConfig({ testDir: './tests' }, { failOnFlakyTests: false })).toBe(false);

      process.env.PIWI_FAIL_ON_FLAKY_TESTS = 'false';
      expect('failOnFlakyTests' in wrapConfig({ testDir: './tests' })).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.PIWI_FAIL_ON_FLAKY_TESTS;
      else process.env.PIWI_FAIL_ON_FLAKY_TESTS = previous;
    }
  });

  it('adds piwi global-setup-module when no original globalSetup exists', () => {
    const config = wrapConfig({ testDir: './tests' });
    expect(typeof config.globalSetup).toBe('string');
    expect((config.globalSetup as string).includes('global-setup-module')).toBeTruthy();
  });

  it('keeps original globalSetup string and appends piwi module', () => {
    const config = wrapConfig({ globalSetup: './tests/globalSetup' });
    expect(Array.isArray(config.globalSetup)).toBeTruthy();
    expect((config.globalSetup as string[]).length).toBe(2);
    expect((config.globalSetup as string[])[0]).toBe('./tests/globalSetup');
    expect((config.globalSetup as string[])[1].includes('global-setup-module')).toBeTruthy();
  });

  it('keeps original globalSetup array and appends piwi module', () => {
    const config = wrapConfig({ globalSetup: ['./tests/cleanup', './tests/bootstrap'] });
    expect(Array.isArray(config.globalSetup)).toBeTruthy();
    expect((config.globalSetup as string[]).length).toBe(3);
    expect((config.globalSetup as string[])[0]).toBe('./tests/cleanup');
    expect((config.globalSetup as string[])[1]).toBe('./tests/bootstrap');
    expect((config.globalSetup as string[])[2].includes('global-setup-module')).toBeTruthy();
  });

  it('injects piwi reporter when no reporter is set', () => {
    const config = wrapConfig({ testDir: './tests' });
    expect(Array.isArray(config.reporter)).toBeTruthy();
    expect((config.reporter as any[]).length).toBe(1);
    expect((config.reporter as any[])[0][0]).toBe('@piwitests/reporter');
  });

  it('injects piwi reporter alongside an existing string reporter', () => {
    const config = wrapConfig({ reporter: 'list' });
    expect(Array.isArray(config.reporter)).toBeTruthy();
    expect((config.reporter as any[]).length).toBe(2);
    expect((config.reporter as any[])[1][0]).toBe('@piwitests/reporter');
  });

  it('injects piwi reporter alongside an existing array reporter', () => {
    const config = wrapConfig({ reporter: [['json', { outputFile: 'report.json' }]] });
    expect(Array.isArray(config.reporter)).toBeTruthy();
    expect((config.reporter as any[]).length).toBe(2);
    expect((config.reporter as any[])[1][0]).toBe('@piwitests/reporter');
  });

  it('does not duplicate piwi reporter if already present', () => {
    const config = wrapConfig({
      reporter: [['@piwitests/reporter', { projectName: 'test' }]],
    });
    expect(Array.isArray(config.reporter)).toBeTruthy();
    expect((config.reporter as any[]).length).toBe(1);
  });

  it('passes piwiOptions to the injected reporter entry', () => {
    const config = wrapConfig(
      { testDir: './tests' },
      { projectName: 'my-project', serverUrl: 'http://localhost:3000' },
    );
    const entry = (config.reporter as any[]).find((r: any) => r[0] === '@piwitests/reporter');
    expect(entry).toBeTruthy();
    expect(entry[1]?.projectName).toBe('my-project');
    expect(entry[1]?.serverUrl).toBe('http://localhost:3000');
  });
});

describe('wrapConfig capture defaults', () => {
  afterEach(() => {
    delete process.env.PIWI_DEFAULT_CAPTURE;
    delete process.env[PIWI_DEFAULTED_CAPTURE_ENV];
  });

  it('defaults screenshot and trace on the top-level use when both are unset', () => {
    const config = wrapConfig({ testDir: './tests', use: { headless: true } });
    expect(config.use?.screenshot).toBe('only-on-failure');
    expect(config.use?.trace).toBe('retain-on-failure');
    // The original use option is preserved.
    expect(config.use?.headless).toBe(true);
    expect(process.env[PIWI_DEFAULTED_CAPTURE_ENV]).toBe('screenshot,trace');
  });

  it('defaults trace but keeps an explicit screenshot (only fills the unset one)', () => {
    const config = wrapConfig({ use: { screenshot: 'on' } });
    expect(config.use?.screenshot).toBe('on');
    expect(config.use?.trace).toBe('retain-on-failure');
    expect(process.env[PIWI_DEFAULTED_CAPTURE_ENV]).toBe('trace');
  });

  it("leaves an explicit 'off' untouched and defaults nothing else it already has", () => {
    const config = wrapConfig({ use: { screenshot: 'off', trace: 'off' } });
    expect(config.use?.screenshot).toBe('off');
    expect(config.use?.trace).toBe('off');
    expect(process.env[PIWI_DEFAULTED_CAPTURE_ENV]).toBeUndefined();
  });

  it('applies defaults even when the config has no use block', () => {
    const config = wrapConfig({ testDir: './tests' });
    expect(config.use?.screenshot).toBe('only-on-failure');
    expect(config.use?.trace).toBe('retain-on-failure');
  });

  it('never touches per-project use blocks', () => {
    const config = wrapConfig({
      projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    });
    expect((config.projects as any[])[0].use).toEqual({ browserName: 'chromium' });
    expect((config.projects as any[])[0].use.trace).toBeUndefined();
    // The top-level use still gets the defaults.
    expect(config.use?.trace).toBe('retain-on-failure');
  });

  it('opts out with defaultCapture: false', () => {
    const config = wrapConfig({ use: { headless: true } }, { defaultCapture: false });
    expect(config.use?.screenshot).toBeUndefined();
    expect(config.use?.trace).toBeUndefined();
    expect(process.env[PIWI_DEFAULTED_CAPTURE_ENV]).toBeUndefined();
  });

  it('opts out with PIWI_DEFAULT_CAPTURE=false', () => {
    process.env.PIWI_DEFAULT_CAPTURE = 'false';
    const config = wrapConfig({ use: { headless: true } });
    expect(config.use?.screenshot).toBeUndefined();
    expect(config.use?.trace).toBeUndefined();

    // An explicit option overrides the env var.
    const on = wrapConfig({ use: { headless: true } }, { defaultCapture: true });
    expect(on.use?.trace).toBe('retain-on-failure');
  });
});
