/**
 * ZIP writing for offline exports.
 *
 * Built on fflate so the same code runs in Nitro and in the demo's service
 * worker — the demo produces byte-identical archives to the server.
 *
 * `server/utils/trace-zip.ts` is a different tool for a different job: it reads
 * and rebuilds Playwright trace archives, stores rather than deflates, and is
 * Buffer-based. Exports do not use it.
 */
import { zipSync, strToU8 } from 'fflate';

export interface ExportZipEntry {
  path: string;
  data: Uint8Array | string;
  /**
   * Already-compressed bytes (PNG, WebM, trace ZIP). Deflating them again
   * costs CPU and saves nothing, so they are stored.
   */
  precompressed?: boolean;
}

/** Deflate level for text entries — report HTML, JSON and logs compress well. */
const TEXT_LEVEL = 6;

export function buildExportZip(entries: ExportZipEntry[]): Uint8Array {
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};

  for (const entry of entries) {
    // A duplicate path would silently overwrite; suffix instead so evidence is
    // never lost to a name collision.
    let path = entry.path;
    let n = 2;
    while (files[path]) {
      const dot = entry.path.lastIndexOf('.');
      path =
        dot > entry.path.lastIndexOf('/')
          ? `${entry.path.slice(0, dot)}-${n}${entry.path.slice(dot)}`
          : `${entry.path}-${n}`;
      n++;
    }

    const data = typeof entry.data === 'string' ? strToU8(entry.data) : entry.data;
    files[path] = [data, { level: entry.precompressed ? 0 : TEXT_LEVEL }];
  }

  return zipSync(files);
}
