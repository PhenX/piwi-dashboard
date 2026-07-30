import { and, eq, lte, lt } from 'drizzle-orm';
import { notificationDeliveries, notificationChannels, users } from '../../database/schema';
import { sendEmail, renderRunNotificationEmail, renderNewClusterEmail, isEmailConfigured } from '../email';
import { decryptSecret, getEncryptionKey } from '../crypto';
import { safeFetch } from '../safe-fetch';
import type {
  NotificationEvent,
  NotificationPayload,
  RunFinishedPayload,
  ClusterNewPayload,
} from '#shared/notification-events';
import { renderEventSubject } from '#shared/notification-events';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60, 240]; // progressive backoff

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendToEmail(config: Record<string, unknown>, event: NotificationEvent, payload: NotificationPayload) {
  const to = config.address as string;
  if (!to) throw new Error('No email address configured');
  if (!isEmailConfigured()) throw new Error('SMTP not configured');

  let html: string;
  let text: string;

  if (event.startsWith('run.')) {
    const p = payload as RunFinishedPayload;
    ({ html, text } = renderRunNotificationEmail({
      projectName: p.projectName,
      runId: p.runId,
      status: p.status,
      totalTests: p.totalTests,
      failedTests: p.failedTests,
      branch: p.branch,
      topFailures: p.topFailures,
    }));
  } else if (event === 'cluster.new') {
    const p = payload as ClusterNewPayload;
    ({ html, text } = renderNewClusterEmail({
      projectName: p.projectName,
      clusterId: p.clusterId,
      signature: p.signature,
      sampleErrorExcerpt: p.sampleErrorExcerpt,
      affectedCases: p.affectedCases,
    }));
  } else {
    const subject = renderEventSubject(event, payload);
    html = `<p>${subject}</p>`;
    text = subject;
  }

  await sendEmail({ to, subject: renderEventSubject(event, payload), html, text });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendToSlack(config: Record<string, unknown>, event: NotificationEvent, payload: NotificationPayload) {
  const webhookUrl = config.webhookUrl as string;
  if (!webhookUrl) throw new Error('No Slack webhook URL configured');

  const text = renderEventSubject(event, payload);
  let emoji = ':bell:';
  if (event.startsWith('run.failed')) emoji = ':x:';
  else if (event === 'cluster.new') emoji = ':bug:';
  else if (event === 'flakiness.spike') emoji = ':game_die:';

  const base = process.env.PIWI_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3000';
  // Slack section text is capped at 3000 chars; keep excerpts short.
  const slackExcerpt = (s: string) => (s.length > 600 ? s.slice(0, 600) + '…' : s);

  const blocks: Record<string, unknown>[] = [{ type: 'section', text: { type: 'mrkdwn', text: `${emoji} *${text}*` } }];

  if (event.startsWith('run.')) {
    const p = payload as RunFinishedPayload;
    for (const f of p.topFailures ?? []) {
      const link = f.testCaseId ? `<${base}/test-cases/${f.testCaseId}|${f.title}>` : f.title;
      const excerpt = f.errorExcerpt ? `\n\`\`\`${slackExcerpt(f.errorExcerpt)}\`\`\`` : '';
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• *${link}*${excerpt}` } });
    }
  } else if (event === 'cluster.new') {
    const p = payload as ClusterNewPayload;
    const parts: string[] = [];
    if (p.affectedCases) parts.push(`${p.affectedCases} affected test${p.affectedCases === 1 ? '' : 's'}`);
    if (p.sampleErrorExcerpt) parts.push(`\`\`\`${slackExcerpt(p.sampleErrorExcerpt)}\`\`\``);
    parts.push(`<${base}/failure-clusters/${p.clusterId}|View cluster>`);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: parts.join('\n') } });
  }

  const body = { text: `${emoji} *${text}*`, blocks };

  const res = await safeFetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendToWebhook(config: Record<string, unknown>, event: NotificationEvent, payload: NotificationPayload) {
  const url = config.url as string;
  if (!url) throw new Error('No webhook URL configured');

  const encryptedSecret = config.secret as string | undefined;
  const secret = encryptedSecret ? decryptSecret(encryptedSecret, getEncryptionKey()) : null;

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (secret) {
    // HMAC-SHA256 signature in X-Piwi-Signature
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    headers['X-Piwi-Signature'] = `sha256=${sig}`;
  }

  const res = await safeFetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
}

/**
 * Process pending deliveries that are due now (scheduledFor <= now, status = 'pending', attempts < MAX).
 * Returns the number of deliveries processed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sweepOutbox(db: LibSQLDatabase<any>): Promise<{ sent: number; failed: number }> {
  const now = new Date();
  let sent = 0;
  let failed = 0;

  const due = await db
    .select({ d: notificationDeliveries, c: notificationChannels })
    .from(notificationDeliveries)
    .innerJoin(notificationChannels, eq(notificationDeliveries.channelId, notificationChannels.id))
    .where(
      and(
        eq(notificationDeliveries.status, 'pending'),
        lte(notificationDeliveries.scheduledFor, now),
        lt(notificationDeliveries.attempts, MAX_ATTEMPTS),
      ),
    );

  for (const { d, c } of due) {
    const config = (c.config ?? {}) as Record<string, unknown>;
    const event = d.event as NotificationEvent;
    const payload = (d.payload ?? {}) as NotificationPayload;

    try {
      if (c.type === 'personal_email') {
        if (!c.userId) throw new Error('Personal email channel has no owner');
        const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, c.userId));
        if (!owner?.email) throw new Error('Account has no email address');
        await sendToEmail({ address: owner.email }, event, payload);
      } else if (c.type === 'email') await sendToEmail(config, event, payload);
      else if (c.type === 'slack') await sendToSlack(config, event, payload);
      else if (c.type === 'webhook') await sendToWebhook(config, event, payload);
      else if (c.type === 'browser') {
        /* Delivered via SSE — the notification/stream endpoint handles this channel type */
      } else throw new Error(`Unknown channel type: ${c.type}`);

      await db
        .update(notificationDeliveries)
        .set({ status: 'sent', sentAt: now, attempts: (d.attempts ?? 0) + 1, error: null })
        .where(eq(notificationDeliveries.id, d.id));
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = (d.attempts ?? 0) + 1;
      const nextBackoffMs = (BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] ?? 240) * 60 * 1000;
      const nextScheduled = new Date(now.getTime() + nextBackoffMs);
      const isFinal = attempts >= MAX_ATTEMPTS;

      await db
        .update(notificationDeliveries)
        .set({
          status: isFinal ? 'failed' : 'pending',
          attempts,
          error: message,
          scheduledFor: isFinal ? d.scheduledFor : nextScheduled,
        })
        .where(eq(notificationDeliveries.id, d.id));

      console.error(`[notifications] Delivery ${d.id} failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${message}`);
      failed++;
    }
  }

  return { sent, failed };
}
