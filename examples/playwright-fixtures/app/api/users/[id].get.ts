import { createError, defineEventHandler, getRouterParam } from 'h3';

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'));
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  }
  return { id, name: `User ${id}` };
});
