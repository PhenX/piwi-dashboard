#!/usr/bin/env node
/**
 * Seeds the local dev SQLite database from the demo seed SQL.
 *
 * Usage (from application/):
 *   node scripts/seed-dev-from-demo.mjs
 *
 * The dev server must NOT be running while this script runs (DB lock).
 * The script is idempotent: existing rows are skipped on conflict.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createClient } = require('@libsql/client');

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '../public/demo/seed.sql');
const dbPath = join(__dirname, '../.data/piwi.db');

const sql = readFileSync(sqlPath, 'utf8');
const db = createClient({ url: `file:${dbPath}` });

/**
 * Split a SQL script into statements on `;`, ignoring semicolons that sit
 * inside single-quoted string literals (e.g. a user-agent like
 * `Mozilla/5.0 (iPhone; CPU ...)` or a commit message) and dropping `--` line
 * comments, which the seed uses as section headers. A naive `split(';')`
 * shatters the quoted INSERTs, and a statement that keeps its leading comment
 * no longer starts with `INSERT INTO` — either way rows vanish without an
 * error, so both are handled here rather than by the caller's filter.
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
    if (!inString && ch === '-' && script[i + 1] === '-') {
      const eol = script.indexOf('\n', i);
      if (eol === -1) break;
      i = eol - 1;
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

// The seed ends with a block that shifts every timestamp from the generator's
// fixed anchor to load time, so "2 hours ago" reads as 2 hours ago in the dev
// DB too. It is the only non-INSERT part this script runs — the surrounding
// DDL builds the demo SPA's in-browser database, while the dev schema comes
// from the Drizzle migrations.
const REBASE_START = 'CREATE TEMP TABLE _rebase';
const rebaseAt = sql.indexOf(REBASE_START);
if (rebaseAt === -1) throw new Error(`no timestamp rebase block in ${sqlPath} — regenerate it with app:seed:demo`);

// Data rows are `INSERT INTO … VALUES (…)`. The seed's schema section also
// carries `INSERT INTO … SELECT` statements that copy rows into the `__new_*`
// tables of SQLite's table-rebuild dance; those belong to the demo SPA's own
// schema build and have no counterpart here.
const statements = splitSqlStatements(sql.slice(0, rebaseAt))
  .map((s) => s.trim())
  .filter((s) => s.startsWith('INSERT INTO') && /\bVALUES\s*\(/i.test(s));

const rebaseStatements = splitSqlStatements(sql.slice(rebaseAt))
  .map((s) => s.trim())
  .filter((s) => /^(CREATE TEMP TABLE|UPDATE|DROP TABLE)\b/.test(s));

console.log(`Seeding ${statements.length} INSERT statements into ${dbPath}...`);
let ok = 0,
  existing = 0,
  skip = 0;
for (const stmt of statements) {
  // Use OR IGNORE to be idempotent
  const idempotent = stmt.replace(/^INSERT INTO/, 'INSERT OR IGNORE INTO');
  await db
    .execute(idempotent)
    .then((res) => (res.rowsAffected > 0 ? ok++ : existing++))
    .catch((e) => {
      skip++;
      console.error(' skip:', e.message);
    });
}

// A partial load leaves the dev DB missing whole projects and runs, which shows
// up as an empty or wrong-looking screen rather than an error.
if (skip > 0) {
  console.error(`Done. ${ok} inserted, ${skip} failed — the dev database is incomplete.`);
  process.exit(1);
}

// The rebase adds a fixed delta to every timestamp, so it may only run over a
// load that brought in the whole seed. Re-running it against rows that already
// carry a shift would push them into the future.
if (existing > 0) {
  console.log(`Done. ${ok} inserted, ${existing} already present — timestamps left as they are.`);
  console.log('Delete .data/piwi.db and re-run to reseed with timestamps rebased to now.');
} else {
  console.log(`Rebasing timestamps to now (${rebaseStatements.length} statements)...`);
  for (const stmt of rebaseStatements) await db.execute(stmt);
  console.log(`Done. ${ok} inserted, timestamps rebased to now.`);
}
