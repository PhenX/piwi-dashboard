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
const { createClient } = require('/home/user/platform/node_modules/@libsql/client');

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '../public/demo/seed.sql');
const dbPath = join(__dirname, '../.data/piwi.db');

const sql = readFileSync(sqlPath, 'utf8');
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

const statements = splitSqlStatements(sql)
  .map((s) => s.trim())
  .filter((s) => s.startsWith('INSERT INTO'));

console.log(`Seeding ${statements.length} INSERT statements into ${dbPath}...`);
let ok = 0,
  skip = 0;
for (const stmt of statements) {
  // Use OR IGNORE to be idempotent
  const idempotent = stmt.replace(/^INSERT INTO/, 'INSERT OR IGNORE INTO');
  await db
    .execute(idempotent)
    .then(() => ok++)
    .catch((e) => {
      skip++;
      console.error(' skip:', e.message);
    });
}
console.log(`Done. ${ok} inserted, ${skip} skipped.`);
