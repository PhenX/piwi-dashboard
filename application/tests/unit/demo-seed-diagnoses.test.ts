import { describe, test, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allDemoSourceFiles } from '~~/app/demo/demo-scm';
import { validatePatch } from '#shared/patch';
import { FAILURE_STORIES } from '#shared/demo/failure-stories.mjs';

// Root of the Nuxt app (tests/unit/ -> ../../).
const rootDir = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

interface DiagnosisRow {
  id: number;
  cluster_id: number;
  scope: string;
  category: string;
  confidence: string;
  details: Record<string, unknown>;
}

let diagnoses: DiagnosisRow[] = [];
let versionCount = 0;
let ariaCount = 0;

beforeAll(async () => {
  // Regenerate the (gitignored) seed so the test runs against a fresh artifact.
  // The generator also rewrites the *tracked* seed.version.json (with random,
  // timestamped content), so snapshot and restore it — running tests must never
  // dirty a tracked file.
  const versionPath = `${rootDir}/public/demo/seed.version.json`;
  const savedVersion = existsSync(versionPath) ? readFileSync(versionPath) : null;
  try {
    execFileSync('node', ['scripts/generate-demo-seed.mjs'], { cwd: rootDir, stdio: 'ignore' });
  } finally {
    if (savedVersion) writeFileSync(versionPath, savedVersion);
    else rmSync(versionPath, { force: true });
  }
  const seedSql = readFileSync(`${rootDir}/public/demo/seed.sql`, 'utf-8');

  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(seedSql);

  const rows = db.exec(
    'select id, cluster_id, scope, category, confidence, details from failure_diagnoses order by id',
  )[0];
  diagnoses = (rows?.values ?? []).map((v) => ({
    id: v[0] as number,
    cluster_id: v[1] as number,
    scope: v[2] as string,
    category: v[3] as string,
    confidence: v[4] as string,
    details: JSON.parse(v[5] as string),
  }));
  versionCount = (db.exec('select count(*) from failure_diagnosis_versions')[0]?.values[0]?.[0] as number) ?? 0;
  ariaCount =
    (db.exec('select count(*) from test_runs_cases where aria_snapshot is not null')[0]?.values[0]?.[0] as number) ?? 0;
  db.close();
});

describe('seeded demo diagnoses', () => {
  test('seeds several completed cluster diagnoses (and leaves some clusters undiagnosed)', () => {
    expect(diagnoses.length).toBeGreaterThanOrEqual(3);
    // Not all clusters are diagnosed, so a visitor can trigger a live one.
    expect(diagnoses.length).toBeLessThan(FAILURE_STORIES.length);
    expect(diagnoses.every((d) => d.scope === 'cluster')).toBe(true);
  });

  test('every diagnosis carries the current details shape', () => {
    for (const d of diagnoses) {
      const det = d.details;
      expect(Array.isArray(det.pipeline), `#${d.id} pipeline`).toBe(true);
      expect((det.pipeline as unknown[]).length, `#${d.id} pipeline stages`).toBe(2);
      expect(Array.isArray(det.hypotheses), `#${d.id} hypotheses`).toBe(true);
      expect(Array.isArray(det.evidence), `#${d.id} evidence`).toBe(true);
      expect(Array.isArray(det.autoSelectedCommits), `#${d.id} autoSelectedCommits`).toBe(true);
      expect(typeof det.confidenceScore, `#${d.id} confidenceScore`).toBe('number');
    }
  });

  test('each diagnosis category is in the same family as its top hypothesis (no self-contradiction)', () => {
    // The original demo shipped an 'app-bug' diagnosis whose top hypothesis was
    // 'infrastructure' — a self-contradiction. Categories and hypothesis
    // categories use overlapping-but-distinct vocabularies, so we assert they
    // agree at the family level rather than character-for-character.
    const family: Record<string, string> = {
      'app-bug': 'app',
      'test-bug': 'test',
      'test-flakiness': 'test',
      'flaky-test': 'test',
      infrastructure: 'infra',
      environment: 'infra',
      unknown: 'unknown',
    };
    for (const d of diagnoses) {
      const hyps = d.details.hypotheses as Array<{ category: string; likelihood: number }>;
      const top = [...hyps].sort((a, b) => b.likelihood - a.likelihood)[0]!;
      expect(family[top.category], `#${d.id} top hypothesis family matches category family`).toBe(family[d.category]);
    }
  });

  test('every suggested-fix patch validates against the seeded source files', () => {
    const files = allDemoSourceFiles();
    for (const d of diagnoses) {
      const fix = d.details.suggestedFix as { patch: string | null } | undefined;
      if (!fix?.patch) continue;
      const result = validatePatch(fix.patch, files);
      expect(['applies', 'applies-with-offset'], `#${d.id} ${result.status}`).toContain(result.status);
    }
  });

  test('seeds diagnosis version history and ARIA snapshots for failing cases', () => {
    expect(versionCount).toBeGreaterThan(0);
    expect(ariaCount).toBeGreaterThan(0);
  });
});
