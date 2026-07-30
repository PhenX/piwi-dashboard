/**
 * Human-readable byte sizes, shared by the app (storage stats, file lists) and
 * the server (upload-limit messages) so a size reads identically wherever it
 * appears — including when the server's rejection quotes the same limit the
 * import page showed before uploading.
 */
export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
