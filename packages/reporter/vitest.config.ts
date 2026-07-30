import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    // tests/integration/ is a standalone Playwright project (a real browser +
    // the built package), not part of the Vitest unit suite — run it via
    // `npm run reporter:test:integration` instead.
    exclude: ['**/node_modules/**', 'tests/integration/**'],
    coverage: {
      provider: 'v8',
      // json-summary + json feed the PR coverage comment (see .github/workflows/ci.yml).
      reporter: ['text', 'html', 'json-summary', 'json'],
      include: ['src/**/*.ts'],
    },
  },
});
