import { test, expect } from '../fixtures';

/**
 * Smoke test for the shell integration, driving the real webview.
 *
 * The dashboard runs at the loopback (remote) origin, and Tauri rejects custom
 * command invokes from remote origins unless a capability grants them. That
 * rejection is exactly what silently broke external links, downloads, and
 * notifications — and it is invisible to compile-time and unit checks. Driving
 * the real app and calling a command end to end is the only thing that proves
 * the ACL grant is actually in place.
 *
 * Everything lives in ONE test on purpose: the shell is single-instance and
 * binds a fixed loopback port, so the per-test fixture can't launch a second
 * app instance — a relaunch just focuses the first window and never stands up
 * its own control socket. One launch, both assertions.
 */
test('the dashboard can reach the shell IPC commands', async ({ tauriPage }) => {
  // The shell boots the sidecar server then navigates the window to it; wait for
  // the app shell to render before probing.
  await tauriPage.waitForSelector('#__nuxt, [data-nuxt-root], body *', 60_000);

  const hasBridge = await tauriPage.evaluate(
    `typeof window.__TAURI__ !== 'undefined' && typeof window.__TAURI__.core?.invoke === 'function'`,
  );
  expect(hasBridge, 'window.__TAURI__.core.invoke must exist in the desktop webview').toBe(true);

  // Kick off the invoke and stash the outcome on the window; then wait for it,
  // so we never depend on how `evaluate` handles a returned promise.
  await tauriPage.evaluate(`
    window.__PW_INVOKE__ = undefined;
    window.__TAURI__.core.invoke('desktop_get_service_settings')
      .then((s) => { window.__PW_INVOKE__ = { ok: true, keys: Object.keys(s ?? {}) }; })
      .catch((e) => { window.__PW_INVOKE__ = { ok: false, error: String(e) }; });
  `);

  await tauriPage.waitForFunction(`window.__PW_INVOKE__ !== undefined`, 15_000);
  const result = (await tauriPage.evaluate(`window.__PW_INVOKE__`)) as {
    ok: boolean;
    error?: string;
    keys?: string[];
  };

  expect(result.ok, `invoke was rejected: ${result.error ?? 'unknown'}`).toBe(true);
  expect(result.keys).toEqual(expect.arrayContaining(['run_in_background', 'start_on_login']));
});
