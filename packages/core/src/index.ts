/**
 * `@piwitests/core` — pure, dependency-free cross-cutting logic shared by the
 * Piwi Dashboard app and the Playwright reporter.
 *
 * The package ships TypeScript source; each consumer transpiles it (the app via
 * Vite, the reporter by bundling it into `dist/` at build time). It must stay
 * browser/worker/server-safe: no `node:*` imports, no third-party dependencies,
 * no imports from `application/` or `reporter/`. Enforced by `tests/boundary.test.ts`.
 */
export * from './locator-healing-types';
export * from './locator-generation';
export * from './locator-fingerprint';
