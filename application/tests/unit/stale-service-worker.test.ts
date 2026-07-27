import { describe, test, expect } from 'vitest';
import { isStrayRootWorker } from '../../app/utils/stale-service-worker';

const ORIGIN = 'http://127.0.0.1:3000';

describe('isStrayRootWorker', () => {
  test('matches the stray root Workbox worker (/sw.js at the app root)', () => {
    expect(isStrayRootWorker(`${ORIGIN}/sw.js`, `${ORIGIN}/`)).toBe(true);
  });

  test('matches the root worker under a based deployment', () => {
    expect(isStrayRootWorker(`${ORIGIN}/dashboard/sw.js`, `${ORIGIN}/dashboard/`)).toBe(true);
  });

  test('never matches the Playwright trace-viewer worker', () => {
    expect(isStrayRootWorker(`${ORIGIN}/trace-viewer/sw.bundle.js`, `${ORIGIN}/trace-viewer/`)).toBe(false);
    // Belt-and-suspenders: even a trace-viewer worker literally named sw.js is spared.
    expect(isStrayRootWorker(`${ORIGIN}/trace-viewer/sw.js`, `${ORIGIN}/trace-viewer/`)).toBe(false);
  });

  test('does not match other workers or malformed input', () => {
    expect(isStrayRootWorker(`${ORIGIN}/service-worker.js`, `${ORIGIN}/`)).toBe(false);
    expect(isStrayRootWorker('', '')).toBe(false);
  });
});
