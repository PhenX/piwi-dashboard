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
 * Appends one captured event. A no-op when recording isn't active — a
 * content script can outlive the recording being stopped from the popup in
 * another tab, so every append re-checks live state instead of trusting a
 * flag cached at injection time.
 */
export async function appendRecordingEvent(event: RawCaptureEvent): Promise<RecordingState> {
  const current = await getRecordingState();
  if (!current.active) return current;
  const state: RecordingState = { ...current, events: [...current.events, event] };
  await setRecordingState(state);
  return state;
}
