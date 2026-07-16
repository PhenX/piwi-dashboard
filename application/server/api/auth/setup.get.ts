import { Role } from '#shared/types';
import { isAuthEnabled, needsInitialSetup } from '../../utils/auth';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Initial setup status',
    description:
      'Reports whether the first-admin setup form should be shown — true only when auth is enabled and the users table is empty.',
    'x-required-roles': REQUIRED_ROLES,
    security: [],
  },
});

export default eventHandler(async (event) => {
  const needsSetup = isAuthEnabled(event) && (await needsInitialSetup());
  return { needsSetup };
});
