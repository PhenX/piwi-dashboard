import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks PostgreSQL when PIWI_DATABASE_URL is set; clear it so
// the handler modules under test load the SQLite schema.
delete process.env.PIWI_DATABASE_URL;
const { resolveRunBranch, resolveRunPrNumber } = await import('../../server/utils/run-branch');
const { selectBaselineRun } = await import('../../server/utils/branch-baseline');
const { resolveDefaultBranch } = await import('../../server/utils/scm/default-branch');
const { FALLBACK_DEFAULT_BRANCH } = await import('../../server/utils/scm/git-url');

let db: ReturnType<typeof drizzle<typeof schema>>;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function seedProject(id: number, defaultBranch: string | null = null) {
  await db
    .insert(schema.projects)
    .values({ id, name: `project-${id}`, defaultBranch })
    .onConflictDoNothing();
}

async function seedRun(opts: {
  projectId: number;
  status: string;
  branch: string | null;
  daysAgo: number;
  isFullRun?: number;
}): Promise<number> {
  const [row] = await db
    .insert(schema.testRuns)
    .values({
      projectId: opts.projectId,
      status: opts.status,
      startTime: daysAgo(opts.daysAgo),
      branch: opts.branch,
      isFullRun: opts.isFullRun ?? 1,
    })
    .returning({ id: schema.testRuns.id });
  return row!.id;
}

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
});

describe('resolveRunBranch', () => {
  test('reads scm.branch, trims, and treats HEAD as unknown', () => {
    expect(resolveRunBranch({ scm: { branch: 'feature/x' } })).toBe('feature/x');
    expect(resolveRunBranch({ scm: { branch: '  main  ' } })).toBe('main');
    expect(resolveRunBranch({ scm: { branch: 'HEAD' } })).toBeNull();
    expect(resolveRunBranch({ scm: {} })).toBeNull();
    expect(resolveRunBranch(null)).toBeNull();
  });
});

describe('resolveRunPrNumber', () => {
  test('parses a numeric PR number, rejecting non-numeric', () => {
    expect(resolveRunPrNumber({ scm: { prNumber: '42' } })).toBe(42);
    expect(resolveRunPrNumber({ scm: { prNumber: 7 } })).toBe(7);
    expect(resolveRunPrNumber({ scm: { prNumber: 'x' } })).toBeNull();
    expect(resolveRunPrNumber({ scm: {} })).toBeNull();
  });
});

describe('resolveDefaultBranch', () => {
  test('prefers the explicit project setting', async () => {
    await seedProject(10, 'develop');
    const [project] = await db
      .select({ id: schema.projects.id, defaultBranch: schema.projects.defaultBranch })
      .from(schema.projects)
      .where(eq(schema.projects.id, 10));
    expect(await resolveDefaultBranch(db as any, project!, { defaultBranch: 'ignored' })).toBe('develop');
  });

  test('falls back to the reporter metadata hint, then to main', async () => {
    await seedProject(11, null);
    const [project] = await db
      .select({ id: schema.projects.id, defaultBranch: schema.projects.defaultBranch })
      .from(schema.projects)
      .where(eq(schema.projects.id, 11));
    expect(await resolveDefaultBranch(db as any, project!, { defaultBranch: 'trunk' })).toBe('trunk');
    expect(await resolveDefaultBranch(db as any, project!, {})).toBe(FALLBACK_DEFAULT_BRANCH);
  });
});

describe('selectBaselineRun', () => {
  test('prefers a same-branch passing run over an older default-branch one', async () => {
    await seedProject(1, 'main');
    await seedRun({ projectId: 1, status: 'passed', branch: 'main', daysAgo: 10 });
    const sameBranch = await seedRun({ projectId: 1, status: 'passed', branch: 'feature/a', daysAgo: 5 });

    const baseline = await selectBaselineRun(db as any, {
      projectId: 1,
      before: daysAgo(0),
      branch: 'feature/a',
      defaultBranch: 'main',
    });
    expect(baseline?.id).toBe(sameBranch);
  });

  test('falls back to the default branch when the branch has no history', async () => {
    await seedProject(2, 'main');
    const onMain = await seedRun({ projectId: 2, status: 'passed', branch: 'main', daysAgo: 8 });

    const baseline = await selectBaselineRun(db as any, {
      projectId: 2,
      before: daysAgo(0),
      branch: 'feature/fresh',
      defaultBranch: 'main',
    });
    expect(baseline?.id).toBe(onMain);
  });

  test('an unknown branch keeps branch-blind behavior (most recent passing)', async () => {
    await seedProject(3, 'main');
    await seedRun({ projectId: 3, status: 'passed', branch: 'main', daysAgo: 9 });
    const newest = await seedRun({ projectId: 3, status: 'passed', branch: 'feature/z', daysAgo: 2 });

    const baseline = await selectBaselineRun(db as any, {
      projectId: 3,
      before: daysAgo(0),
      branch: null,
      defaultBranch: 'main',
    });
    expect(baseline?.id).toBe(newest);
  });

  test('returns null when there is no passing run before the target', async () => {
    await seedProject(4, 'main');
    await seedRun({ projectId: 4, status: 'failed', branch: 'main', daysAgo: 3 });
    const baseline = await selectBaselineRun(db as any, {
      projectId: 4,
      before: daysAgo(0),
      branch: 'main',
      defaultBranch: 'main',
    });
    expect(baseline).toBeNull();
  });
});
