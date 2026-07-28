import { getDatabase } from '../database';
import { getSetupStatus } from '#shared/handlers/setup-status';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Setup and capability status',
    description:
      "Reports which of Piwi's optional capabilities show evidence of being active on this instance (results arriving, capture fixtures installed, locator healing, clustering, AI diagnosis, notifications, SCM, tags, markers, quarantine). Evidence-based rather than config-based: a configured-but-unused capability reads as inactive. Drives the Setup page's checklist.",
    'x-required-roles': [],
  },
});

export default eventHandler(async () => {
  const db = await getDatabase();
  return getSetupStatus(db);
});
