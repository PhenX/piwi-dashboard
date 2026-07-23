/**
 * Save a file to disk from the desktop shell.
 *
 * A `target="_blank"` / `download` link is inert in the Tauri webview — the
 * new-window request is dropped, so the file never lands anywhere (this is why
 * "download the OpenAPI spec" appears to do nothing in the desktop app). Here we
 * fetch the content in-webview (so the desktop access-token cookie rides along
 * for guarded routes) and hand the bytes to the shell, which writes them to the
 * user's Downloads folder and reveals the file.
 *
 * Outside the desktop shell there is no bridge, so `download` falls back to a
 * normal navigation and the browser handles it — meaning callers can wire this
 * unconditionally and it does the right thing on web and desktop alike.
 */
export function useDesktopDownload() {
  const isDesktop = useIsDesktop();
  const toast = useToast();

  async function download(url: string, filename: string): Promise<void> {
    const core = tauriCore();
    if (!core) {
      window.open(url, '_blank');
      return;
    }

    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const contents = await res.text();
      const path = await core.invoke<string>('desktop_save_download', { filename, contents });
      toast.add({
        title: 'Saved to Downloads',
        description: path,
        color: 'success',
        icon: 'i-lucide-download',
      });
    } catch (error) {
      toast.add({ title: 'Download failed', description: errorMessage(error), color: 'error' });
    }
  }

  return { isDesktop, download };
}
