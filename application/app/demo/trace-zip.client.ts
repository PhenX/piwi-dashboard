/**
 * Minimal browser-side ZIP reader for the demo's committed trace archives.
 *
 * Mirrors the server's `trace-zip.ts` central-directory walk, but built on
 * DataView + DecompressionStream('deflate-raw') instead of Buffer + node:zlib
 * so it runs inside the demo service worker. Only what the demo needs: read a
 * filtered subset of entries; corrupt or unsupported entries are skipped
 * rather than crashing (same posture as the server's `parseZip`).
 */

export interface DemoZipEntry {
  name: string;
  data: Uint8Array;
}

const EOCD_SIGNATURE = 0x06054b50;
const CD_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

async function inflateRaw(compressed: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read the entries of a ZIP archive whose names pass `include`, with their
 * decompressed data. Reads via the central directory so data descriptors and
 * flag variations don't affect correctness. Throws when the buffer is not a
 * ZIP at all.
 */
export async function readZipEntries(
  bytes: Uint8Array<ArrayBuffer>,
  include: (name: string) => boolean,
): Promise<DemoZipEntry[]> {
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

  const entries: DemoZipEntry[] = [];
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

    // Directories and ZIP64 sentinels are never trace entries.
    if (name.endsWith('/') || compressedSize === 0xffffffff) continue;
    if (!include(name)) continue;

    try {
      if (localOffset + 30 > bytes.length) continue;
      if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) continue;
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      if (dataStart + compressedSize > bytes.length) continue;

      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) {
        entries.push({ name, data: compressed });
      } else if (method === 8) {
        entries.push({ name, data: await inflateRaw(compressed) });
      }
      // Other compression methods: skip the entry.
    } catch {
      // Corrupt entry — skip rather than crash.
    }
  }

  return entries;
}
