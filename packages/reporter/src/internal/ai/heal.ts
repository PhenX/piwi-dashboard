/**
 * The cheapest rung of the healing ladder: repair a committed locator whose
 * element was only *renamed* (its accessible name changed) — no LLM, no network,
 * a one-line diff. Given the entry's stored fingerprint and a fresh ARIA
 * snapshot, `@piwitests/core` decides whether the element is still present
 * (nothing to do), was renamed (repairable), or is genuinely gone (a real
 * regression the agent must handle). Higher rungs — tail re-resolution and full
 * re-resolution — live in the resolution loop.
 */
import { fingerprintPresent, matchRenamedElement, parseAriaCandidates } from '@piwitests/core';
import type { LocatorEntry } from './artifact.js';
import { compileFromCandidate } from './compile.js';

/**
 * Attempt a rename-match repair of a locator entry. Returns the repaired entry
 * (new locator + refreshed fingerprint) when the element was confidently
 * renamed, or `null` when there is nothing to repair — the fingerprint is still
 * present, no confident match exists, or the snapshot is unusable.
 */
export function healLocatorEntry(entry: LocatorEntry, ariaSnapshot: string | null): LocatorEntry | null {
  if (!entry.fingerprint || !ariaSnapshot) return null;
  const candidates = parseAriaCandidates(ariaSnapshot);
  if (candidates.length === 0) return null;
  // Still on the page under its recorded identity — no heal needed.
  if (fingerprintPresent(entry.fingerprint, candidates)) return null;

  const match = matchRenamedElement(entry.fingerprint, candidates);
  if (!match) return null;
  const compiled = compileFromCandidate(match.candidate);
  if (!compiled) return null;
  return { ...entry, locator: compiled.locator, fingerprint: compiled.fingerprint };
}
