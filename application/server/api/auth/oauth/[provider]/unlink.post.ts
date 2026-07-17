import { requireAuth } from '../../../../utils/auth';
import { unlinkProvider } from '../../../../utils/oauth';

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Disconnect an OAuth provider',
    description:
      'Removes the OAuth provider link from the current user. Requires the account to have a password set so the user keeps a way to sign in.',
    parameters: [{ name: 'provider', in: 'path', required: true, schema: { type: 'string' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);

  const provider = getRouterParam(event, 'provider');
  if (!provider) {
    throw createError({ statusCode: 400, message: 'Provider is required' });
  }

  await unlinkProvider(user.id, provider);

  return { success: true };
});
