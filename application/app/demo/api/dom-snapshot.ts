/**
 * Canned DOM snapshot for demo mode. The server renders DOM snapshots from
 * trace ZIPs with node-only code (zlib), which cannot run in the demo's
 * browser sandbox — so the demo serves this pre-rendered result instead.
 *
 * The content below is the REAL output of `extractDomSnapshot` over the
 * committed demo trace (`public/demo/traces/checkout-pay-timeout.zip`).
 * Regenerate it after re-recording the trace (scripts/record-demo-media.mjs)
 * by running `extractDomSnapshot(await parseTraceEvents(zip), 200000)` and
 * pasting the JSON here.
 */
import { and, eq } from 'drizzle-orm';
import { files, testRunsCases } from '~~/server/database/schema.sqlite';
import { renderAriaSnapshotHtml } from '~~/server/utils/dom-snapshot-aria';
import { getDemoDb } from '../db.client';

const CHECKOUT_DOM_SNAPSHOT = {
  status: 'ok' as const,
  html: `<!DOCTYPE html>
<html lang="en"><head><base href="http://127.0.0.1:36203/checkout">
<meta charset="utf-8">
<title>Acme Shop — Checkout</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f4f4f5; margin: 0; padding: 24px; }
  .card { max-width: 380px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  h1 { font-size: 18px; margin: 0 0 16px; }
  label { display: block; font-size: 13px; color: #52525b; margin: 12px 0 4px; }
  input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d4d4d8; border-radius: 6px; font-size: 14px; }
  button { margin-top: 18px; width: 100%; padding: 10px; border: 0; border-radius: 6px; background: #18181b; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  .error { display: none; margin-top: 14px; padding: 10px; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-size: 13px; }
</style>
</head>
<body>
<div class="card">
  <h1>Checkout</h1>
  <div>Total: <strong>$42.00</strong></div>
  <label for="email">Email</label>
  <input id="email" type="email" placeholder="you@example.com">
  <label for="card">Card number</label>
  <input id="card" inputmode="numeric" placeholder="4242 4242 4242 4242">
  <button id="pay">Pay</button>
  <div class="error" id="error" style="display: block;">Payment failed: the server returned an error (HTTP 500). Please try again.</div>
</div>


</body></html>`,
  truncated: false,
  snapshotName: 'after@call@18',
};

/**
 * GET /api/test-runs/:id/cases/:caseId/dom-snapshot — mirrors the server's
 * `resolveCaseDomSnapshot`: trace-derived DOM by default, the ARIA tree as a
 * fallback or on demand (`?source=aria`), and `availableSources` so the picker
 * can offer the view toggle. The trace path can't run in the browser (node-only
 * zlib), so the one demo case carrying the committed trace returns the
 * pre-rendered result; every failed case's seeded `ariaSnapshot` renders with
 * the same browser-safe renderer the real app uses.
 */
export async function apiGetDemoDomSnapshot(testRunsCaseId: number, query?: URLSearchParams): Promise<unknown> {
  const db = await getDemoDb();
  const [traceRows, caseRows] = await Promise.all([
    db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.testRunsCaseId, testRunsCaseId), eq(files.type, 'trace')))
      .limit(1),
    db
      .select({ aria: testRunsCases.ariaSnapshot })
      .from(testRunsCases)
      .where(eq(testRunsCases.id, testRunsCaseId))
      .limit(1),
  ]);

  const hasTrace = traceRows.length > 0;
  const ariaHtml = caseRows[0]?.aria ? renderAriaSnapshotHtml(caseRows[0].aria) : null;
  const availableSources = [...(hasTrace ? ['dom'] : []), ...(ariaHtml ? ['aria'] : [])];
  const source = query?.get('source');
  const asAria = () => ({
    status: 'ok' as const,
    html: ariaHtml!,
    truncated: false,
    snapshotName: 'aria-fallback',
    source: 'aria' as const,
    availableSources,
  });

  if (source === 'aria' && ariaHtml) return asAria();
  if (hasTrace) return { ...CHECKOUT_DOM_SNAPSHOT, source: 'dom', availableSources };
  if (ariaHtml) return asAria();
  return { status: 'no-trace', availableSources };
}
