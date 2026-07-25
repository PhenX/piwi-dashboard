import { test, expect } from './fixtures';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'node:crypto';
import { join } from 'path';
import { PROJECT } from '#shared/test-project-names';
import { buildBlobReport, errorContextMarkdown } from './utils/blob-report-fixture';

/**
 * End-to-end cover for importing historical blob reports: the pre-flight that
 * spares the user a doomed upload, the import itself, and the page that drives
 * both.
 */
test.describe('Blob report import', () => {
  test.describe.configure({ mode: 'serial' });

  const tempDir = join(process.cwd(), '.test-temp');
  const archivePath = join(tempDir, 'import-report-a.zip');
  const secondArchivePath = join(tempDir, 'import-report-b.zip');

  /** Bytes of the primary archive, reused for the duplicate assertions. */
  let archive: Buffer;

  test.beforeAll(() => {
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    archive = buildBlobReport({
      runStatus: 'failed',
      rootDir: '/repo/tests',
      configFile: '../playwright.config.ts',
      file: 'checkout.spec.ts',
      tests: [
        {
          testId: 'import-pass',
          title: 'completes the checkout',
          suitePath: ['checkout'],
          attempts: [{ status: 'passed', duration: 120 }],
        },
        {
          testId: 'import-fail',
          title: 'shows a payment error',
          suitePath: ['checkout'],
          line: 14,
          attempts: [
            {
              status: 'failed',
              duration: 900,
              errorMessage: "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button')",
              attachments: [
                {
                  name: 'error-context',
                  contentType: 'text/markdown',
                  body: errorContextMarkdown({
                    snapshot: '- heading "Checkout" [level=1]',
                    source: [
                      [13, "  test('shows a payment error', async ({ page }) => {"],
                      [14, "    await expect(page.getByRole('button')).toBeVisible();"],
                    ],
                  }),
                },
                { name: 'screenshot', contentType: 'image/png', body: 'not-really-a-png' },
              ],
            },
          ],
        },
      ],
    });
    writeFileSync(archivePath, archive);

    // A second, distinct archive so the UI has something to actually import.
    writeFileSync(
      secondArchivePath,
      buildBlobReport({
        startTime: 1_700_000_500_000,
        file: 'search.spec.ts',
        tests: [{ testId: 'import-search', title: 'finds a product', attempts: [{ status: 'passed', duration: 42 }] }],
      }),
    );
  });

  test('pre-flight judges archives before any upload', async ({ request }) => {
    const response = await request.post('/api/test-runs/import/check', {
      data: {
        projectName: PROJECT.IMPORT_BLOB,
        files: [
          { name: 'ok.zip', size: archive.length, hash: 'a'.repeat(64) },
          { name: 'huge.zip', size: 10 * 1024 * 1024 * 1024, hash: 'b'.repeat(64) },
          { name: 'notes.txt', size: 100, hash: 'c'.repeat(64) },
          { name: 'empty.zip', size: 0, hash: 'd'.repeat(64) },
          { name: 'no-hash.zip', size: 100, hash: 'nope' },
        ],
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.maxBytes).toBeGreaterThan(0);
    expect(body.results.map((r: { status: string }) => r.status)).toEqual([
      'ok',
      'too-large',
      'invalid',
      'invalid',
      'invalid',
    ]);
    expect(body.results[1].message).toContain('exceeds');
  });

  test('imports a run with its cases, evidence and files', async ({ request }) => {
    const response = await request.post('/api/test-runs/import', {
      multipart: {
        projectName: PROJECT.IMPORT_BLOB,
        archive: { name: 'report-a.zip', mimeType: 'application/zip', buffer: archive },
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.status).toBe('imported');
    expect(body.runStatus).toBe('failed');
    expect(body.totalTests).toBe(2);
    expect(body.passedTests).toBe(1);
    expect(body.failedTests).toBe(1);
    expect(body.attachmentCount).toBe(2);
    // Recorded relative to the config directory, matching live reporter runs.
    expect(body.filePaths).toEqual(['tests/checkout.spec.ts']);

    const runResponse = await request.get(`/api/test-runs/${body.testRunId}`);
    expect(runResponse.status()).toBe(200);
    const run = await runResponse.json();

    const failing = run.testCases.find((c: { title: string }) => c.title === 'shows a payment error');
    expect(failing).toBeTruthy();
    expect(failing.status).toBe('failed');
    // Imported failures cluster exactly like reported ones.
    expect(failing.failureClusterId).toBeTruthy();

    // Evidence recovered from Playwright's own error-context attachment, read
    // back from the execution detail where the dashboard renders it.
    const caseResponse = await request.get(`/api/test-run-cases/${failing.id}`);
    expect(caseResponse.status()).toBe(200);
    const execution = await caseResponse.json();
    expect(execution.ariaSnapshot).toContain('heading "Checkout"');
    expect(execution.testSource).toContain('>   14 |');
  });

  test('re-importing the same archive changes nothing', async ({ request }) => {
    const first = await request.post('/api/test-runs/import', {
      multipart: {
        projectName: PROJECT.IMPORT_BLOB,
        archive: { name: 'report-a.zip', mimeType: 'application/zip', buffer: archive },
      },
    });
    const body = await first.json();
    expect(body.status).toBe('duplicate');

    // And the pre-flight now recognises it without an upload.
    const check = await request.post('/api/test-runs/import/check', {
      data: {
        projectName: PROJECT.IMPORT_BLOB,
        files: [{ name: 'report-a.zip', size: archive.length, hash: sha256(archive) }],
      },
    });
    const checkBody = await check.json();
    expect(checkBody.results[0].status).toBe('duplicate');
    expect(checkBody.results[0].testRunId).toBe(body.testRunId);
  });

  test('rejects something that is not a blob report with a usable message', async ({ request }) => {
    const response = await request.post('/api/test-runs/import', {
      multipart: {
        projectName: PROJECT.IMPORT_BLOB,
        archive: { name: 'bogus.zip', mimeType: 'application/zip', buffer: Buffer.from('definitely not a zip') },
      },
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).message).toMatch(/ZIP|report\.jsonl/i);
  });

  test('imports through the project page', async ({ page, request }) => {
    // Create the project first so the page has one to navigate to.
    const seed = await request.post('/api/test-runs/import', {
      multipart: {
        projectName: PROJECT.IMPORT_BLOB_UI,
        archive: { name: 'seed.zip', mimeType: 'application/zip', buffer: archive },
      },
    });
    const projectId = (await seed.json()).projectId;

    await page.goto(`/projects/${projectId}/import`);
    // The limit line renders after mount, so its presence means the page has
    // hydrated and the file input's handler is live. Generous timeout: the dev
    // server compiles this route on first request, well past the default wait.
    await expect(page.getByText(/Up to .* per archive/)).toBeVisible({ timeout: 30000 });

    // The already-imported archive and a new one, together.
    await page.locator('input[type=file]').setInputFiles([archivePath, secondArchivePath]);

    await expect(page.getByText('Already imported into this project.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import 1 archive$/ })).toBeEnabled();

    await page.getByRole('button', { name: /^Import 1 archive$/ }).click();

    // `exact` matters: "Already imported" also contains "Imported".
    await expect(page.getByText('Imported', { exact: true })).toBeVisible({ timeout: 30000 });
    // The summary names the spec path so the user can confirm history lines up.
    await expect(page.getByText('search.spec.ts')).toBeVisible();
    // The duplicate stayed a duplicate — it was never re-imported.
    await expect(page.getByText('Already imported', { exact: true })).toBeVisible();
  });

  test('settles an oversized file in the browser, without uploading it', async ({ page, request }) => {
    const seed = await request.post('/api/test-runs/import', {
      multipart: {
        projectName: PROJECT.IMPORT_BLOB_UI,
        archive: { name: 'seed.zip', mimeType: 'application/zip', buffer: archive },
      },
    });
    const projectId = (await seed.json()).projectId;

    await page.goto(`/projects/${projectId}/import`);
    await expect(page.getByText(/Up to .* per archive/)).toBeVisible({ timeout: 30000 });

    // Anything the server would refuse is refused here instead — no request.
    let importRequests = 0;
    page.on('request', (req) => {
      if (req.url().endsWith('/api/test-runs/import')) importRequests++;
    });

    await page
      .locator('input[type=file]')
      .setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('nope') }]);

    await expect(page.getByText('Not importable')).toBeVisible();
    await expect(page.getByText('Expected a .zip blob report', { exact: false })).toBeVisible();
    expect(importRequests).toBe(0);
  });
});

/** Hex SHA-256, matching what the server derives from the uploaded bytes. */
function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
