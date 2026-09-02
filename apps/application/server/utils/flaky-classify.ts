// The pure classifier lives in shared/ so the demo's client-side handler
// (shared/handlers/flaky-classify.ts) can reuse it without pulling in any
// server-only code. Re-exported here so existing server imports keep working.
export { classifyFlakyRootCause, type FlakyRootCause } from '#shared/flaky-classify';
