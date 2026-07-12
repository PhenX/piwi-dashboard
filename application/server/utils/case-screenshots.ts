/**
 * Screenshot selection for a test-run case. Real ingestion stores Playwright
 * attachments as `type='attachment'` with `subtype=<attachment name>` and
 * `label=<content type>` — a bare `files.type = 'screenshot'` filter matches
 * nothing that the upload endpoints write. This selector accepts both shapes
 * so the AI context, MCP tools, and visual diff all agree on what counts as a
 * screenshot.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { files } from '../database/schema';
import type { DrizzleDB } from '#shared/handlers/db';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

export interface ScreenshotFileRow {
  id: number;
  type: string;
  subtype: string | null;
  label: string | null;
  path: string;
}

/** True when a files row refers to a screenshot image (either storage shape). */
export function isScreenshotFileRow(row: {
  type: string;
  subtype?: string | null;
  label?: string | null;
  path: string;
}): boolean {
  if (row.type === 'screenshot') return true;
  if (row.type !== 'attachment') return false;
  if (row.subtype?.toLowerCase().startsWith('screenshot')) return true;
  if (row.label?.toLowerCase().startsWith('image/')) return true;
  const ext = row.path.toLowerCase().split('.').pop() || '';
  return IMAGE_EXTS.has(ext);
}

/** Screenshot files for one execution, newest first (the failure shot is captured last). */
export async function selectCaseScreenshots(
  db: DrizzleDB,
  testRunsCaseId: number,
  limit?: number,
): Promise<ScreenshotFileRow[]> {
  const rows = await db
    .select({ id: files.id, type: files.type, subtype: files.subtype, label: files.label, path: files.path })
    .from(files)
    .where(and(eq(files.testRunsCaseId, testRunsCaseId), inArray(files.type, ['screenshot', 'attachment'])))
    .orderBy(desc(files.id));

  const shots = rows.filter((r: ScreenshotFileRow) => isScreenshotFileRow(r));
  return limit != null ? shots.slice(0, limit) : shots;
}
