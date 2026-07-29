import { describe, it, expect, beforeEach } from 'vitest';
import { ensureSessionAccess, resetSessionAccessForTests } from '../../src/shared/session-access.js';

let sent: Array<{ type: string }>;
let behaviour: () => unknown;

beforeEach(() => {
  resetSessionAccessForTests();
  sent = [];
  behaviour = () => ({ ok: true });
  (globalThis as any).chrome = {
    runtime: {
      sendMessage: async (msg: { type: string }) => {
        sent.push(msg);
        return behaviour();
      },
    },
  };
});

describe('ensureSessionAccess', () => {
  it('pings the worker so it wakes and applies the wider access level', async () => {
    await ensureSessionAccess();
    expect(sent).toEqual([{ type: 'piwi-ping' }]);
  });

  it('pings only once per document, however many callers await it', async () => {
    await Promise.all([ensureSessionAccess(), ensureSessionAccess(), ensureSessionAccess()]);
    await ensureSessionAccess();
    expect(sent).toHaveLength(1);
  });

  it('resolves rather than rejecting when the worker is unreachable', async () => {
    behaviour = () => {
      throw new Error('Receiving end does not exist');
    };
    // Callers use this as a gate before reading storage — throwing here would
    // take down the whole panel for a condition that is usually transient.
    await expect(ensureSessionAccess()).resolves.toBeUndefined();
  });
});
