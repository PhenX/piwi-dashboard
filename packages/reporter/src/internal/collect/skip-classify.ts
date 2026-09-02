/**
 * Skip/status classification. The pure implementation lives in
 * `@piwitests/core` (the single source of truth shared with the dashboard, so
 * imported runs classify statuses exactly like live ones); this file re-exports
 * it so reporter code keeps importing `../internal/collect/skip-classify.js`.
 */
export * from '@piwitests/core/status-classify';
