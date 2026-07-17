import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { deleteLink } from '#shared/handlers/links';

defineRouteMeta({
  openAPI: {
    tags: ['Links'],
    summary: 'Delete an entity link',
    description: 'Remove an entity link by ID.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid link ID' });
  }

  try {
    const db = await getDatabase();
    return await deleteLink(db, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete link';
    const statusCode = message === 'Link not found' ? 404 : 400;
    throw createError({ statusCode, message });
  }
});
