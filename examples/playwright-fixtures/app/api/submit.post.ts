import { defineEventHandler, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  await readBody(event);
  return { ok: true };
});
