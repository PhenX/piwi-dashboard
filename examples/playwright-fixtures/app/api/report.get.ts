import { consola } from 'consola';
import { defineEventHandler } from 'h3';

// Logs one warning and one error (with a stack) through consola — the
// instrumentation only captures consola calls, not bare console.* output.
export default defineEventHandler(() => {
  consola.withTag('inventory').warn('demo: low stock for item Alpha');
  consola.error(new Error('demo: price sync failed, using cached prices'));
  return { items: 3, cached: true };
});
