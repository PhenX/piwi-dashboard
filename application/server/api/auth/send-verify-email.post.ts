import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { mintAccountToken } from '../../utils/account-tokens';
import { isEmailConfigured, sendEmail, renderVerifyEmail } from '../../utils/email';

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Send email verification link',
    description: "Sends a verification link to the authenticated user's email address.",
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  if (!user.email) throw createError({ statusCode: 400, message: 'No email address on this account' });
  if (!isEmailConfigured()) throw createError({ statusCode: 503, message: 'SMTP is not configured' });

  const db = await getDatabase();
  const token = await mintAccountToken(db, user.id, 'verify');
  const { html, text } = renderVerifyEmail(token);

  try {
    await sendEmail({ to: user.email, subject: 'Verify your email — Piwi Dashboard', html, text });
    return { success: true };
  } catch {
    throw createError({ statusCode: 500, message: 'Failed to send verification email' });
  }
});
