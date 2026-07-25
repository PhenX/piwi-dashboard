/**
 * Step analysis. The pure implementation lives in `@piwitests/core` (the single
 * source of truth shared with the dashboard); this file re-exports it so
 * reporter code keeps importing `../internal/collect/step-analyzer.js`.
 */
export * from '@piwitests/core/step-analysis';
