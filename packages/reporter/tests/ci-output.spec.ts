import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { emitRunOutputs, ciBuildUrlFromMetadata, type RunOutput } from '../src/internal/support/ci-output.js';
import { Logger } from '../src/internal/support/logger.js';

const OUTPUT: RunOutput = {
  runUrl: 'https://dash.example.com/test-runs/42',
  runId: 42,
  projectId: 7,
  projectName: 'checkout',
  status: 'passed',
  ciBuildUrl: 'https://ci.example.com/build/9',
};

let tmpDir: string;
const silentLogger = new Logger(false);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-ci-output-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('emitRunOutputs — universal output file', () => {
  it('writes a JSON file with the run identity when outputFile is set', () => {
    const file = path.join(tmpDir, 'nested', 'piwi-run.json');
    emitRunOutputs(OUTPUT, silentLogger, file, {});
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed).toEqual({
      runUrl: OUTPUT.runUrl,
      runId: 42,
      projectId: 7,
      projectName: 'checkout',
      status: 'passed',
      ciBuildUrl: 'https://ci.example.com/build/9',
    });
  });

  it('does not write a file when outputFile is not set', () => {
    emitRunOutputs(OUTPUT, silentLogger, undefined, {});
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('never throws when the output file path is unwritable', () => {
    const badPath = path.join(tmpDir, 'a-file');
    fs.writeFileSync(badPath, 'x');
    // Treating an existing file as a directory parent must be swallowed.
    expect(() => emitRunOutputs(OUTPUT, silentLogger, path.join(badPath, 'child.json'), {})).not.toThrow();
  });
});

describe('emitRunOutputs — GitHub Actions', () => {
  it('appends step outputs and a job-summary link, and prints an annotation', () => {
    const outputFile = path.join(tmpDir, 'gh-output');
    const summaryFile = path.join(tmpDir, 'gh-summary');
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    emitRunOutputs(OUTPUT, silentLogger, undefined, {
      GITHUB_ACTIONS: 'true',
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    });

    const outputs = fs.readFileSync(outputFile, 'utf8');
    expect(outputs).toContain('piwi_run_url=https://dash.example.com/test-runs/42');
    expect(outputs).toContain('piwi_run_id=42');
    expect(outputs).toContain('piwi_run_status=passed');
    expect(outputs).toContain('piwi_project_id=7');

    const summary = fs.readFileSync(summaryFile, 'utf8');
    expect(summary).toContain('[View run](https://dash.example.com/test-runs/42)');
    expect(summary).toContain('**passed**');

    expect(stdout).toHaveBeenCalledWith('::notice title=Piwi test run::https://dash.example.com/test-runs/42\n');
  });

  it('still prints the annotation when GITHUB_OUTPUT/SUMMARY files are absent', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    emitRunOutputs(OUTPUT, silentLogger, undefined, { GITHUB_ACTIONS: 'true' });
    expect(stdout).toHaveBeenCalledWith('::notice title=Piwi test run::https://dash.example.com/test-runs/42\n');
  });
});

describe('emitRunOutputs — GitLab CI', () => {
  it('writes a dotenv report at the default path', () => {
    const cwd = process.cwd();
    process.chdir(tmpDir);
    try {
      emitRunOutputs(OUTPUT, silentLogger, undefined, { GITLAB_CI: 'true' });
      const dotenv = fs.readFileSync(path.join(tmpDir, 'piwi.env'), 'utf8');
      expect(dotenv).toContain('PIWI_RUN_URL=https://dash.example.com/test-runs/42');
      expect(dotenv).toContain('PIWI_RUN_ID=42');
      expect(dotenv).toContain('PIWI_RUN_STATUS=passed');
      expect(dotenv).toContain('PIWI_PROJECT_ID=7');
      expect(dotenv).toContain('PIWI_CI_BUILD_URL=https://ci.example.com/build/9');
    } finally {
      process.chdir(cwd);
    }
  });

  it('honors PIWI_DOTENV_FILE for the dotenv path', () => {
    const file = path.join(tmpDir, 'custom.env');
    emitRunOutputs(OUTPUT, silentLogger, undefined, { GITLAB_CI: 'true', PIWI_DOTENV_FILE: file });
    expect(fs.readFileSync(file, 'utf8')).toContain('PIWI_RUN_URL=https://dash.example.com/test-runs/42');
  });
});

describe('ciBuildUrlFromMetadata', () => {
  it('prefers buildUrl, then pipelineUrl, then jobUrl', () => {
    expect(ciBuildUrlFromMetadata({ ci: { buildUrl: 'b', pipelineUrl: 'p', jobUrl: 'j' } })).toBe('b');
    expect(ciBuildUrlFromMetadata({ ci: { pipelineUrl: 'p', jobUrl: 'j' } })).toBe('p');
    expect(ciBuildUrlFromMetadata({ ci: { jobUrl: 'j' } })).toBe('j');
  });

  it('returns undefined when there is no CI metadata', () => {
    expect(ciBuildUrlFromMetadata(undefined)).toBeUndefined();
    expect(ciBuildUrlFromMetadata({})).toBeUndefined();
    expect(ciBuildUrlFromMetadata({ ci: {} })).toBeUndefined();
  });
});
