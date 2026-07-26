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
 *
 * `evaluate()` runs its argument as `await (<script>)`, so each script must be a
 * single expression; the plugin awaits it and hands back the resolved value.
 */
test('the dashboard can reach the shell IPC commands', async ({ tauriPage }) => {
  // The shell boots the sidecar server then navigates the window to it; wait for
  // the app shell to render before probing.
  await tauriPage.waitForSelector('#__nuxt, [data-nuxt-root], body *', 60_000);

  const hasBridge = await tauriPage.evaluate(
    `typeof window.__TAURI__ !== 'undefined' && typeof window.__TAURI__.core?.invoke === 'function'`,
  );
  expect(hasBridge, 'window.__TAURI__.core.invoke must exist in the desktop webview').toBe(true);

  // A single awaited expression: invoke the command and resolve to a plain object
  // the plugin can serialize back. If the ACL rejected it we'd get `ok: false`.
  const result = (await tauriPage.evaluate(`
    window.__TAURI__.core.invoke('desktop_get_service_settings')
      .then((s) => ({ ok: true, keys: Object.keys(s || {}) }))
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
  `)) as { ok: boolean; error?: string; keys?: string[] };

  expect(result.ok, `invoke was rejected: ${result.error ?? 'unknown'}`).toBe(true);
  expect(result.keys).toEqual(expect.arrayContaining(['run_in_background', 'start_on_login']));

  // The local-runner commands are granted too: an unknown project resolves to
  // null (not an ACL rejection)…
  const link = (await tauriPage.evaluate(`
    window.__TAURI__.core.invoke('desktop_get_project_link', { projectId: 'e2e-no-such-project' })
      .then((l) => ({ ok: true, link: l ?? null }))
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
  `)) as { ok: boolean; error?: string; link?: unknown };
  expect(link.ok, `desktop_get_project_link rejected: ${link.error ?? 'unknown'}`).toBe(true);
  expect(link.link).toBeNull();

  // …and a relative path is refused by the command's own validation, proving
  // the call went through the ACL and into the handler.
  const rejected = (await tauriPage.evaluate(`
    window.__TAURI__.core.invoke('desktop_set_project_link', { projectId: 'e2e-no-such-project', path: 'not/absolute' })
      .then(() => ({ rejected: false, error: '' }))
      .catch((e) => ({ rejected: true, error: String((e && e.message) || e) }))
  `)) as { rejected: boolean; error: string };
  expect(rejected.rejected).toBe(true);
  expect(rejected.error).toContain('absolute');
});
