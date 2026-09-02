import { describe, test, expect } from 'vitest';
import {
  DEMO_SCM_PROJECTS,
  DEMO_FIX_PATCHES,
  allDemoSourceFiles,
  getDemoScmProject,
  listDemoCommits,
  getDemoCommitDiff,
  getDemoChangesSince,
  getDemoChangesForShas,
  getDemoAggregate,
} from '~~/app/demo/demo-scm';
import { validatePatch } from '#shared/patch';

describe('demo SCM history', () => {
  test('every project has a repo URL, branches, and a suspect commit with a patch', () => {
    for (const [id, proj] of Object.entries(DEMO_SCM_PROJECTS)) {
      expect(proj.repositoryUrl, `project ${id} repo`).toMatch(/^https:\/\//);
      expect(proj.branches.length, `project ${id} branches`).toBeGreaterThan(0);
      expect(proj.commits.length, `project ${id} commits`).toBeGreaterThan(0);
      const suspect = proj.commits.find((c) => c.sha === proj.suspectShas[0]);
      expect(suspect, `project ${id} suspect commit exists`).toBeTruthy();
      expect(
        suspect!.files.some((f) => f.patch),
        `project ${id} suspect has a patch`,
      ).toBe(true);
    }
  });

  test('listDemoCommits returns 7-char shortSha and honours the branch filter', () => {
    const commits = listDemoCommits(1, 50);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0]!.shortSha).toHaveLength(7);
    expect(commits[0]!.shortSha).toBe(commits[0]!.sha.slice(0, 7));

    const onlyMain = listDemoCommits(1, 50, 'main');
    expect(onlyMain.every((c) => DEMO_SCM_PROJECTS[1]!.commits.find((x) => x.sha === c.sha)!.branch === 'main')).toBe(
      true,
    );
  });

  test('getDemoCommitDiff resolves by full or short SHA', () => {
    const sha = DEMO_SCM_PROJECTS[2]!.suspectShas[0]!;
    const full = getDemoCommitDiff(2, sha);
    const short = getDemoCommitDiff(2, sha.slice(0, 7));
    expect(full?.files.length).toBeGreaterThan(0);
    expect(short?.files.length).toBe(full?.files.length);
    expect(full?.commits[0]!.sha).toBe(sha);
  });

  test('getDemoChangesSince excludes the baseline and includes newer commits', () => {
    const proj = getDemoScmProject(1)!;
    const oldest = proj.commits[proj.commits.length - 1]!.sha;
    const changes = getDemoChangesSince(1, oldest)!;
    // The suspect commit is newer than the oldest baseline, so it must be in range.
    expect(changes.commits.some((c) => c.sha === proj.suspectShas[0])).toBe(true);
    expect(changes.commits.some((c) => c.sha === oldest)).toBe(false);
  });

  test('getDemoChangesForShas aggregates exactly the requested commits', () => {
    const sha = DEMO_SCM_PROJECTS[3]!.suspectShas[0]!;
    const changes = getDemoChangesForShas(3, [sha])!;
    expect(changes.commits).toHaveLength(1);
    expect(changes.commits[0]!.sha).toBe(sha);
  });

  test('getDemoAggregate reports non-negative totals', () => {
    const proj = getDemoScmProject(4)!;
    const oldest = proj.commits[proj.commits.length - 1]!.sha;
    const agg = getDemoAggregate(4, oldest)!;
    expect(agg.filesChanged).toBeGreaterThan(0);
    expect(agg.linesAdded).toBeGreaterThanOrEqual(0);
    expect(agg.linesRemoved).toBeGreaterThanOrEqual(0);
  });
});

describe('demo suggested-fix patches stay in sync with the seeded source files', () => {
  const files = allDemoSourceFiles();

  for (const [name, fix] of Object.entries(DEMO_FIX_PATCHES)) {
    test(`${name} applies cleanly to ${fix.file}`, () => {
      const result = validatePatch(fix.patch, files);
      // "applies" or "applies-with-offset" both mean git apply would succeed; a
      // drifted source file would surface as "stale-file" and fail this test.
      expect(['applies', 'applies-with-offset']).toContain(result.status);
      expect(result.filesChecked).toBe(1);
      expect(result.errors).toEqual([]);
    });
  }
});
