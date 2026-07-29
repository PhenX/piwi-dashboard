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

  it('concurrent appends all survive, in order', async () => {
    // A slow write is what exposes the race the queue exists to close: with the
    // read and the write unserialized, every caller reads the same array and the
    // last one to finish discards the others' events. Real capture hits this
    // whenever two listeners fire together — a click beside a change, a keydown
    // beside a pending input.
    const chromeApi = fakeChromeStorage();
    const write = chromeApi.storage.session.set;
    chromeApi.storage.session.set = async (values: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await write(values);
    };
    (globalThis as any).chrome = chromeApi;

    await startRecording('https://x.test/*');
    await Promise.all([
      appendRecordingEvent(clickEvent),
      appendRecordingEvent({ ...clickEvent, timestamp: 2 }),
      appendRecordingEvent({ ...clickEvent, timestamp: 3 }),
    ]);

    const state = await getRecordingState();
    expect(state.events.map((e) => e.timestamp)).toEqual([1, 2, 3]);
  });

  it('a failed write rejects to its caller, and later appends still work', async () => {
    const chromeApi = fakeChromeStorage();
    const write = chromeApi.storage.session.set;
    let failNext = false;
    chromeApi.storage.session.set = async (values: Record<string, unknown>) => {
      if (failNext) {
        failNext = false;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      await write(values);
    };
    (globalThis as any).chrome = chromeApi;

    await startRecording('https://x.test/*');
    failNext = true;
    // Surfaced rather than swallowed: a silent failure here is a recording that
    // looks healthy and exports short.
    await expect(appendRecordingEvent(clickEvent)).rejects.toThrow(/quota/i);
    // And one bad write must not poison the queue for everything after it.
    await appendRecordingEvent({ ...clickEvent, timestamp: 2 });
    const state = await getRecordingState();
    expect(state.events.map((e) => e.timestamp)).toEqual([2]);
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
