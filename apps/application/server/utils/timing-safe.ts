import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string equality for comparing secrets such as stream / setup /
 * desktop access tokens. Both inputs are SHA-256'd first, so the comparison is
 * always over equal-length buffers and never short-circuits on the first
 * differing byte the way `===` does — closing the timing side-channel that could
 * otherwise let an attacker recover a token byte by byte. Hashing also keeps the
 * inputs' lengths from leaking through the comparison. Inputs are coerced to
 * strings so a non-string value from an untrusted body can't throw here.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}
