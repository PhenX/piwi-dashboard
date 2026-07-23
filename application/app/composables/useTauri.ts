/**
 * Access to the Tauri IPC bridge injected into the desktop shell's webview.
 *
 * The bundled dashboard is served over loopback and the desktop shell injects
 * `window.__TAURI__` (via `withGlobalTauri`), reachable only from the app's own
 * window — a plain browser at the same URL has no bridge. Everything here
 * feature-detects the bridge and no-ops when it is absent, so the shared web
 * build imports it harmlessly.
 */
interface TauriCore {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

/** The native invoke bridge, or `null` when not running inside the desktop shell. */
export function tauriCore(): TauriCore | null {
  const g = globalThis as unknown as { __TAURI__?: { core?: TauriCore } };
  return g.__TAURI__?.core ?? null;
}
