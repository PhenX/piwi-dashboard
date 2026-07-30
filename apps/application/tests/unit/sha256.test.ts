import { describe, test, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Sha256, sha256Blob } from '../../shared/utils/sha256';

/** The reference the browser would have used, had it a streaming digest. */
async function reference(bytes: Uint8Array): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = state & 0xff;
  }
  return out;
}

describe('Sha256', () => {
  test('matches the published vectors', async () => {
    expect(new Sha256().update(new TextEncoder().encode('')).hex()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(new Sha256().update(new TextEncoder().encode('abc')).hex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      new Sha256().update(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).hex(),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  test('agrees with crypto.subtle across the block boundaries', async () => {
    // 55/56/57 straddle the point where the length no longer fits in the final
    // block, and 63/64/65 the block size itself — where padding goes wrong.
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 128, 1000, 4096, 100_000]) {
      const input = bytes(length, length + 1);
      expect(new Sha256().update(input).hex(), `length ${length}`).toBe(await reference(input));
    }
  });

  test('is unaffected by how the input is split into chunks', async () => {
    const input = bytes(10_000, 7);
    const expected = await reference(input);

    for (const size of [1, 7, 63, 64, 65, 1024, 9999]) {
      const hash = new Sha256();
      for (let offset = 0; offset < input.length; offset += size) {
        hash.update(input.subarray(offset, Math.min(offset + size, input.length)));
      }
      expect(hash.hex(), `chunks of ${size}`).toBe(expected);
    }
  });

  test('refuses to be used after it is finished', () => {
    const hash = new Sha256();
    hash.update(bytes(10));
    hash.hex();
    expect(() => hash.hex()).toThrow(/twice/);
    expect(() => hash.update(bytes(10))).toThrow(/after digest/);
  });

  test('hashes a blob as a stream, reporting progress', async () => {
    const input = bytes(300_000, 3);
    const seen: number[] = [];
    const hex = await sha256Blob(new Blob([input as Uint8Array<ArrayBuffer>]), (f) => seen.push(f));

    expect(hex).toBe(await reference(input));
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true);
  });

  test('hashes an empty blob', async () => {
    expect(await sha256Blob(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
