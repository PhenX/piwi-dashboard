import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseGateArgs, runGate } from '../src/cli/gate.js';

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-gate-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeOutputFile(contents: unknown): string {
  const file = path.join(tmpDir, 'piwi-run.json');
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return file;
}

describe('parseGateArgs', () => {
  it('reads the server URL and run id from flags', () => {
    const args = parseGateArgs(
      ['--server-url', 'https://piwi.example.com', '--run-id', '42', '--max-failed', '0'],
      EMPTY_ENV,
    );
    expect(args.serverUrl).toBe('https://piwi.example.com');
    expect(args.runId).toBe(42);
  });

  it('accepts the --flag=value form', () => {
    const args = parseGateArgs(['--server-url=https://piwi.example.com', '--run-id=7'], EMPTY_ENV);
    expect(args.serverUrl).toBe('https://piwi.example.com');
    expect(args.runId).toBe(7);
  });

  it('strips a trailing slash so the request path is not doubled', () => {
    const args = parseGateArgs(['--server-url', 'https://piwi.example.com/', '--run-id', '1'], EMPTY_ENV);
    expect(args.serverUrl).toBe('https://piwi.example.com');
  });

  it('falls back to the environment for the URL and API key', () => {
    const args = parseGateArgs(['--run-id', '3'], {
      PIWI_DASHBOARD_URL: 'https://env.example.com',
      PIWI_API_KEY: 'secret',
    } as NodeJS.ProcessEnv);
    expect(args.serverUrl).toBe('https://env.example.com');
    expect(args.apiKey).toBe('secret');
  });

  it('a flag beats the environment', () => {
    const args = parseGateArgs(['--server-url', 'https://flag.example.com', '--run-id', '3'], {
      PIWI_DASHBOARD_URL: 'https://env.example.com',
    } as NodeJS.ProcessEnv);
    expect(args.serverUrl).toBe('https://flag.example.com');
  });

  it('reads the run id from the file the reporter wrote', () => {
    const file = writeOutputFile({ runId: 99, runUrl: 'https://piwi.example.com/test-runs/99' });
    const args = parseGateArgs(['--server-url', 'https://x.example.com', '--from-file', file], EMPTY_ENV);
    expect(args.runId).toBe(99);
  });

  it('reads the run id from PIWI_OUTPUT_FILE', () => {
    const file = writeOutputFile({ runId: 12 });
    const args = parseGateArgs(['--server-url', 'https://x.example.com'], {
      PIWI_OUTPUT_FILE: file,
    } as NodeJS.ProcessEnv);
    expect(args.runId).toBe(12);
  });

  it('normalizes required tags, with or without the @', () => {
    const args = parseGateArgs(
      ['--server-url', 'https://x.example.com', '--run-id', '1', '--require-tag', '@critical, smoke'],
      EMPTY_ENV,
    );
    expect(args.policy.requireTags).toEqual(['critical', 'smoke']);
  });

  it('collects the threshold rules', () => {
    const args = parseGateArgs(
      [
        '--server-url',
        'https://x.example.com',
        '--run-id',
        '1',
        '--max-failed',
        '3',
        '--max-new-regressions',
        '0',
        '--max-new-flaky',
        '2',
        '--fail-on-new-cluster',
      ],
      EMPTY_ENV,
    );
    expect(args.policy).toMatchObject({
      maxFailed: 3,
      maxNewRegressions: 0,
      maxNewFlaky: 2,
      failOnNewCluster: true,
    });
  });

  it('leaves an unset threshold undefined rather than defaulting it to zero', () => {
    const args = parseGateArgs(['--server-url', 'https://x.example.com', '--run-id', '1'], EMPTY_ENV);
    expect(args.policy.maxFailed).toBeUndefined();
    expect(args.policy.failOnNewCluster).toBe(false);
  });

  it('rejects a negative or non-numeric threshold', () => {
    const base = ['--server-url', 'https://x.example.com', '--run-id', '1'];
    expect(() => parseGateArgs([...base, '--max-failed', '-1'], EMPTY_ENV)).toThrow(/non-negative/);
    expect(() => parseGateArgs([...base, '--max-failed', 'lots'], EMPTY_ENV)).toThrow(/non-negative/);
  });

  it('refuses to run without a dashboard URL', () => {
    expect(() => parseGateArgs(['--run-id', '1'], EMPTY_ENV)).toThrow(/No dashboard URL/);
  });

  it('refuses to run when no run can be resolved', () => {
    expect(() => parseGateArgs(['--server-url', 'https://x.example.com'], EMPTY_ENV)).toThrow(/No run to evaluate/);
  });

  it('ignores an output file that is missing, malformed or has no run id', () => {
    const cases = [
      path.join(tmpDir, 'absent.json'),
      writeOutputFile('{not json'),
      writeOutputFile({ runUrl: 'https://x/1' }),
      writeOutputFile({ runId: 0 }),
    ];
    for (const file of cases) {
      expect(() => parseGateArgs(['--server-url', 'https://x.example.com', '--from-file', file], EMPTY_ENV)).toThrow(
        /No run to evaluate/,
      );
    }
  });
});

describe('runGate exit codes', () => {
  // The contract CI depends on: a gate that cannot be evaluated must never
  // report success, or a misconfigured pipeline waves every merge through.
  it('exits 2 when the arguments are unusable', async () => {
    expect(await runGate(['--run-id', '1'], EMPTY_ENV)).toBe(2);
  });

  it('exits 2 when the dashboard cannot be reached', async () => {
    const code = await runGate(
      // Port 0 is never listening, so this fails without touching the network.
      ['--server-url', 'http://127.0.0.1:1', '--run-id', '1', '--max-failed', '0'],
      EMPTY_ENV,
    );
    expect(code).toBe(2);
  });

  it('exits 0 for --help', async () => {
    expect(await runGate(['--help'], EMPTY_ENV)).toBe(0);
  });
});
