import { eq, and, or, isNull } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { optionalIntQuery } from '../../utils/query-params';
import { subscriptions, notificationChannels } from '../../database/schema';
import { requireAuth } from '../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'List subscriptions',
    description: "Returns the current user's subscriptions plus global (admin-managed) ones.",
    'x-required-roles': [],
    parameters: [{ name: 'projectId', in: 'query', schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();

  const projectId = optionalIntQuery(event, 'projectId', { min: 1 }) ?? null;

  const rows = await db
    .select({ sub: subscriptions, channel: notificationChannels })
    .from(subscriptions)
    .innerJoin(notificationChannels, eq(subscriptions.channelId, notificationChannels.id))
    .where(
      and(
        or(isNull(subscriptions.userId), eq(subscriptions.userId, user.id)),
        projectId ? eq(subscriptions.projectId, projectId) : undefined,
      ),
    );

  return {
    items: rows.map(({ sub, channel }) => ({
      id: sub.id,
      userId: sub.userId,
      projectId: sub.projectId,
      events: sub.events,
      filters: sub.filters,
      mode: sub.mode,
      digestAt: sub.digestAt,
      mutedUntil: sub.mutedUntil,
      active: sub.active,
      createdAt: sub.createdAt,
      channel: { id: channel.id, name: channel.name, type: channel.type },
    })),
  };
});
