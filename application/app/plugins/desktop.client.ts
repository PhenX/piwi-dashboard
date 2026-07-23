/**
 * Desktop shell integration.
 *
 * The dashboard runs unchanged inside the Tauri webview, but a webview is a
 * single window with no browser chrome, so a few web affordances need routing
 * through the native shell:
 *   - external links (`https://…`, GitHub, the docs) have nowhere to open — the
 *     webview would either navigate away from the app or silently drop the
 *     `target="_blank"` new-window request, so we hand them to the OS browser;
 *   - the Web Notification API is unavailable / permission-denied in the
 *     webview, so we shim it onto native OS notifications.
 *
 * All of this only activates in the desktop build (`NUXT_PUBLIC_DESKTOP`) and
 * only when the native bridge is actually present, so the shared web build is
 * unaffected. File downloads (the OpenAPI spec) are handled separately by
 * `useDesktopDownload`, wired at the button that triggers them.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  if (String(config.public.desktop) !== 'true') return;

  const core = tauriCore();
  if (!core) return; // opened in a plain browser at the loopback URL — no bridge

  installExternalLinkHandler(core);
  installNativeNotifications(core);
});

interface Bridge {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

/**
 * Open cross-origin `http(s)` / `mailto:` links in the user's default browser
 * instead of navigating the app window away from itself. Same-origin links
 * (SPA routes, in-app anchors, and same-origin file links handled elsewhere)
 * are left untouched so Vue Router / the download handler still see them.
 */
function installExternalLinkHandler(core: Bridge) {
  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;

      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        return;
      }

      const isWeb = url.protocol === 'http:' || url.protocol === 'https:';
      const isExternalWeb = isWeb && url.origin !== window.location.origin;
      const isMail = url.protocol === 'mailto:';
      if (!isExternalWeb && !isMail) return;

      event.preventDefault();
      core.invoke('desktop_open_external', { url: anchor.href }).catch(() => {});
    },
    true, // capture — beat Vue Router's own click handling
  );
}

/**
 * Replace `window.Notification` with a shim that shows native OS notifications
 * through the shell. The dashboard's notification code checks `'Notification' in
 * window`, reads `Notification.permission`, and constructs `new Notification()`;
 * routing those through the shell makes browser-channel notifications work in
 * the desktop app without touching a dozen call sites. (Native click-to-open is
 * platform-dependent and not wired — the notification still displays.)
 */
function installNativeNotifications(core: Bridge) {
  class NativeNotification extends EventTarget {
    static readonly permission: NotificationPermission = 'granted';
    static requestPermission(): Promise<NotificationPermission> {
      return Promise.resolve('granted');
    }

    onclick: ((this: Notification, ev: Event) => unknown) | null = null;
    onclose: ((this: Notification, ev: Event) => unknown) | null = null;
    onerror: ((this: Notification, ev: Event) => unknown) | null = null;
    onshow: ((this: Notification, ev: Event) => unknown) | null = null;
    readonly title: string;
    readonly body: string;

    constructor(title: string, options?: NotificationOptions) {
      super();
      this.title = title;
      this.body = options?.body ?? '';
      core.invoke('desktop_notify', { title, body: this.body }).catch(() => {});
    }

    close() {}
  }

  try {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: NativeNotification,
    });
  } catch {
    // A locked-down webview may refuse the redefinition — degrade silently.
  }
}
