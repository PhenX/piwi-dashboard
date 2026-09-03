/**
 * Staleness of a completed diagnosis, computed from what the dashboard already
 * knows. Pure so both the cluster panel and the unit tests share one definition.
 *
 * A diagnosis is stale only when the evidence has genuinely moved on: the hash of
 * the current context differs from the hash stored when the diagnosis ran, AND the
 * cluster is still failing. A fix-verified cluster (or one that stopped failing, or
 * was triaged resolved) describes a failure that is no longer happening, so it is
 * never stale.
 */

export interface StalenessInput {
  /** Hash stored on the diagnosis when it ran (`failure_diagnoses.context_sha`). */
  storedContextSha: string | null | undefined;
  /** Hash of the context as it is now. */
  currentContextSha: string | null | undefined;
  /** Fix-verification verdict, when a fix has landed. */
  fixVerification: string | null | undefined;
  /** Triage status of the cluster. */
  status: string | null | undefined;
}

/** Whether the cluster is still failing — the necessary condition for staleness. */
export function clusterStillFailing(input: Pick<StalenessInput, 'fixVerification' | 'status'>): boolean {
  return (
    input.fixVerification !== 'diagnosis-verified' &&
    input.fixVerification !== 'stopped-failing' &&
    input.status !== 'resolved'
  );
}

/** Whether a completed diagnosis should be flagged as stale. */
export function isDiagnosisStale(input: StalenessInput): boolean {
  const { storedContextSha, currentContextSha } = input;
  if (!storedContextSha || !currentContextSha) return false;
  return storedContextSha !== currentContextSha && clusterStillFailing(input);
}

/**
 * Why a stale diagnosis is stale, for the banner wording: new failing runs since
 * the diagnosis (`occurrences`) versus a change in the evidence otherwise
 * (`evidence`). Returns null when not stale or the timestamps can't decide.
 */
export function stalenessReason(
  input: StalenessInput & { diagnosedAt: number | null; lastSeenAt: number | null },
): 'occurrences' | 'evidence' | null {
  if (!isDiagnosisStale(input)) return null;
  const { diagnosedAt, lastSeenAt } = input;
  return diagnosedAt != null && lastSeenAt != null && lastSeenAt > diagnosedAt ? 'occurrences' : 'evidence';
}
