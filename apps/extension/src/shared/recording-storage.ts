import type { RawCaptureEvent } from '@piwitests/core/recording';

/**
 * The running cross-page recording (event stream + on/off state), in
 * `chrome.storage.session` — same reasoning as `session-storage.ts`'s named
 * pick session: a working session for this browser run, not a saved file.
 * Requires `setAccessLevel` at the service worker to be reachable from a
 * content script — see `background/index.ts`.
 *
 * Stores the *raw* event stream, not pre-coalesced steps: `normalizeSteps`
 * (from `@piwitests/core/recording`) is the single source of truth for
 * turning events into steps, and it's cheap enough to re-run over the whole
 * stream on every read that keeping two representations in sync isn't worth
 * the risk of them drifting.
 */
const RECORDING_KEY = 'piwiRecording';

export interface RecordingState {
  active: boolean;
  events: RawCaptureEvent[];
  startedAt: number | null;
  /** The origin pattern granted for this recording (e.g. `https://app.example.com/*`) — background re-registers the content script for it on every new tab/navigation. */
  grantedOriginPattern: string | null;
}

const EMPTY: RecordingState = { active: false, events: [], startedAt: null, grantedOriginPattern: null };

export async function getRecordingState(): Promise<RecordingState> {
  const stored = await chrome.storage.session.get(RECORDING_KEY);
  const value = stored[RECORDING_KEY];
  return value && typeof value === 'object' ? (value as RecordingState) : { ...EMPTY };
}

async function setRecordingState(state: RecordingState): Promise<void> {
  await chrome.storage.session.set({ [RECORDING_KEY]: state });
}

export async function startRecording(grantedOriginPattern: string): Promise<RecordingState> {
  const state: RecordingState = { active: true, events: [], startedAt: Date.now(), grantedOriginPattern };
  await setRecordingState(state);
  return state;
}

export async function stopRecording(): Promise<RecordingState> {
  const current = await getRecordingState();
  const state: RecordingState = { ...current, active: false };
  await setRecordingState(state);
  return state;
}

export async function discardRecording(): Promise<void> {
  await chrome.storage.session.remove(RECORDING_KEY);
}

/**
 * Serializes appends within one document.
 *
 * An append is read-modify-write against a single storage key, and every DOM
 * listener fired one independently: two events landing together both read the
 * same array, both wrote their own copy, and whichever finished second silently
 * discarded the other's event. A click racing a `change`, or a keydown racing a
 * pending input, was enough.
 *
 * Per-document, which is where the bursts happen — the recorder attaches to the
 * main frame of each page, and a user interacts with one page at a time. Two
 * pages appending in the same instant can still interleave; making that
 * impossible would mean routing every append through the service worker, and
 * paying a message round-trip per keystroke to close a gap nothing has been
 * observed to hit.
 */
let appendQueue: Promise<unknown> = Promise.resolve();

/**
 * Appends one captured event. A no-op when recording isn't active — a
 * content script can outlive the recording being stopped from the popup in
 * another tab, so every append re-checks live state instead of trusting a
 * flag cached at injection time.
 *
 * Rejects if the write fails (a full session-storage quota, most likely); the
 * caller is expected to surface that rather than drop it, since the alternative
 * is a recording that looks healthy and exports short.
 */
export async function appendRecordingEvent(event: RawCaptureEvent): Promise<RecordingState> {
  const run = appendQueue.then(async () => {
    const current = await getRecordingState();
    if (!current.active) return current;
    const state: RecordingState = { ...current, events: [...current.events, event] };
    await setRecordingState(state);
    return state;
  });
  // The queue itself must never stay rejected, or one failed write would poison
  // every append after it; the rejection still reaches this call's own caller.
  appendQueue = run.catch(() => undefined);
  return run;
}
