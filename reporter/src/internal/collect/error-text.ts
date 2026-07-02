import * as path from 'node:path';
import type { TestResult } from '@playwright/test/reporter';

/**
 * Build the stored error text for a test result.
 *
 * Playwright's `result.error` carries the primary failure but for a **timeout**
 * it is only the bare `Test timeout of 30000ms exceeded.` — the interrupted
 * action's actual error (with its call log — the single most diagnostic fact)
 * lives in `result.errors[1..]`. Concatenating all errors (deduped by message)
 * ensures the server sees the call log so it can extract the locator, fingerprint
 * correctly, and feed the model the right facts.
 *
 * A synthetic `at file:line:col` frame from `error.location` is appended when
 * no stack frame is present, enabling locator-healing to find the pre-captured
 * snapshot for that call site. The frame sits after the message, where
 * `extractMessageHead` trims it before fingerprinting — so clustering is
 * unaffected.
 */
export function buildErrorText(result: TestResult): string | null {
  if (!result.errors || result.errors.length === 0) return null;

  const seen = new Set<string>();
  const parts: string[] = [];

  for (const err of result.errors) {
    const msg = err.message ?? '';
    if (!msg) continue;
    const dedupeKey = msg.trim().slice(0, 200);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    parts.push(msg);
  }

  let text = parts.join('\n---\n');
  if (!text) return null;

  const primary = result.error;
  const loc = primary?.location;
  if (loc?.file && !/\n\s+at\s/.test(text)) {
    const rel = path.relative(process.cwd(), loc.file).split(path.sep).join('/');
    text += `\n    at ${rel}:${loc.line}:${loc.column}`;
  }
  return text;
}
