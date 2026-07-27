/**
 * Archives the OS handed to the desktop app (dropped on the window, opened
 * with the app, passed to a second launch) waiting to be imported. Shared
 * between the plugin that collects them and the import dialog that consumes
 * them; only `.zip` files ever enter the queue.
 */
export function useDesktopImportQueue() {
  const files = useState<string[]>('desktop-import-files', () => []);
  const open = useState<boolean>('desktop-import-open', () => false);

  function addFiles(paths: string[]) {
    const zips = paths.filter((p) => p.toLowerCase().endsWith('.zip'));
    if (zips.length === 0) return;
    files.value = [...new Set([...files.value, ...zips])];
    open.value = true;
  }

  function removeFile(path: string) {
    files.value = files.value.filter((p) => p !== path);
  }

  function clear() {
    files.value = [];
  }

  return { files, open, addFiles, removeFile, clear };
}
