import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel (server/database/schema.ts) picks the PostgreSQL schema at
// import time when PIWI_DATABASE_URL is set, so clear it before auth.ts (which
// imports the barrel) is loaded.
delete process.env.PIWI_DATABASE_URL;
const { claimInitialSetup, releaseInitialSetup } = await import('../../server/utils/auth');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

async function freshDb(): Promise<Db> {
  const next = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(next, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  return next;
}

beforeEach(async () => {
  db = await freshDb();
});

describe('claimInitialSetup', () => {
  test('the first claim wins and a later claim loses', async () => {
    expect(await claimInitialSetup(db)).toBe(true);
    // The second claim against the already-claimed state must fail. This is the
    // guarantee POST /api/auth/setup relies on so only one administrator is ever
    // created when the check-then-create window is raced.
    expect(await claimInitialSetup(db)).toBe(false);
  });

  test('a set of concurrent claims yields exactly one winner', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => claimInitialSetup(db)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test('releasing a claim lets setup be retried', async () => {
    expect(await claimInitialSetup(db)).toBe(true);
    await releaseInitialSetup(db);
    expect(await claimInitialSetup(db)).toBe(true);
  });
});
