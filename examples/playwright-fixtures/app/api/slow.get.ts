import { defineEventHandler } from 'h3';

// Deliberately slow so the dashboard's Slow endpoints tab has something to show.
export default defineEventHandler(async () => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { ok: true };
});
