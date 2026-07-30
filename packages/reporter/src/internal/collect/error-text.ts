import * as path from 'node:path';
import type { TestResult } from '@playwright/test/reporter';
import { joinErrorMessages, appendErrorLocation } from '@piwitests/core/error-text';

/**
 * Build the stored error text for a test result: every error message deduped
 * and joined, plus a synthetic `at file:line:col` frame when the text carries
 * no stack frame. The assembly rules live in `@piwitests/core/error-text` so
 * imported blob reports produce byte-identical text; only the cwd-relative path
 * resolution is reporter-specific.
 */
export function buildErrorText(result: TestResult): string | null {
  const text = joinErrorMessages(result.errors);
  if (!text) return null;

  const loc = result.error?.location;
  if (!loc?.file) return text;

  const rel = path.relative(process.cwd(), loc.file).split(path.sep).join('/');
  return appendErrorLocation(text, { file: rel, line: loc.line, column: loc.column });
}
