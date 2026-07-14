import { eq, sql, and } from 'drizzle-orm';
import { testRunsCases, locatorSnapshots } from '../../../../../database/schema';
import { locatorSignature as locSig } from '#shared/locator-healing';
import { Role } from '#shared/types';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../../../utils/project-access';
import type { RankedLocator } from '#shared/locator-healing.types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Save a user-picked locator for a failing test case',
    description:
      'Saves a locator picked by a user from the interactive DOM snapshot picker. The pick is associated with the failing locator call site and will appear in subsequent locator-healing responses.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run id' },
      { name: 'caseId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              failingLocator: {
                type: 'object',
                properties: {
                  method: { type: 'string' },
                  args: { type: 'object' },
                },
              },
              pickedLocator: {
                type: 'object',
                properties: {
                  locator: { type: 'string' },
                  method: { type: 'string' },
                  args: { type: 'object' },
                  score: { type: 'number' },
                },
              },
              elementTag: { type: 'string' },
              elementAttrs: { type: 'object' },
            },
          },
        },
      },
    },
    'x-required-roles': REQUIRED_ROLES,
  },
});

/**
 * Extract the source location (`file:line:col`) from a Playwright error stack
 * trace. Matches `extractErrorLocation` in `server/utils/locator-healing.ts`.
 */
function extractErrorLocation(error: string): string | null {
  const frameRe = /^\s+at (?:.*? \()?([^()\s][^()]*?):(\d+):(\d+)\)?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = frameRe.exec(error)) !== null) {
    const file = m[1]!.replace(/\\/g, '/');
    if (file.includes('node_modules') || file.startsWith('node:')) continue;
    return `${file}:${m[2]}:${m[3]}`;
  }
  return null;
}

export default eventHandler(async (event) => {
  requireRouteId(event, 'id', 'runId');
  const caseId = requireRouteId(event, 'caseId', 'caseId');

  const { db } = await requireResolvedProjectAccess(event, caseId, resolveTestRunCaseProjectId, 'Test run case');

  const body = await readBody<{
    failingLocator: { method: string; args: Record<string, unknown> };
    pickedLocator: RankedLocator;
    elementTag: string;
    elementAttrs: Record<string, string | null>;
  }>(event);

  if (!body?.pickedLocator?.locator) {
    throw createError({ statusCode: 400, message: 'Missing pickedLocator' });
  }

  const trcRows = await db
    .select({ testCaseId: testRunsCases.testCaseId, error: testRunsCases.error })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, caseId));
  const trc = trcRows[0] ?? null;

  if (!trc) throw createError({ statusCode: 404, message: 'Test run case not found' });

  const { testCaseId, error } = trc;

  const location = error ? extractErrorLocation(error) : null;

  // Compute the locator signature for fingerprint matching
  const locArgsArr = body.failingLocator.args
    ? [body.failingLocator.args].flatMap((a: unknown) => Object.values(a as Record<string, unknown>))
    : [];
  const argsFp = await locSig(body.failingLocator.method, locArgsArr);

  const pick: RankedLocator = { ...body.pickedLocator, pickedByUser: true };

  if (location) {
    const existingRows = await db
      .select({ alternatives: locatorSnapshots.alternatives })
      .from(locatorSnapshots)
      .where(and(eq(locatorSnapshots.testCaseId, testCaseId), eq(locatorSnapshots.location, location)));
    const existing = existingRows[0] ?? null;

    let alternatives: RankedLocator[];
    if (existing) {
      const parsed = JSON.parse(existing.alternatives) as RankedLocator[];
      const filtered = parsed.filter((a) => a.locator !== pick.locator);
      alternatives = [pick, ...filtered].slice(0, 10);
    } else {
      alternatives = [pick];
    }

    await db
      .insert(locatorSnapshots)
      .values({
        testCaseId,
        location,
        usedMethod: body.failingLocator.method,
        usedArgs: JSON.stringify(body.failingLocator.args),
        usedArgsFp: argsFp,
        elementTag: body.elementTag,
        elementAttrs: JSON.stringify(body.elementAttrs),
        elementText: null,
        alternatives: JSON.stringify(alternatives),
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [locatorSnapshots.testCaseId, locatorSnapshots.location],
        set: {
          usedMethod: sql`excluded.used_method`,
          usedArgs: sql`excluded.used_args`,
          usedArgsFp: sql`excluded.used_args_fp`,
          elementTag: sql`excluded.element_tag`,
          elementAttrs: sql`excluded.element_attrs`,
          alternatives: sql`excluded.alternatives`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
  } else {
    const existingRows = await db
      .select({ id: locatorSnapshots.id, alternatives: locatorSnapshots.alternatives })
      .from(locatorSnapshots)
      .where(and(eq(locatorSnapshots.testCaseId, testCaseId), eq(locatorSnapshots.usedArgsFp, argsFp)));
    const existing = existingRows[0] ?? null;

    if (existing) {
      const parsed = JSON.parse(existing.alternatives) as RankedLocator[];
      const filtered = parsed.filter((a) => a.locator !== pick.locator);
      const alternatives = [pick, ...filtered].slice(0, 10);

      await db
        .update(locatorSnapshots)
        .set({ alternatives: JSON.stringify(alternatives), lastSeenAt: new Date() })
        .where(eq(locatorSnapshots.id, existing.id));
    }
  }

  return { status: 'ok' };
});
