import type { H3Event } from 'h3';
import { apiError } from './api-error';
import { buildExport } from '#shared/export/build';
import { EXPORT_FORMATS, type ExportBundle, type ExportFormat } from '#shared/export/types';
import { sanitizeFilename } from './sanitize-filename';
import { resolvePublicBaseUrl } from './oauth-helpers';
import { resolveExportBudget, serverAssetReader } from './export-assets';

/** The requested format, defaulting to HTML. */
export function requireExportFormat(event: H3Event): ExportFormat {
  const raw = getQuery(event).format;
  if (raw == null || raw === '') return 'html';
  const value = String(raw).toLowerCase();
  if (!(EXPORT_FORMATS as readonly string[]).includes(value)) {
    throw apiError({
      statusCode: 400,
      message: `Unsupported export format '${value}'. Use one of: ${EXPORT_FORMATS.join(', ')}.`,
    });
  }
  return value as ExportFormat;
}

/** Absolute URL of the page this export came from, recorded in the report. */
export function exportSourceUrl(event: H3Event, path: string): string {
  const siteUrl = (useRuntimeConfig(event).public as { siteUrl?: string })?.siteUrl;
  const url = getRequestURL(event);
  return `${resolvePublicBaseUrl(siteUrl, `${url.protocol}//${url.host}`)}${path}`;
}

export function exportPiwiVersion(event: H3Event): string | null {
  return ((useRuntimeConfig(event).public as { appVersion?: string })?.appVersion as string) || null;
}

/** Build the file and write it to the response. */
export async function sendExport(event: H3Event, bundle: ExportBundle, format: ExportFormat, id: number) {
  // `print=1` is the PDF path: the browser has to *render* the report so its
  // own print dialog can turn it into a PDF. Attaching it would download a file
  // nobody asked for instead.
  const print = format === 'html' && getQuery(event).print === '1';

  const built = await buildExport(bundle, format, id, {
    reader: serverAssetReader,
    budget: resolveExportBudget(),
    print,
  });

  setResponseHeader(event, 'Content-Type', built.contentType);
  setResponseHeader(event, 'Content-Length', built.bytes.length);
  setResponseHeader(
    event,
    'Content-Disposition',
    print ? 'inline' : `attachment; filename="${sanitizeFilename(built.fileName)}"`,
  );
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
  setResponseHeader(event, 'Cache-Control', 'no-store');
  if (print) {
    // Rendered in the dashboard's own origin, so keep it in a unique origin —
    // `allow-modals` is what lets the document call window.print().
    setResponseHeader(event, 'Content-Security-Policy', 'sandbox allow-scripts allow-modals');
  }

  return Buffer.from(built.bytes);
}
