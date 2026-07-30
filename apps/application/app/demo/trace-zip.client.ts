/**
 * Minimal browser-side ZIP reader for the demo's trace archives and imports.
 *
 * Mirrors the server's `trace-zip.ts`, including its split: walk the central
 * directory first, then inflate individual entries on demand. Importing a
 * multi-hundred-megabyte archive in a service worker makes that split matter —
 * inflating every entry up front would hold the whole archive twice.
 *
 * Two front doors onto the same parser. The committed demo traces arrive as
 * bytes, so `readZipDirectory` works over a buffer. An imported archive arrives
 * as the uploaded `File`, and a ZIP is a random-access format — so `openZipBlob`
 * reads the directory out of a slice and then slices each entry as it is asked
 * for, and the archive never has to exist in the JS heap at all.
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

/** As recorded in the central directory, before the local header is read. */
interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  /** Offset of the entry's local header, which precedes its data. */
  localOffset: number;
}

/** Where the end-of-central-directory record says the directory lives. */
interface ZipDirectoryLocation {
  entryCount: number;
  cdOffset: number;
  cdSize: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CD_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** EOCD is 22 bytes, and a ZIP comment can push it 65535 further from the end. */
const EOCD_MAX_OFFSET = 22 + 65535;

/** Fixed size of a local file header, before its name and extra fields. */
const LOCAL_HEADER_SIZE = 30;

async function inflateRaw(compressed: Blob): Promise<Uint8Array> {
  const stream = compressed.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Locate the central directory from the tail of the archive. The offsets the
 * EOCD record carries are from the start of the file, so they need no rebasing.
 */
function findDirectory(tail: Uint8Array): ZipDirectoryLocation {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) !== EOCD_SIGNATURE) continue;
    return {
      entryCount: view.getUint16(i + 10, true),
      cdSize: view.getUint32(i + 12, true),
      cdOffset: view.getUint32(i + 16, true),
    };
  }

  throw new Error('Not a valid ZIP (EOCD not found)');
}

/** Parse the central directory's own bytes into one record per entry. */
function parseDirectory(cd: Uint8Array, entryCount: number): CentralEntry[] {
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const decoder = new TextDecoder();
  const entries: CentralEntry[] = [];
  let pos = 0;

  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > cd.length) throw new Error('Truncated central directory');
    if (view.getUint32(pos, true) !== CD_SIGNATURE) throw new Error('Invalid CD entry signature');

    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(cd.subarray(pos + 46, pos + 46 + nameLen));

    pos += 46 + nameLen + extraLen + commentLen;

    // Directories and ZIP64 sentinels are never entries we can read.
    if (name.endsWith('/') || compressedSize === 0xffffffff) continue;

    entries.push({ name, method, compressedSize, localOffset });
  }

  return entries;
}

/**
 * Where an entry's data begins, from its local header — the central directory
 * records the header's offset, and only the header knows how long it is.
 * Returns null when the header is missing or the entry runs past the archive.
 */
function resolveDataStart(header: DataView, entry: CentralEntry, archiveSize: number): number | null {
  if (header.byteLength < LOCAL_HEADER_SIZE) return null;
  if (header.getUint32(0, true) !== LOCAL_SIGNATURE) return null;

  const nameLen = header.getUint16(26, true);
  const extraLen = header.getUint16(28, true);
  const dataStart = entry.localOffset + LOCAL_HEADER_SIZE + nameLen + extraLen;

  return dataStart + entry.compressedSize > archiveSize ? null : dataStart;
}

/**
 * Walk the central directory and return entry metadata, decompressing nothing.
 * Throws when the buffer is not a ZIP at all.
 */
export function readZipDirectory(bytes: Uint8Array<ArrayBuffer>): DemoZipEntryMeta[] {
  const { entryCount, cdOffset, cdSize } = findDirectory(bytes.subarray(Math.max(0, bytes.length - EOCD_MAX_OFFSET)));

  const cd = bytes.subarray(cdOffset, cdOffset + cdSize);
  const metas: DemoZipEntryMeta[] = [];

  for (const entry of parseDirectory(cd, entryCount)) {
    if (entry.localOffset + LOCAL_HEADER_SIZE > bytes.length) continue;
    const header = new DataView(bytes.buffer, bytes.byteOffset + entry.localOffset, LOCAL_HEADER_SIZE);
    const dataStart = resolveDataStart(header, entry, bytes.length);
    if (dataStart === null) continue;

    metas.push({ name: entry.name, method: entry.method, compressedSize: entry.compressedSize, dataStart });
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
    if (meta.method === 8) return await inflateRaw(new Blob([compressed as Uint8Array<ArrayBuffer>]));
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

/** An archive opened for reading, without any of it held in the JS heap. */
export interface DemoZipBlobArchive {
  entryNames: string[];
  readEntry: (name: string) => Promise<Uint8Array | null>;
}

/**
 * Open a `Blob` — in practice the uploaded `File` — as a ZIP.
 *
 * Reads only the tail and the central directory up front, then slices each
 * entry out of the blob as it is asked for. The browser keeps the blob's bytes
 * where it wants them, so a 400 MB import costs the heap one inflated entry at
 * a time rather than the whole archive.
 */
export async function openZipBlob(blob: Blob): Promise<DemoZipBlobArchive> {
  const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - EOCD_MAX_OFFSET)).arrayBuffer());
  const { entryCount, cdOffset, cdSize } = findDirectory(tail);

  const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const byName = new Map(parseDirectory(cd, entryCount).map((entry) => [entry.name, entry]));

  return {
    entryNames: [...byName.keys()],

    async readEntry(name) {
      const entry = byName.get(name);
      if (!entry) return null;

      try {
        // Two reads: the local header, which says where the data starts, and
        // then the data itself. Both are slices — neither touches the rest.
        const headerEnd = Math.min(blob.size, entry.localOffset + LOCAL_HEADER_SIZE);
        const header = await blob.slice(entry.localOffset, headerEnd).arrayBuffer();
        const dataStart = resolveDataStart(new DataView(header), entry, blob.size);
        if (dataStart === null) return null;

        const compressed = blob.slice(dataStart, dataStart + entry.compressedSize);
        if (entry.method === 0) return new Uint8Array(await compressed.arrayBuffer());
        if (entry.method === 8) return await inflateRaw(compressed);
        return null;
      } catch {
        return null;
      }
    },
  };
}
