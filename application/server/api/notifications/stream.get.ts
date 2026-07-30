import { eq, and, or, isNull, lte } from 'drizzle-orm';
import { requireAuth, isAuthEnabled } from '../../utils/auth';
import { getProjectScope, scopeAllows } from '../../utils/project-access';
import { runEventBus } from '../../utils/run-events';
import { createSSEEndpoint } from '../../utils/sse';
import { getDatabase } from '../../database';
import { notificationChannels, subscriptions } from '../../database/schema';

export default eventHandler(async (event) => {
  const user = await requireAuth(event);

  // With auth disabled the instance is single-user, so there is no cross-project
  // boundary to enforce — stream every notification as before.
  if (!isAuthEnabled()) {
    return createSSEEndpoint(event, (controller, encoder) =>
      runEventBus.subscribeNotifications((notificationEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(notificationEvent)}\n\n`));
        } catch {
          // Stream closed — unsubscribe is handled by SSE helper
        }
      }),
    );
  }

  const db = await getDatabase();
  const now = new Date();

  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .innerJoin(notificationChannels, eq(subscriptions.channelId, notificationChannels.id))
    .where(
      and(
        eq(notificationChannels.type, 'browser'),
        eq(subscriptions.userId, user.id),
        eq(subscriptions.active, true),
        or(isNull(subscriptions.mutedUntil), lte(subscriptions.mutedUntil, now)),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    setResponseHeaders(event, { 'Content-Type': 'text/event-stream' });
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }

  // Compute the caller's project scope once for the life of the connection, and
  // never stream an event for a project they cannot access.
  const scope = await getProjectScope(db, user);

  return createSSEEndpoint(event, (controller, encoder) => {
    return runEventBus.subscribeNotifications((notificationEvent) => {
      const projectId = notificationEvent.projectId as number | undefined;
      if (typeof projectId === 'number' && !scopeAllows(scope, projectId)) return;
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(notificationEvent)}\n\n`));
      } catch {
        // Stream closed — unsubscribe is handled by SSE helper
      }
    });
  });
});
