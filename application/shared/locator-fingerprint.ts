/**
 * Element-fingerprint matching for locator healing. The pure implementation
 * lives in `@piwitests/core` (the single source of truth shared with the
 * Playwright reporter); this file re-exports it so app/server/demo code keeps
 * importing `#shared/locator-fingerprint`.
 */
export * from '@piwitests/core/locator-fingerprint';
