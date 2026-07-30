import { describe, test, expect } from 'vitest';
import {
  scoreChangedFile,
  representativeExecutionSections,
  extractPageSnapshotSection,
  extractLocatorLiterals,
  findLiteralInPatch,
  resolveImportPath,
  candidateFilePaths,
} from '../../server/utils/ai-context';
import type { ContextLimits } from '#shared/ai-context-limits';

// Minimal limits object — large enough that nothing truncates in these tests.
const limits = {
  sampleErrorChars: 10000,
  testSourceChars: 10000,
  steps: 50,
  maxConsoleWindow: 50,
  consoleEntryChars: 500,
  networkRequests: 20,
  slowRequestMs: 2000,
  serverLogEntries: 20,
  serverLogEntryChars: 500,
  serverTraceSpans: 40,
  ariaSnapshotChars: 4000,
} as unknown as ContextLimits;

/** Build a representative-execution row with only the fields under test. */
function makeRep(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    testRunId: 42,
    error: null,
    browser: null,
    retries: 0,
    duration: 1000,
    line: 10,
    column: 5,
    steps: null,
    consoleLogs: null,
    ariaSnapshot: null,
    testSource: null,
    webVitals: null,
    testAnnotations: null,
    workerIndex: 0,
    shardIndex: null,
    testCaseId: 7,
    browserName: 'chromium',
    testTitle: 'my test',
    testFilePath: 'tests/checkout.spec.ts',
    testSuitePath: null,
    flakyRootCause: null,
    nrItems: [],
    runEnvironment: null,
    runMetadata: null,
    runIsFullRun: null,
    runFilterDetails: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('representativeExecutionSections — id alignment (Tier 0.2)', () => {
  test('a rep with no error and no source still labels steps/console by their real ids', () => {
    const rep = makeRep({
      error: null,
      testSource: null,
      steps: [{ category: 'test.step', title: 'click Pay', duration: 200 }],
      consoleLogs: [{ type: 'error', text: 'boom' }],
    });

    const sections = representativeExecutionSections(rep, null, limits);
    const byId = new Map(sections.map((s) => [s.id, s.markdown]));

    // Header is always present.
    expect(byId.get('representativeExecution')).toContain('Representative Execution');
    // No error/source were provided, so those ids must be absent (not shifted onto others).
    expect(byId.has('executionError')).toBe(false);
    expect(byId.has('testSource')).toBe(false);
    // Steps and console keep their own ids regardless of the missing earlier sections.
    expect(byId.get('steps')).toContain('click Pay');
    expect(byId.get('console')).toContain('boom');
  });

  test('execution error is included when there is no cluster to dedupe against', () => {
    const rep = makeRep({ error: 'Error: something failed' });
    const sections = representativeExecutionSections(rep, null, limits);
    const err = sections.find((s) => s.id === 'executionError');
    expect(err?.markdown).toContain('something failed');
  });

  test('server traces section renders the per-request span tree from serverTraces', () => {
    const rep = makeRep({
      nrItems: [
        {
          method: 'POST',
          url: '/api/checkout',
          status: 500,
          serverTraces: [
            { id: 'r1', name: 'POST /api/checkout', kind: 'server', startMs: 1000, durMs: 120, status: 'error' },
            { id: 'c1', parentId: 'r1', name: 'SELECT orders', kind: 'db', startMs: 1010, durMs: 90 },
          ],
        },
      ],
    });
    const sections = representativeExecutionSections(rep, null, limits);
    const traces = sections.find((s) => s.id === 'serverTraces');
    expect(traces?.markdown).toContain('Server Traces');
    // Root span first, error flagged, child span indented under it.
    expect(traces?.markdown).toContain('- [server] POST /api/checkout (120ms) [error]');
    expect(traces?.markdown).toContain('  - [db] SELECT orders (90ms)');
  });

  test('server traces section is omitted when the budget is zero', () => {
    const rep = makeRep({
      nrItems: [
        { method: 'GET', url: '/', status: 200, serverTraces: [{ id: 'r1', name: 'GET /', startMs: 0, durMs: 5 }] },
      ],
    });
    const sections = representativeExecutionSections(rep, null, { ...limits, serverTraceSpans: 0 });
    expect(sections.find((s) => s.id === 'serverTraces')).toBeUndefined();
  });
});

describe('scoreChangedFile — generic relevance (Tier 0.5)', () => {
  test('scores an imported file highest', () => {
    const testSource = "import { CheckoutPage } from '../pages/CheckoutPage';\ntest('x', () => {});";
    const imported = scoreChangedFile('src/pages/CheckoutPage.ts', { testSource });
    const unrelated = scoreChangedFile('src/util/formatDate.ts', { testSource });
    expect(imported).toBeGreaterThan(unrelated);
  });

  test('exact test-file match scores high without any Piwi-specific paths', () => {
    const score = scoreChangedFile('tests/checkout.spec.ts', { testFilePath: 'tests/checkout.spec.ts' });
    expect(score).toBeGreaterThanOrEqual(4);
  });

  test('token overlap with the test title contributes', () => {
    const score = scoreChangedFile('src/CheckoutButton.tsx', { testTitle: 'checkout button is disabled' });
    expect(score).toBeGreaterThan(0);
  });

  test('config/lockfiles are penalised relative to source', () => {
    const lock = scoreChangedFile('package-lock.json', {});
    const src = scoreChangedFile('src/app/main.ts', {});
    expect(src).toBeGreaterThan(lock);
  });
});

describe('extractPageSnapshotSection — Playwright error-context parsing (0.5.4a)', () => {
  test('extracts the yaml fence under the h1 heading Playwright ≥ 1.53 writes', () => {
    const md = [
      '# Test info',
      '',
      '- Name: pressing Escape cancels label edit',
      '',
      '# Error details',
      '',
      '```',
      'TimeoutError: locator.click: Timeout 30000ms exceeded.',
      '```',
      '',
      '# Page snapshot',
      '',
      '```yaml',
      '- banner [ref=e2]:',
      '  - heading "Run trend" [level=2] [ref=e14]',
      '```',
    ].join('\n');
    expect(extractPageSnapshotSection(md)).toBe('- banner [ref=e2]:\n  - heading "Run trend" [level=2] [ref=e14]');
  });

  test('tolerates an h2 heading and stops at the next section', () => {
    const md = '## Page snapshot\n\n```yaml\n- link "Home"\n```\n\n## Next section\ntext';
    expect(extractPageSnapshotSection(md)).toBe('- link "Home"');
  });

  test('returns null when there is no snapshot section', () => {
    expect(extractPageSnapshotSection('# Error details\nboom')).toBeNull();
  });
});

describe('locator-literal SCM matching (diff-content relevance)', () => {
  const timeoutError = [
    'Test timeout of 30000ms exceeded.',
    '---',
    'locator.click: Test timeout of 30000ms exceeded.',
    'Call log:',
    "  - waiting for locator('h2').getByTitle('Add a label')",
    '',
    '    at tests/labels.spec.ts:42:7',
  ].join('\n');

  test('pulls the locator string literals out of a call log', () => {
    const lits = extractLocatorLiterals(timeoutError);
    expect(lits).toContain('Add a label');
    // Short CSS selector args (< 3 chars) are noise and filtered out.
    expect(lits).not.toContain('h2');
  });

  test('getByRole name option is extracted', () => {
    const lits = extractLocatorLiterals("expect(page.getByRole('button', { name: 'Pay now' })).toBeVisible()");
    expect(lits).toContain('Pay now');
  });

  test('a removed patch line containing the literal beats an added-line hit elsewhere in the patch', () => {
    const patch = [
      '--- a/app/pages/index.vue',
      '+++ b/app/pages/index.vue',
      '@@ -640,7 +640,7 @@',
      '-      subtitle="Add a label to organize runs"',
      '+      subtitle="Tag your runs"',
    ].join('\n');
    expect(findLiteralInPatch(patch, ['Add a label'])).toEqual({ literal: 'Add a label', removed: true });
  });

  test('an added-only hit is reported as non-removed; no hit yields null', () => {
    expect(findLiteralInPatch('+ <h2 title="Add a label">…</h2>', ['Add a label'])).toEqual({
      literal: 'Add a label',
      removed: false,
    });
    expect(findLiteralInPatch('+ unrelated', ['Add a label'])).toBeNull();
  });

  test('a patch hit outranks filename-only signals in scoring', () => {
    const signals = { testTitle: 'labels can be edited' };
    const withHit = scoreChangedFile('app/pages/whatever.vue', signals, { literal: 'Add a label', removed: true });
    const pathOnly = scoreChangedFile('app/pages/labels-editor.vue', signals);
    expect(withHit).toBeGreaterThan(pathOnly);
  });
});

describe('resolveImportPath', () => {
  test('resolves a sibling import', () => {
    expect(resolveImportPath('tests/login.spec.ts', './helpers')).toBe('tests/helpers');
  });
  test('resolves a parent-dir import', () => {
    expect(resolveImportPath('tests/e2e/login.spec.ts', '../pages/LoginPage')).toBe('tests/pages/LoginPage');
  });
  test('collapses redundant segments', () => {
    expect(resolveImportPath('a/b/c.spec.ts', './../b/./x')).toBe('a/b/x');
  });
});

describe('candidateFilePaths', () => {
  test('returns the path as-is when it already has a code extension', () => {
    expect(candidateFilePaths('tests/helpers.ts')).toEqual(['tests/helpers.ts']);
  });
  test('expands an extension-less path to ts/tsx/... and index files', () => {
    const c = candidateFilePaths('tests/pages/LoginPage');
    expect(c).toContain('tests/pages/LoginPage.ts');
    expect(c).toContain('tests/pages/LoginPage.tsx');
    expect(c).toContain('tests/pages/LoginPage/index.ts');
  });
});
