import { getDatabase } from '../database';
import { appSettings } from '../database/schema';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Health check',
    description:
      'Liveness/readiness probe for containers, load balancers, and uptime monitors. Verifies the database is reachable with a lightweight query. Returns 200 when healthy, 503 when the database cannot be queried. Public.',
    'x-required-roles': REQUIRED_ROLES,
    security: [],
  },
});

export default eventHandler(async (event) => {
  try {
    const db = await getDatabase();
    await db.select({ key: appSettings.key }).from(appSettings).limit(1);
  } catch (error) {
    console.error('[health] Database check failed:', error);
    setResponseStatus(event, 503);
    return { status: 'error', database: 'unreachable' };
  }

  return { status: 'ok', database: 'ok' };
});
