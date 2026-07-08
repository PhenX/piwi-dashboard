import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const appDir = fileURLToPath(new URL('./app', import.meta.url)).replace(/\/$/, '');

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Scoped to the unit-testable pure-logic layers — app/ Vue components and
      // server/api/ route handlers are exercised by the Playwright E2E suite
      // instead, so including them here would just report accurate zeroes.
      include: ['shared/**/*.ts', 'server/utils/**/*.ts', 'app/utils/**/*.ts', 'app/composables/**/*.ts'],
    },
  },
  resolve: {
    // Mirror Nuxt's path aliases so app composables/utils can be unit-tested.
    alias: {
      '~~': rootDir,
      '@@': rootDir,
      '~': appDir,
      '@': appDir,
      '#shared': `${rootDir}/shared`,
      // Stub Nuxt's auto-import virtual module so pure helpers in modules that
      // reference auto-imported components can be unit-tested in isolation.
      '#components': `${rootDir}/tests/unit/stubs/nuxt-components.ts`,
    },
  },
});
