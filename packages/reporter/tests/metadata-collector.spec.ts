import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FullConfig } from '@playwright/test/reporter';
import { MetadataCollector } from '../src/internal/collect/metadata-collector.js';

const CI_ENV_KEYS = [
  'JENKINS_URL',
  'BUILD_NUMBER',
  'BUILD_URL',
  'JOB_NAME',
  'GITHUB_ACTIONS',
  'GITHUB_RUN_ID',
  'GITHUB_RUN_NUMBER',
  'GITHUB_WORKFLOW',
  'GITHUB_ACTOR',
  'GITHUB_REPOSITORY',
  'GITHUB_REF',
  'GITHUB_SHA',
  'GITHUB_SERVER_URL',
  'GITLAB_CI',
  'CI_PIPELINE_ID',
  'CI_PIPELINE_URL',
  'CI_JOB_ID',
  'CI_JOB_URL',
  'CI_JOB_NAME',
  'CIRCLECI',
  'CIRCLE_BUILD_NUM',
  'CIRCLE_BUILD_URL',
  'CIRCLE_JOB',
  'CIRCLE_WORKFLOW_ID',
  'TRAVIS',
  'TRAVIS_BUILD_NUMBER',
  'TRAVIS_BUILD_WEB_URL',
  'TRAVIS_JOB_NUMBER',
  'TF_BUILD',
  'BUILD_BUILDNUMBER',
  'BUILD_BUILDID',
  'SYSTEM_TEAMFOUNDATIONSERVERURI',
  'SYSTEM_TEAMPROJECT',
  'AGENT_JOBNAME',
  'CI',
];

const SAVED_CI_ENV: Record<string, string | undefined> = {};

function fakeConfig(): FullConfig {
  return { projects: [], workers: 1, globalTimeout: 0, fullyParallel: false } as unknown as FullConfig;
}

/** Build a fake describe suite chain: root → parent → child (the test's parent). */
function fakeSuiteChain(opts: { parallelMode?: string; annotations?: any[]; titles?: string[] } = {}): any {
  const titles = opts.titles ?? ['Outer', 'Inner'];
  const make = (title: string, parent: any, mode?: string, annotations?: any[]): any => ({
    type: 'describe',
    title,
    parent,
    _parallelMode: mode,
    _annotations: annotations,
  });
  const root = make('', undefined, undefined, undefined);
  root.type = 'project'; // root is not a describe
  let current = root;
  const outer = make(titles[0], current, opts.parallelMode ?? 'serial', opts.annotations);
  current = outer;
  const inner = make(titles[1] ?? '', current, 'parallel', []);
  return { root, outer, inner };
}

describe('MetadataCollector.getSuiteInfo', () => {
  it('walks the describe chain collecting titles and per-level config', () => {
    const mc = new MetadataCollector();
    const { inner } = fakeSuiteChain({
      parallelMode: 'serial',
      annotations: [{ type: 'skip', description: 'flaky' }],
      titles: ['Outer', 'Inner'],
    });
    const test = { parent: inner } as any;
    const info = mc.getSuiteInfo(test);
    expect(info.suitePath).toEqual(['Outer', 'Inner']);
    expect(info.suiteConfig.length).toBe(2);
    expect(info.suiteConfig[0].mode).toBe('serial');
    expect(info.suiteConfig[0].annotations).toEqual([{ type: 'skip', description: 'flaky' }]);
    expect(info.suiteConfig[1].mode).toBe('parallel');
  });

  it('defaults unknown mode to "default"', () => {
    const mc = new MetadataCollector();
    const { outer } = fakeSuiteChain({ parallelMode: undefined, titles: ['Solo'] });
    const inner = { type: 'describe', title: 'Inner', parent: outer, _parallelMode: undefined, _annotations: [] };
    const test = { parent: inner } as any;
    const info = mc.getSuiteInfo(test);
    expect(info.suiteConfig[info.suiteConfig.length - 1].mode).toBe('default');
  });

  it('skips suites with empty titles', () => {
    const mc = new MetadataCollector();
    const root = { type: 'project', title: '', parent: undefined };
    const empty = { type: 'describe', title: '', parent: root, _parallelMode: 'parallel', _annotations: [] };
    const named = { type: 'describe', title: 'Named', parent: empty, _parallelMode: 'serial', _annotations: [] };
    const test = { parent: named } as any;
    const info = mc.getSuiteInfo(test);
    expect(info.suitePath).toEqual(['Named']);
  });

  it('returns empty arrays when the test has no describe parents', () => {
    const mc = new MetadataCollector();
    const root = { type: 'project', title: '', parent: undefined };
    const test = { parent: root } as any;
    const info = mc.getSuiteInfo(test);
    expect(info.suitePath).toEqual([]);
    expect(info.suiteConfig).toEqual([]);
  });
});

describe('MetadataCollector.getBrowserConfig', () => {
  it('walks up to find a project() and returns a browser config', () => {
    const mc = new MetadataCollector();
    const project = { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } };
    const suite = { parent: { project: () => project } };
    const test = { parent: suite } as any;
    const cfg = mc.getBrowserConfig(test);
    expect(cfg?.projectName).toBe('chromium');
    expect(cfg?.browserName).toBe('chromium');
    expect(cfg?.viewport).toEqual({ width: 1280, height: 720 });
  });

  it('returns null when no project() is found within the depth limit', () => {
    const mc = new MetadataCollector();
    const test = { parent: { parent: { parent: undefined } } } as any;
    expect(mc.getBrowserConfig(test)).toBe(null);
  });
});

describe('MetadataCollector.collect — CI provider detection', () => {
  beforeEach(() => {
    for (const k of CI_ENV_KEYS) SAVED_CI_ENV[k] = process.env[k];
    for (const k of CI_ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of CI_ENV_KEYS) {
      if (SAVED_CI_ENV[k] === undefined) delete process.env[k];
      else process.env[k] = SAVED_CI_ENV[k];
    }
  });

  function collectCi(): Record<string, unknown> | undefined {
    const mc = new MetadataCollector();
    const metadata = mc.collect(fakeConfig(), undefined as any, { collectCiInfo: true });
    return metadata.ci as Record<string, unknown> | undefined;
  }

  it('omits metadata.ci entirely outside of any known CI', () => {
    expect(collectCi()).toBeUndefined();
  });

  it('detects GitHub Actions and builds the run URL', () => {
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_RUN_ID = '123';
    process.env.GITHUB_REPOSITORY = 'acme/widgets';
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    const ci = collectCi();
    expect(ci?.provider).toBe('GitHub Actions');
    expect(ci?.buildUrl).toBe('https://github.com/acme/widgets/actions/runs/123');
  });

  it('detects GitLab CI', () => {
    process.env.GITLAB_CI = 'true';
    process.env.CI_PIPELINE_ID = '456';
    process.env.CI_JOB_NAME = 'test';
    const ci = collectCi();
    expect(ci?.provider).toBe('GitLab CI');
    expect(ci?.pipelineId).toBe('456');
    expect(ci?.jobName).toBe('test');
  });

  it('detects CircleCI, Travis CI, and Azure Pipelines', () => {
    process.env.CIRCLECI = 'true';
    expect(collectCi()?.provider).toBe('CircleCI');
    delete process.env.CIRCLECI;

    process.env.TRAVIS = 'true';
    expect(collectCi()?.provider).toBe('Travis CI');
    delete process.env.TRAVIS;

    process.env.TF_BUILD = 'true';
    expect(collectCi()?.provider).toBe('Azure Pipelines');
  });

  it('falls back to "Unknown CI" when only the generic CI var is set', () => {
    process.env.CI = 'true';
    const ci = collectCi();
    expect(ci?.provider).toBe('Unknown CI');
    expect(ci?.detected).toBe(true);
  });

  it('prioritizes Jenkins over other providers when multiple env vars are set', () => {
    process.env.JENKINS_URL = 'https://ci.example.com';
    process.env.GITHUB_ACTIONS = 'true';
    process.env.CI = 'true';
    expect(collectCi()?.provider).toBe('Jenkins');
  });

  it('does not collect CI info when collectCiInfo is false', () => {
    process.env.GITHUB_ACTIONS = 'true';
    const mc = new MetadataCollector();
    const metadata = mc.collect(fakeConfig(), undefined as any, { collectCiInfo: false });
    expect(metadata.ci).toBeUndefined();
  });
});

describe('MetadataCollector.collect — passthrough options and config metadata', () => {
  it('copies projectDescription/relatedIssue/ciInfo/tags/customData into metadata', () => {
    const mc = new MetadataCollector();
    const metadata = mc.collect(fakeConfig(), undefined as any, {
      projectDescription: 'desc',
      relatedIssue: 'JIRA-1',
      ciInfo: 'custom ci blurb',
      tags: ['smoke'],
      customData: { team: 'checkout' },
    });
    expect(metadata.projectDescription).toBe('desc');
    expect(metadata.relatedIssue).toBe('JIRA-1');
    expect(metadata.ciInfo).toBe('custom ci blurb');
    expect(metadata.tags).toEqual(['smoke']);
    expect(metadata.customData).toEqual({ team: 'checkout' });
  });

  it('extracts project/workers/timeout config into metadata.htmlReport', () => {
    const mc = new MetadataCollector();
    const config = {
      projects: [{ name: 'chromium', testDir: 'tests', use: { browserName: 'chromium' } }],
      workers: 4,
      globalTimeout: 60_000,
      fullyParallel: true,
    } as unknown as FullConfig;
    const metadata = mc.collect(config, undefined as any, {});
    expect(metadata.htmlReport).toMatchObject({ workers: 4, timeout: 60_000, fullyParallel: true });
    expect((metadata.htmlReport as any).projects[0]).toMatchObject({ name: 'chromium', testDir: 'tests' });
  });

  it('copies config.metadata through as playwrightConfig', () => {
    const mc = new MetadataCollector();
    const config = { ...fakeConfig(), metadata: { custom: true } } as unknown as FullConfig;
    const metadata = mc.collect(config, undefined as any, {});
    expect(metadata.playwrightConfig).toEqual({ custom: true });
  });
});
