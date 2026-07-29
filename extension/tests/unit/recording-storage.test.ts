import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRecordingState,
  startRecording,
  stopRecording,
  discardRecording,
  appendRecordingEvent,
} from '../../src/shared/recording-storage.js';
import type { RawCaptureEvent } from '@piwitests/core/recording';

function fakeChromeStorage() {
  const store: Record<string, unknown> = {};
  return {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        },
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  };
}

beforeEach(() => {
  (globalThis as any).chrome = fakeChromeStorage();
});

const clickEvent: RawCaptureEvent = {
  kind: 'click',
  target: null,
  value: null,
  checked: null,
  inputType: null,
  isPasswordField: false,
  pageUrl: 'https://x.test/',
  timestamp: 1,
};

describe('recording state', () => {
  it('starts inactive with no events', async () => {
    const state = await getRecordingState();
    expect(state.active).toBe(false);
    expect(state.events).toEqual([]);
  });

  it('startRecording activates and records the granted origin pattern', async () => {
    const state = await startRecording('https://x.test/*');
    expect(state.active).toBe(true);
    expect(state.grantedOriginPattern).toBe('https://x.test/*');
    expect(state.startedAt).not.toBeNull();
  });

  it('appendRecordingEvent is a no-op when not recording', async () => {
    const state = await appendRecordingEvent(clickEvent);
    expect(state.events).toEqual([]);
  });

  it('appendRecordingEvent accumulates events once active', async () => {
    await startRecording('https://x.test/*');
    await appendRecordingEvent(clickEvent);
    await appendRecordingEvent({ ...clickEvent, timestamp: 2 });
    const state = await getRecordingState();
    expect(state.events).toHaveLength(2);
  });

  it('stopRecording flips active to false but keeps events', async () => {
    await startRecording('https://x.test/*');
    await appendRecordingEvent(clickEvent);
    const stopped = await stopRecording();
    expect(stopped.active).toBe(false);
    expect(stopped.events).toHaveLength(1);
  });

  it('discardRecording clears everything', async () => {
    await startRecording('https://x.test/*');
    await appendRecordingEvent(clickEvent);
    await discardRecording();
    const state = await getRecordingState();
    expect(state.active).toBe(false);
    expect(state.events).toEqual([]);
  });
});
