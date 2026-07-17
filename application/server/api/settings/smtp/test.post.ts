import { requireAuth } from '../../../utils/auth';
import { isEmailConfigured, sendEmail, renderTestEmail } from '../../../utils/email';
import { z } from 'zod';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Send test email',
    description:
      'Sends a test email via the env-configured SMTP settings to verify the configuration. Requires administrator role.',
    'x-required-roles': ['administrator'],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['to'],
            properties: { to: { type: 'string', format: 'email' } },
          },
        },
      },
    },
  },
});

const schema = z.object({ to: z.string().email() });

export default eventHandler(async (event) => {
  await requireAuth(event);

  if (!isEmailConfigured()) {
    throw createError({ statusCode: 503, message: 'SMTP is not configured' });
  }

  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Invalid request: to must be a valid email address' });
  }

  const { to } = parsed.data;
  const { html, text } = renderTestEmail(to);

  try {
    await sendEmail({ to, subject: 'Test email — Piwi Dashboard', html, text });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[smtp/test] Failed to send test email:', message);
    return { success: false, error: message };
  }
});
