import { isAuthEnabled } from '../auth';
import { matchAndEnqueue } from './match';
import { sweepOutbox } from './dispatch';
import { runEventBus } from '../run-events';
import type { NotificationEvent, NotificationPayload } from '#shared/notification-events';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

/**
 * Entry point: publish to the SSE notification bus for any open browser tabs,
 * then match subscriptions for the event, enqueue outbox deliveries, and
 * kick the sweeper for realtime deliveries (email/Slack/webhook).
 *
 * Browser notifications via SSE work regardless of auth being enabled;
 * the SSE endpoint handles its own authentication. The outbox path
 * (email/Slack/webhook) requires auth.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function emitNotification(
  db: LibSQLDatabase<any>,
  event: NotificationEvent,
  payload: NotificationPayload,
): Promise<void> {
  // Browser notification via SSE — always publish so any open dashboard tab
  // (even in the background) can fire a native OS notification.
  runEventBus.publishNotification({ type: event, ...payload });

  if (!isAuthEnabled()) return; // outbox path requires auth for user identity

  try {
    const enqueued = await matchAndEnqueue(db, event, payload);
    if (enqueued > 0) {
      // Best-effort immediate delivery; sweeper handles failures/retries
      sweepOutbox(db).catch((e) => console.error('[notifications] sweep after emit failed', e));
    }
  } catch (e) {
    console.error('[notifications] emitNotification failed', e);
  }
}
