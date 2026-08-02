#!/usr/bin/env node
/**
 * Seeds the local dev SQLite database from the demo seed SQL.
 *
 * Usage (from application/):
 *   node scripts/seed-dev-from-demo.mjs
 *
 * The dev server must NOT be running while this script runs (DB lock).
 * The script is idempotent: existing rows are skipped on conflict.
 *
 * Foreign keys are disabled for the load. The seed is one coherent snapshot
 * emitted in table order, not dependency order, so a child row routinely
 * precedes its parent; enforcing FKs row-by-row drops it, and then drops
 * everything hanging off it. A partially seeded database is worse than a
 * failed seed, so a row that fails for any *other* reason aborts the run.
 */

import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createClient } = require('/home/user/platform/node_modules/@libsql/client');

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '../public/demo/seed.sql');
const dbPath = join(__dirname, '../.data/piwi.db');

const sql = readFileSync(sqlPath, 'utf8');
// libsql cannot create the parent directory itself, and a missing .data/ is
// the normal state of a fresh checkout.
mkdirSync(dirname(dbPath), { recursive: true });
const db = createClient({ url: `file:${dbPath}` });

/**
 * Split a SQL script into statements on `;`, but ignore semicolons that sit
 * inside single-quoted string literals (e.g. a user-agent like
 * `Mozilla/5.0 (iPhone; CPU ...)` or a commit message). A naive `split(';')`
 * shatters those INSERTs and silently drops the data.
 */
function splitSqlStatements(script) {
  const out = [];
  let cur = '';
  let inString = false;
  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    if (ch === "'") {
      // A doubled '' inside a string is an escaped quote, not a terminator.
      if (inString && script[i + 1] === "'") {
        cur += "''";
        i++;
        continue;
      }
      inString = !inString;
      cur += ch;
      continue;
    }
    if (ch === ';' && !inString) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Statements are split on `;`, so each one carries the section comment that
 * preceded it (`-- Projects\nINSERT INTO projects …`). Strip those leading
 * comment lines before matching: testing `startsWith('INSERT INTO')` against
 * the raw text silently drops the first row of every commented section — which
 * is how project 1 and 19 of its peers went missing from the dev database.
 */
const stripLeadingComments = (s) => s.replace(/^(?:\s*--[^\n]*\n)+/, '').trim();

// seed.sql carries the migration DDL as well as the data, and two kinds of
// INSERT in it belong to the schema rather than the seed:
//   - `INSERT INTO __new_<table> SELECT …` — SQLite rebuilds a table by copying
//     rows into `__new_<table>` and renaming it over the original.
//   - the `network_requests` backfill, which reads a JSON column later dropped.
// Both target a shape the migrated dev DB no longer has. drizzle-kit applies
// the migrations separately, so only `INSERT … VALUES` rows are seed data.
const statements = splitSqlStatements(sql)
  .map(stripLeadingComments)
  .filter((s) => /^INSERT INTO/.test(s) && !/^INSERT INTO\s+`?__new_/.test(s) && /\bVALUES\b/i.test(s));

/**
 * The seed's timestamps are anchored to a fixed generation-time window, and the
 * tail of seed.sql shifts them all to load time (`_rebase` temp table). Running
 * only the INSERTs leaves a database dated whenever the seed was generated —
 * which is how the dev data drifted to "about 1 year ago" and made every
 * screenshot taken against it look abandoned.
 *
 * The shift is relative, so it must run exactly once per load: it is applied
 * only when rows were actually inserted, never on a re-run over a seeded DB.
 */
const rebaseStart = sql.indexOf('CREATE TEMP TABLE _rebase');
const rebaseEnd = sql.indexOf('DROP TABLE _rebase;');
if (rebaseStart === -1 || rebaseEnd === -1) {
  console.error('seed.sql has no _rebase block — regenerate it with `npm run app:seed:demo`.');
  process.exit(1);
}
const rebaseStatements = splitSqlStatements(sql.slice(rebaseStart, rebaseEnd + 'DROP TABLE _rebase;'.length))
  .map(stripLeadingComments)
  .filter(Boolean);

console.log(`Seeding ${statements.length} INSERT statements into ${dbPath}...`);
// The snapshot is emitted in table order, so children can precede parents.
// Load it with FKs off and check integrity once at the end instead.
await db.execute('PRAGMA foreign_keys = OFF');

let ok = 0,
  existing = 0;
const failures = [];
for (const stmt of statements) {
  // Use OR IGNORE to be idempotent
  const idempotent = stmt.replace(/^INSERT INTO/, 'INSERT OR IGNORE INTO');
  try {
    const res = await db.execute(idempotent);
    // OR IGNORE turns an existing row into a no-op rather than an error.
    if (res.rowsAffected === 0) existing++;
    else ok++;
  } catch (e) {
    failures.push(`${e.message}\n   in: ${stmt.slice(0, 120)}…`);
  }
}

await db.execute('PRAGMA foreign_keys = ON');
const violations = await db.execute('PRAGMA foreign_key_check');

if (ok > 0) {
  for (const stmt of rebaseStatements) {
    try {
      await db.execute(stmt);
    } catch (e) {
      failures.push(`${e.message}\n   in: ${stmt.slice(0, 120)}…`);
    }
  }
  console.log(`Rebased ${rebaseStatements.length} timestamp statements to now.`);
} else {
  console.log('Nothing inserted — skipping the timestamp rebase (it shifts relative to now).');
}

console.log(`Done. ${ok} inserted, ${existing} already present.`);

if (failures.length) {
  console.error(`\n${failures.length} statement(s) failed:`);
  for (const f of failures.slice(0, 10)) console.error(' -', f);
  if (failures.length > 10) console.error(`   …and ${failures.length - 10} more`);
}
if (violations.rows.length) {
  console.error(`\n${violations.rows.length} foreign-key violation(s) left in the database.`);
}
if (failures.length || violations.rows.length) {
  console.error('\nThe database is incomplete — fix the seed rather than developing against it.');
  process.exit(1);
}
