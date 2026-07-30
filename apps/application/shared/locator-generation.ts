/**
 * Locator generation. The pure implementation lives in `@piwitests/core`
 * (the single source of truth shared with the Playwright reporter); this file
 * re-exports it so app/server/demo code keeps importing `#shared/locator-generation`.
 */
export * from '@piwitests/core/locator-generation';
