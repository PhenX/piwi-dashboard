import { requireAuth } from '../../utils/auth';
import { getSmtpConfig } from '../../utils/email';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get SMTP configuration',
    description:
      'Returns SMTP configuration display info (host, port, from address, configured status). Password is never returned. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const cfg = getSmtpConfig();
  return {
    host: cfg.host || null,
    port: cfg.port,
    user: cfg.user || null,
    from: cfg.from || null,
    fromName: cfg.fromName || null,
    hasPassword: cfg.hasPassword,
    secure: cfg.secure,
    configured: cfg.configured,
    envManaged: true,
  };
});
