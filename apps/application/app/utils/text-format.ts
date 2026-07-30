/**
 * Pure text/format helpers with no Nuxt dependencies, so they can be imported in
 * unit tests without pulling in `#components`.
 */

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp']);

const VIDEO_EXTS = new Set(['.webm', '.mp4', '.ogg', '.mov']);
const VIDEO_MIMES = new Set(['video/webm', 'video/mp4', 'video/ogg', 'video/quicktime']);

/** Whether a file path (or its content type) refers to a displayable image. */
export function isImageFile(path: string, contentType?: string | null): boolean {
  const ext = '.' + (path.toLowerCase().split('.').pop() || '');
  if (IMAGE_EXTS.has(ext)) return true;
  if (contentType && IMAGE_MIMES.has(contentType.toLowerCase())) return true;
  return false;
}

/** Whether a file path (or its content type) refers to a playable video. */
export function isVideoFile(path: string, contentType?: string | null): boolean {
  const ext = '.' + (path.toLowerCase().split('.').pop() || '');
  if (VIDEO_EXTS.has(ext)) return true;
  if (contentType && VIDEO_MIMES.has(contentType.toLowerCase())) return true;
  return false;
}

/** Remove ANSI SGR escape sequences, leaving plain text. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
