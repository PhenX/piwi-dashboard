/**
 * Classification of `files` rows into the evidence kinds the UI and exports
 * care about.
 *
 * Real ingestion stores Playwright attachments as `type='attachment'` with
 * `subtype=<attachment name>` and `label=<content type>`, so a bare
 * `files.type = 'screenshot'` filter matches nothing the upload endpoints
 * write. These predicates accept both shapes.
 */

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const VIDEO_EXTS = new Set(['webm', 'mp4', 'ogg']);

export interface ClassifiableFileRow {
  type: string;
  subtype?: string | null;
  label?: string | null;
  path: string;
}

/** The evidence kinds an export groups files by. */
export type EvidenceKind = 'screenshot' | 'video' | 'trace' | 'attachment';

function extensionOf(path: string): string {
  return path.toLowerCase().split('.').pop() || '';
}

/** True when a files row refers to a screenshot image (either storage shape). */
export function isScreenshotFileRow(row: ClassifiableFileRow): boolean {
  if (row.type === 'screenshot') return true;
  if (row.type !== 'attachment') return false;
  if (row.subtype?.toLowerCase().startsWith('screenshot')) return true;
  if (row.label?.toLowerCase().startsWith('image/')) return true;
  return IMAGE_EXTS.has(extensionOf(row.path));
}

/** True when a files row refers to a recorded video. */
export function isVideoFileRow(row: ClassifiableFileRow): boolean {
  if (row.type === 'video') return true;
  if (row.type !== 'attachment') return false;
  if (row.subtype?.toLowerCase().startsWith('video')) return true;
  if (row.label?.toLowerCase().startsWith('video/')) return true;
  return VIDEO_EXTS.has(extensionOf(row.path));
}

/** The evidence kind a files row belongs to. */
export function classifyEvidenceFile(row: ClassifiableFileRow): EvidenceKind {
  if (row.type === 'trace') return 'trace';
  if (isScreenshotFileRow(row)) return 'screenshot';
  if (isVideoFileRow(row)) return 'video';
  return 'attachment';
}

/** Best-effort content type for a stored evidence file. */
export function contentTypeForPath(path: string, fallback?: string | null): string {
  const byExt: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    webm: 'video/webm',
    mp4: 'video/mp4',
    ogg: 'video/ogg',
    zip: 'application/zip',
    json: 'application/json',
    txt: 'text/plain',
    html: 'text/html',
  };
  return byExt[extensionOf(path)] ?? fallback ?? 'application/octet-stream';
}
