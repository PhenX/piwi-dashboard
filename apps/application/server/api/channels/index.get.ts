import { eq, or, isNull } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { notificationChannels, users } from '../../database/schema';
import { requireAuth } from '../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'List notification channels',
    description:
      'Returns channels owned by the current user and global (admin-managed) channels. Auto-creates a personal email channel if the user has an account email set. With authentication disabled every channel is global.',
    'x-required-roles': [],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();

  // Fetch live user record for email / emailVerified (session may be stale)
  const [dbUser] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, user.id));

  const rows = await db
    .select()
    .from(notificationChannels)
    .where(or(isNull(notificationChannels.userId), eq(notificationChannels.userId, user.id)));

  // Auto-create a personal_email channel for users who have an account email but no channel yet
  if (dbUser?.email) {
    const hasPersonal = rows.some((c) => c.type === 'personal_email' && c.userId === user.id);
    if (!hasPersonal) {
      const [created] = await db
        .insert(notificationChannels)
        .values({
          name: 'Account email',
          type: 'personal_email',
          config: {},
          userId: user.id,
          verified: Boolean(dbUser.emailVerified),
        })
        .returning();
      if (created) rows.push(created);
    }
  }

  return {
    channels: rows.map((c) => {
      // For the user's own personal_email channel: always reflect live account state
      const isOwnPersonal = c.type === 'personal_email' && c.userId === user.id;
      const config = isOwnPersonal
        ? { address: dbUser?.email ?? '' }
        : sanitizeConfig((c.config ?? {}) as Record<string, unknown>);
      const verified = isOwnPersonal ? Boolean(dbUser?.emailVerified) : Boolean(c.verified);

      return {
        id: c.id,
        name: c.name,
        type: c.type,
        userId: c.userId,
        verified,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        config,
      };
    }),
  };
});

// Config fields that are themselves credentials and must never be returned by
// the list endpoint: the webhook signing `secret`, and the Slack incoming-
// webhook URL (`webhookUrl`) — anyone holding that URL can post to the channel.
// Channels are created/deleted (no edit form re-reads these), and the list UI
// only renders an email `address` or a webhook `url`, so dropping the secrets
// doesn't affect the dashboard. Global channels are visible to every user, so
// this stops a low-privilege user from reading another team's Slack URL.
const SECRET_CONFIG_FIELDS = new Set(['webhookUrl', 'secret', 'token', 'apiKey', 'password']);

function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (!SECRET_CONFIG_FIELDS.has(key)) safe[key] = value;
  }
  return safe;
}
