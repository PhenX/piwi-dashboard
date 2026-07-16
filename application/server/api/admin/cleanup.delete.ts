import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { Role } from '#shared/types';
import { deleteRunsOlderThan, reclaimSpace, sweepOrphans } from '../../utils/retention';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Cleanup old test data',
    description:
      'Deletes test runs older than a specified number of days, including associated files, traces, and reports. Optionally runs a full VACUUM (SQLite) to return freed space to the filesystem. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              olderThanDays: { type: 'integer', description: 'Delete runs older than this many days' },
              vacuum: {
                type: 'boolean',
                description: 'Run a blocking full VACUUM after cleanup (SQLite only; ignored on PostgreSQL)',
              },
            },
            required: ['olderThanDays'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const body = await readBody(event);

  const olderThanDays = parseInt(body?.olderThanDays ?? '0', 10);

  if (!olderThanDays || olderThanDays < 1) {
    throw createError({
      statusCode: 400,
      message: 'olderThanDays must be a positive integer',
    });
  }

  const db = await getDatabase();

  const { deletedRuns } = await deleteRunsOlderThan(db, olderThanDays);
  await sweepOrphans(db);
  const space = await reclaimSpace(db, { full: body?.vacuum === true });

  return { success: true, deletedRuns, spaceReclaim: space.note };
});
