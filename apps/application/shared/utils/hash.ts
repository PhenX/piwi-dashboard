/**
 * Hashing helpers built on the Web Crypto API — the same surface is available in
 * browsers and in Node 19+, so these are safe to import from shared/browser code.
 */

/** SHA-256 hex digest of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
