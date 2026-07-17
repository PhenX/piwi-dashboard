import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { readAiSettings } from '../../utils/ai-settings';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get AI settings',
    description:
      'Returns full AI configuration: per-role provider settings (diagnosis, research, embedding), API key presence, auto-diagnose toggle, custom instructions, and SCM token presence. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();
  return readAiSettings(db);
});
