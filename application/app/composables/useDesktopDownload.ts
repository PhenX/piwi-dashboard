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
 *
 * Binary payloads (ZIP archives, images) ride the bridge base64-encoded: a byte
 * array crosses Tauri's IPC as JSON numbers, which multiplies the size of any
 * real archive.
 */

/** Base64 in chunks — spreading a multi-megabyte array blows the argument limit. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function useDesktopDownload() {
  const isDesktop = useIsDesktop();
  const toast = useToast();

  /**
   * @param binary  Save raw bytes rather than text. Required for anything that
   *                is not UTF-8 (archives, PDFs, images) — decoding those as
   *                text corrupts them.
   */
  async function download(url: string, filename: string, options: { binary?: boolean } = {}): Promise<void> {
    const core = tauriCore();
    if (!core) {
      window.open(url, '_blank');
      return;
    }

    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const contents = options.binary ? toBase64(new Uint8Array(await res.arrayBuffer())) : await res.text();
      const path = await core.invoke<string>('desktop_save_download', {
        filename,
        contents,
        encoding: options.binary ? 'base64' : 'utf8',
      });
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
