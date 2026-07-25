/**
 * Minimal browser-side ZIP reader for the demo's committed trace archives.
 *
 * Mirrors the server's `trace-zip.ts`, including its split: walk the central
 * directory first, then inflate individual entries on demand. Importing a
 * multi-hundred-megabyte archive in a service worker makes that split matter —
 * inflating every entry up front would hold the whole archive twice.
 *
 * Built on DataView + DecompressionStream('deflate-raw') instead of Buffer +
 * node:zlib so it runs in the worker. Corrupt or unsupported entries are
 * skipped rather than crashing (same posture as the server's `parseZip`).
 */

export interface DemoZipEntry {
  name: string;
  data: Uint8Array;
}

/** Central-directory metadata for one entry — no decompression performed. */
export interface DemoZipEntryMeta {
  name: string;
  /** Compression method: 0 = stored, 8 = deflated. */
  method: number;
  compressedSize: number;
  /** Byte offset in the source buffer where compressed data begins. */
  dataStart: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CD_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

async function inflateRaw(compressed: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Walk the central directory and return entry metadata, decompressing nothing.
 * Throws when the buffer is not a ZIP at all.
 */
export function readZipDirectory(bytes: Uint8Array<ArrayBuffer>): DemoZipEntryMeta[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  // EOCD scan from the end (a ZIP comment can push it up to 65535 bytes in).
  const scanFrom = Math.max(0, bytes.length - 22 - 65535);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= scanFrom; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Not a valid ZIP (EOCD not found)');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const metas: DemoZipEntryMeta[] = [];
  let pos = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > bytes.length) throw new Error('Truncated central directory');
    if (view.getUint32(pos, true) !== CD_SIGNATURE) throw new Error('Invalid CD entry signature');

    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    pos += 46 + nameLen + extraLen + commentLen;

    // Directories and ZIP64 sentinels are never entries we can read.
    if (name.endsWith('/') || compressedSize === 0xffffffff) continue;

    if (localOffset + 30 > bytes.length) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) continue;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > bytes.length) continue;

    metas.push({ name, method, compressedSize, dataStart });
  }

  return metas;
}

/**
 * Decompress one entry. A stored entry is returned as a view into the archive,
 * so reading it costs nothing until the caller keeps it. Returns null for a
 * corrupt entry or a compression method this reader does not implement.
 */
export async function inflateZipEntry(
  bytes: Uint8Array<ArrayBuffer>,
  meta: DemoZipEntryMeta,
): Promise<Uint8Array | null> {
  try {
    const compressed = bytes.subarray(meta.dataStart, meta.dataStart + meta.compressedSize);
    if (meta.method === 0) return compressed;
    if (meta.method === 8) return await inflateRaw(compressed as Uint8Array<ArrayBuffer>);
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the entries whose names pass `include`, with their decompressed data.
 * Convenience over the two functions above, for callers reading a small
 * filtered subset — an import reads on demand instead.
 */
export async function readZipEntries(
  bytes: Uint8Array<ArrayBuffer>,
  include: (name: string) => boolean,
): Promise<DemoZipEntry[]> {
  const entries: DemoZipEntry[] = [];
  for (const meta of readZipDirectory(bytes)) {
    if (!include(meta.name)) continue;
    const data = await inflateZipEntry(bytes, meta);
    if (data) entries.push({ name: meta.name, data });
  }
  return entries;
}
