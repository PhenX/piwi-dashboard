import { dirname, resolve, relative, isAbsolute } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { gunzip } from 'zlib';
import { promisify } from 'util';

const gunzipAsync = promisify(gunzip);

/**
 * Upper bound on the decompressed size of a report archive. The archive packs
 * an entire report/trace directory into one gzip stream that is inflated fully
 * into memory here, and uploads are attacker-controllable (open when auth is
 * disabled), so an unbounded compression ratio would let a few kilobytes expand
 * to gigabytes and OOM the server. 1 GiB comfortably exceeds any realistic
 * report (even a large blob report with hundreds of traced tests) while
 * stopping decompression bombs. zlib throws ERR_BUFFER_TOO_LARGE past the cap.
 */
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024; // 1 GiB

/**
 * Decompress a gzip-compressed archive buffer into a target directory.
 */
export async function decompressDirectory(compressedBuffer: Buffer, targetDir: string): Promise<void> {
  try {
    const uncompressed = await gunzipAsync(compressedBuffer, { maxOutputLength: MAX_ARCHIVE_BYTES });

    await mkdir(targetDir, { recursive: true });

    // Parse the archive format (little-endian byte order)
    let offset = 0;
    let fileCount = 0;

    while (offset < uncompressed.length) {
      // Read path length
      if (offset + 4 > uncompressed.length) {
        if (offset !== uncompressed.length) {
          console.warn(`Incomplete archive data at offset ${offset}, expected ${uncompressed.length}`);
        }
        break;
      }
      const pathLength = uncompressed.readUInt32LE(offset);
      offset += 4;

      // Validate path length
      if (pathLength === 0 || pathLength > 10000) {
        throw new Error(`Invalid path length: ${pathLength} at offset ${offset - 4}`);
      }

      // Read path
      if (offset + pathLength > uncompressed.length) {
        throw new Error(`Incomplete path data at offset ${offset}`);
      }
      const filePath = uncompressed.toString('utf8', offset, offset + pathLength);
      offset += pathLength;

      // Read content length
      if (offset + 4 > uncompressed.length) {
        throw new Error(`Incomplete content length at offset ${offset}`);
      }
      const contentLength = uncompressed.readUInt32LE(offset);
      offset += 4;

      // Read content
      if (offset + contentLength > uncompressed.length) {
        throw new Error(`Incomplete content data at offset ${offset}, expected ${contentLength} bytes`);
      }
      const content = uncompressed.subarray(offset, offset + contentLength);
      offset += contentLength;

      // Write file — guard against path traversal (zip-slip). The archive is
      // attacker-controllable (uploaded to /api/test-runs/upload, which is open
      // when auth is disabled), so a malicious entry path like `../../evil` must
      // not be allowed to escape targetDir.
      const fullPath = resolve(targetDir, filePath);
      const rel = relative(targetDir, fullPath);
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`Unsafe path in archive (path traversal blocked): ${filePath}`);
      }
      const dirPath = dirname(fullPath);

      await mkdir(dirPath, { recursive: true });
      await writeFile(fullPath, content);
      fileCount++;
    }

    console.log(`Successfully decompressed ${fileCount} files from archive`);
  } catch (error) {
    console.error('Failed to decompress archive:', error);
    throw error;
  }
}
