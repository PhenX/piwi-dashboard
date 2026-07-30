/**
 * Playwright step analysis. The pure implementation lives in `@piwitests/core`
 * (the single source of truth shared with the Playwright reporter); this file
 * re-exports it so app/server code keeps importing `#shared/step-analysis`.
 */
export * from '@piwitests/core/step-analysis';
