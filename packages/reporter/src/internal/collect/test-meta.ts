/**
 * Read a test's declared tags and `piwi:` ownership metadata off Playwright's
 * `TestCase` / `TestResult`.
 *
 * Both normalizers live in `@piwitests/core` so the server can re-run them on
 * ingest; this module is only the Playwright-shaped adapter around them.
 */
import { normalizeTestTags, parseTestMetadata, type TestMetadata } from '@piwitests/core/test-meta';
import type { TestAnnotation } from '../../types.js';

/** The slice of `TestCase` this module reads. */
interface TaggedTestCase {
  /**
   * Playwright folds `@tag` tokens in the title and the `{ tag: [...] }` test
   * option into one array. Optional here because a `TestCase` from an older
   * Playwright than the peer range can reach the reporter through a
   * hand-rolled harness.
   */
  tags?: readonly string[];
}

/** Tags declared on a test, normalized for storage. Empty array when none. */
export function collectTestTags(test: TaggedTestCase): string[] {
  return normalizeTestTags(test.tags);
}

/**
 * Ownership metadata declared via `piwi:` annotations, or `null` when the test
 * declared none. Takes the already-merged annotation list (`mergeAnnotations`)
 * so a `testInfo.annotations.push()` at runtime counts the same as a static
 * `{ annotation: … }` on the test.
 */
export function collectTestMetadata(annotations: TestAnnotation[]): TestMetadata | null {
  return parseTestMetadata(annotations);
}
