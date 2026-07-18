import { createError, defineEventHandler } from 'h3';

// An unhandled 500: the instrumentation drains it from Nitro's per-request
// error context, so the entry shows up even though nothing logs via consola.
export default defineEventHandler(() => {
  throw createError({ statusCode: 500, statusMessage: 'demo: inventory backend exploded' });
});
