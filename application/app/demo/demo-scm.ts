/**
 * Canned source-control history for demo mode.
 *
 * The real dashboard grounds an AI diagnosis in the code that changed by talking
 * to a live SCM provider (GitHub/GitLab/Bitbucket) over the network. The demo has
 * no server and no repo, so this module hand-crafts a small, believable repository
 * history — commits, authors, dates, and unified-diff patches — per demo project.
 *
 * It powers three demo surfaces so they all tell one coherent story:
 *  - the commit picker / browser and baseline diff (app/demo/api/scm.ts)
 *  - the "SCM diff since last green" + "Source files" context sections
 *    (app/demo/api/diagnosis-context.ts)
 *  - the diagnosis `autoSelectedCommits` and the verifiable suggested-fix patch
 *    (app/demo/api/ai.ts and scripts/generate-demo-seed.mjs)
 *
 * Keep the SHAs, file paths, and patches here in sync with the seeded diagnoses
 * in scripts/generate-demo-seed.mjs — the suggested-fix patch is validated against
 * the source files declared here.
 */

import type { ScmChangedFile, ScmChanges, CommitListItem } from '~~/types/api';

export interface DemoCommit {
  sha: string;
  message: string;
  author: string;
  /** ISO-8601 timestamp. */
  date: string;
  branch: string;
  files: ScmChangedFile[];
}

export interface DemoScmProject {
  repositoryUrl: string;
  defaultBranch: string;
  branches: string[];
  /** Newest first. */
  commits: DemoCommit[];
  /** SHAs the diagnosis flags as most-suspect (fed into `autoSelectedCommits`). */
  suspectShas: string[];
  /** Full source files shown to the model to ground patch suggestions. */
  sourceFiles: Array<{ path: string; content: string }>;
}

// ── Per-project canned repositories ─────────────────────────────────────────

const CHECKOUT_SPEC = `import { test, expect } from '@playwright/test';

test('should complete checkout with credit card', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByLabel('Card number').fill('4242 4242 4242 4242');
  await page.getByLabel('Expiry').fill('12/30');
  await page.getByLabel('CVV').fill('123');
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByText('Payment successful')).toBeVisible();
});
`;

const CHECKOUT_FORM = `<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { loadPaymentProvider } from '~/lib/payment-provider';

const ready = ref(false);

onMounted(async () => {
  // New payment provider SDK is fetched from a third-party CDN before the
  // form becomes interactive. On a slow CI runner this can take several seconds.
  await loadPaymentProvider();
  ready.value = true;
});
</script>

<template>
  <form class="checkout-form">
    <PaymentFields />
    <button type="submit" :disabled="!ready">Pay</button>
  </form>
</template>
`;

const AUTH_HANDLER = `import { verifyCredentials } from '../services/credentials';
import { signSession } from '../services/session';

export async function loginHandler(req, res) {
  const { email, password } = req.body;
  // Refactor regression: verifyCredentials now returns null (not throws) on a
  // missing user, and this path dereferences user.id without a guard → 500.
  const user = await verifyCredentials(email, password);
  const token = signSession(user.id);
  return res.status(200).json({ token });
}
`;

const BUTTON_SPEC = `import { test, expect } from '@playwright/test';

test('Button primary variant renders correctly', async ({ page }) => {
  await page.goto('/components/button');
  // The page now renders primary, disabled and loading variants side by side,
  // so an unscoped role query matches 3 elements (strict-mode violation).
  await page.getByRole('button').click();
  await expect(page.getByRole('button')).toHaveClass(/btn-primary/);
});
`;

const MOBILE_SPEC = `import { test, expect } from '@playwright/test';

test('Tab bar navigation works correctly', async ({ page }) => {
  await page.goto('https://app.example.com');
  await page.getByRole('tab', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});
`;

export const DEMO_SCM_PROJECTS: Record<number, DemoScmProject> = {
  1: {
    repositoryUrl: 'https://github.com/example/shop-web',
    defaultBranch: 'main',
    branches: ['main', 'develop', 'feature/new-ui'],
    suspectShas: ['a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4'],
    sourceFiles: [
      { path: 'tests/checkout/checkout.spec.ts', content: CHECKOUT_SPEC },
      { path: 'src/components/CheckoutForm.vue', content: CHECKOUT_FORM },
    ],
    commits: [
      {
        sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4',
        message: 'feat: add new payment provider integration',
        author: 'Alice Chen',
        date: '2025-04-24T14:12:00Z',
        branch: 'main',
        files: [
          {
            filename: 'src/components/CheckoutForm.vue',
            status: 'modified',
            additions: 9,
            deletions: 1,
            patch: `@@ -1,6 +1,14 @@
 <script setup lang="ts">
-import { ref } from 'vue';
+import { ref, onMounted } from 'vue';
+import { loadPaymentProvider } from '~/lib/payment-provider';

 const ready = ref(false);
+
+onMounted(async () => {
+  // Fetch the third-party payment SDK before enabling the form.
+  await loadPaymentProvider();
+  ready.value = true;
+});
 </script>`,
          },
          {
            filename: 'src/lib/payment-provider.ts',
            status: 'added',
            additions: 12,
            deletions: 0,
            patch: `@@ -0,0 +1,12 @@
+export async function loadPaymentProvider(): Promise<void> {
+  const s = document.createElement('script');
+  s.src = 'https://cdn.pay.example.com/sdk.js';
+  document.head.appendChild(s);
+  await new Promise((resolve) => {
+    s.onload = resolve;
+  });
+}`,
          },
        ],
      },
      {
        sha: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5',
        message: 'chore: bump @playwright/test to 1.51.0',
        author: 'Bob Smith',
        date: '2025-04-23T09:30:00Z',
        branch: 'main',
        files: [
          { filename: 'package.json', status: 'modified', additions: 1, deletions: 1 },
        ],
      },
      {
        sha: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6',
        message: 'fix: correct discount code rounding',
        author: 'Carol White',
        date: '2025-04-22T16:05:00Z',
        branch: 'main',
        files: [
          { filename: 'src/lib/cart.ts', status: 'modified', additions: 4, deletions: 2 },
        ],
      },
      {
        sha: 'd4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607',
        message: 'test: add Apple Pay checkout coverage',
        author: 'Alice Chen',
        date: '2025-04-21T11:20:00Z',
        branch: 'main',
        files: [
          { filename: 'tests/checkout/checkout.spec.ts', status: 'modified', additions: 18, deletions: 0 },
        ],
      },
      {
        sha: 'e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718',
        message: 'refactor: extract cart totals helper',
        author: 'David Lee',
        date: '2025-04-20T13:45:00Z',
        branch: 'main',
        files: [{ filename: 'src/lib/cart.ts', status: 'modified', additions: 22, deletions: 15 }],
      },
    ],
  },

  2: {
    repositoryUrl: 'https://github.com/example/shop-api',
    defaultBranch: 'main',
    branches: ['main', 'develop'],
    suspectShas: ['f1e2d3c4b5a6079887766554433221100ffeeddc'],
    sourceFiles: [
      { path: 'tests/api/auth.spec.ts', content: 'import { test, expect } from \'@playwright/test\';\n\ntest(\'POST /auth/login returns 200 with valid credentials\', async ({ request }) => {\n  const res = await request.post(\'/auth/login\', {\n    data: { email: \'user@example.com\', password: \'correct-horse\' },\n  });\n  expect(res.status()).toBe(200);\n});\n' },
      { path: 'src/routes/auth.ts', content: AUTH_HANDLER },
    ],
    commits: [
      {
        sha: 'f1e2d3c4b5a6079887766554433221100ffeeddc',
        message: 'refactor: simplify auth flow',
        author: 'David Lee',
        date: '2025-04-24T10:02:00Z',
        branch: 'main',
        files: [
          {
            filename: 'src/routes/auth.ts',
            status: 'modified',
            additions: 3,
            deletions: 6,
            patch: `@@ -3,10 +3,7 @@ import { signSession } from '../services/session';
 export async function loginHandler(req, res) {
   const { email, password } = req.body;
-  const user = await verifyCredentials(email, password);
-  if (!user) {
-    return res.status(401).json({ error: 'Invalid credentials' });
-  }
+  const user = await verifyCredentials(email, password);
   const token = signSession(user.id);
   return res.status(200).json({ token });
 }`,
          },
          {
            filename: 'src/services/credentials.ts',
            status: 'modified',
            additions: 2,
            deletions: 2,
            patch: `@@ -8,7 +8,7 @@ export async function verifyCredentials(email, password) {
   const user = await db.users.findByEmail(email);
-  if (!user) throw new UnauthorizedError();
+  if (!user) return null;
   return (await bcrypt.compare(password, user.hash)) ? user : null;
 }`,
          },
        ],
      },
      {
        sha: '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d',
        message: 'feat: paginate GET /products',
        author: 'Eva Brown',
        date: '2025-04-23T15:40:00Z',
        branch: 'main',
        files: [{ filename: 'src/routes/products.ts', status: 'modified', additions: 14, deletions: 3 }],
      },
      {
        sha: '19283a4b5c6d7e8f90a1b2c3d4e5f60718293a4b',
        message: 'chore: upgrade postgres driver',
        author: 'Bob Smith',
        date: '2025-04-22T08:15:00Z',
        branch: 'main',
        files: [{ filename: 'package.json', status: 'modified', additions: 1, deletions: 1 }],
      },
      {
        sha: '2837465564738291a0b1c2d3e4f5060718293a4b',
        message: 'test: cover order status transitions',
        author: 'Carol White',
        date: '2025-04-21T12:00:00Z',
        branch: 'main',
        files: [{ filename: 'tests/api/orders.spec.ts', status: 'modified', additions: 26, deletions: 1 }],
      },
    ],
  },

  3: {
    repositoryUrl: 'https://github.com/example/design-system',
    defaultBranch: 'main',
    branches: ['main', 'feature/new-ui'],
    suspectShas: ['3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d'],
    sourceFiles: [{ path: 'tests/ui/button.spec.ts', content: BUTTON_SPEC }],
    commits: [
      {
        sha: '3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d',
        message: 'feat: showcase all button variants on demo page',
        author: 'Carol White',
        date: '2025-04-24T09:50:00Z',
        branch: 'feature/new-ui',
        files: [
          {
            filename: 'src/pages/components/button.vue',
            status: 'modified',
            additions: 6,
            deletions: 1,
            patch: `@@ -4,7 +4,12 @@
   <section>
-    <AppButton variant="primary">Primary</AppButton>
+    <AppButton variant="primary">Primary</AppButton>
+    <AppButton variant="primary" disabled>Disabled</AppButton>
+    <AppButton variant="primary" loading>Loading</AppButton>
   </section>`,
          },
        ],
      },
      {
        sha: '4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e',
        message: 'style: tune focus ring tokens',
        author: 'Alice Chen',
        date: '2025-04-23T14:25:00Z',
        branch: 'main',
        files: [{ filename: 'src/tokens/focus.css', status: 'modified', additions: 3, deletions: 3 }],
      },
      {
        sha: '5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f',
        message: 'fix: modal close button contrast',
        author: 'David Lee',
        date: '2025-04-22T10:10:00Z',
        branch: 'main',
        files: [{ filename: 'src/components/Modal.vue', status: 'modified', additions: 2, deletions: 2 }],
      },
    ],
  },

  4: {
    repositoryUrl: 'https://github.com/example/mobile-web',
    defaultBranch: 'main',
    branches: ['main', 'develop'],
    suspectShas: ['6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'],
    sourceFiles: [{ path: 'tests/mobile/navigation.spec.ts', content: MOBILE_SPEC }],
    commits: [
      {
        sha: '6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        message: 'feat: add full-bleed hero image to landing page',
        author: 'Eva Brown',
        date: '2025-04-19T17:30:00Z',
        branch: 'main',
        files: [
          {
            filename: 'src/pages/index.vue',
            status: 'modified',
            additions: 5,
            deletions: 0,
            patch: `@@ -2,6 +2,11 @@
   <main>
+    <img
+      src="/hero-4k.png"
+      alt="Hero"
+      class="hero"
+    />
     <Nav />`,
          },
        ],
      },
      {
        sha: '7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1',
        message: 'chore: enable Safari 17 in CI matrix',
        author: 'Bob Smith',
        date: '2025-04-18T09:05:00Z',
        branch: 'main',
        files: [{ filename: '.github/workflows/ci.yml', status: 'modified', additions: 2, deletions: 0 }],
      },
      {
        sha: '8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2',
        message: 'fix: swipe gesture threshold on small screens',
        author: 'Carol White',
        date: '2025-04-17T11:45:00Z',
        branch: 'main',
        files: [{ filename: 'src/lib/gestures.ts', status: 'modified', additions: 7, deletions: 4 }],
      },
    ],
  },
};

// ── Suggested-fix patches ────────────────────────────────────────────────────
// The verifiable fixes the demo diagnosis proposes. Each patch targets a file in
// `sourceFiles` above and is validated (via #shared/patch) before the "Applies
// cleanly" badge is shown — so these hunks MUST stay in sync with the source above.
// Also mirrored (as static strings) in scripts/generate-demo-seed.mjs.

export const DEMO_FIX_PATCHES = {
  checkoutWait: {
    file: 'tests/checkout/checkout.spec.ts',
    patch: `--- a/tests/checkout/checkout.spec.ts
+++ b/tests/checkout/checkout.spec.ts
@@ -7,2 +7,3 @@
   await page.getByLabel('CVV').fill('123');
+  await page.waitForLoadState('networkidle');
   await page.getByRole('button', { name: 'Pay' }).click();`,
  },
  authGuard: {
    file: 'src/routes/auth.ts',
    patch: `--- a/src/routes/auth.ts
+++ b/src/routes/auth.ts
@@ -8,2 +8,5 @@
   const user = await verifyCredentials(email, password);
+  if (!user) {
+    return res.status(401).json({ error: 'Invalid credentials' });
+  }
   const token = signSession(user.id);`,
  },
  buttonScope: {
    file: 'tests/ui/button.spec.ts',
    patch: `--- a/tests/ui/button.spec.ts
+++ b/tests/ui/button.spec.ts
@@ -7,1 +7,1 @@
-  await page.getByRole('button').click();
+  await page.getByRole('button', { name: 'Primary' }).click();`,
  },
  mobileTimeout: {
    file: 'tests/mobile/navigation.spec.ts',
    patch: `--- a/tests/mobile/navigation.spec.ts
+++ b/tests/mobile/navigation.spec.ts
@@ -4,1 +4,1 @@
-  await page.goto('https://app.example.com');
+  await page.goto('https://app.example.com', { timeout: 60000 });`,
  },
} as const;

/** All seeded source files across every demo project, keyed by repo-relative path. */
export function allDemoSourceFiles(): Map<string, string> {
  const map = new Map<string, string>();
  for (const proj of Object.values(DEMO_SCM_PROJECTS)) {
    for (const f of proj.sourceFiles) map.set(f.path, f.content);
  }
  return map;
}

// ── Lookups ─────────────────────────────────────────────────────────────────

export function getDemoScmProject(projectId: number): DemoScmProject | null {
  return DEMO_SCM_PROJECTS[projectId] ?? null;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Commit list in the shape the commit picker/browser expects. */
export function listDemoCommits(projectId: number, limit = 50, branch?: string): CommitListItem[] {
  const proj = getDemoScmProject(projectId);
  if (!proj) return [];
  const commits = branch ? proj.commits.filter((c) => c.branch === branch) : proj.commits;
  return commits.slice(0, limit).map((c) => ({
    sha: c.sha,
    shortSha: shortSha(c.sha),
    message: c.message,
    author: c.author,
    date: c.date,
  }));
}

/** File-level diff for a single commit (ScmChanges shape). */
export function getDemoCommitDiff(projectId: number, sha: string): ScmChanges | null {
  const proj = getDemoScmProject(projectId);
  if (!proj) return null;
  const commit = proj.commits.find((c) => c.sha === sha || shortSha(c.sha) === sha);
  if (!commit) return null;
  return {
    commits: [{ sha: commit.sha, message: commit.message }],
    files: commit.files,
    patchesOmitted: false,
  };
}

/** Aggregate all commits newer than (and excluding) the baseline SHA. */
export function getDemoChangesSince(projectId: number, baselineSha: string | null): ScmChanges | null {
  const proj = getDemoScmProject(projectId);
  if (!proj) return null;
  let commits = proj.commits;
  if (baselineSha) {
    const idx = proj.commits.findIndex((c) => c.sha === baselineSha || shortSha(c.sha) === baselineSha);
    // Commits are newest-first; everything before the baseline index is newer.
    commits = idx >= 0 ? proj.commits.slice(0, idx) : proj.commits;
  }
  return aggregateCommits(commits);
}

/** Aggregate an explicit set of selected commit SHAs. */
export function getDemoChangesForShas(projectId: number, shas: string[]): ScmChanges | null {
  const proj = getDemoScmProject(projectId);
  if (!proj) return null;
  const set = new Set(shas);
  const commits = proj.commits.filter((c) => set.has(c.sha) || set.has(shortSha(c.sha)));
  return aggregateCommits(commits);
}

function aggregateCommits(commits: DemoCommit[]): ScmChanges {
  // Merge file entries by filename, concatenating patches and summing stats.
  const byFile = new Map<string, ScmChangedFile>();
  for (const c of commits) {
    for (const f of c.files) {
      const existing = byFile.get(f.filename);
      if (existing) {
        existing.additions += f.additions;
        existing.deletions += f.deletions;
        if (f.patch) existing.patch = existing.patch ? `${existing.patch}\n${f.patch}` : f.patch;
      } else {
        byFile.set(f.filename, { ...f });
      }
    }
  }
  return {
    commits: commits.map((c) => ({ sha: c.sha, message: c.message })),
    files: [...byFile.values()],
    patchesOmitted: false,
  };
}

/** Aggregate stats for the commits since a baseline (for the commit browser header). */
export function getDemoAggregate(
  projectId: number,
  baselineSha: string,
): { filesChanged: number; linesAdded: number; linesRemoved: number } | null {
  const changes = getDemoChangesSince(projectId, baselineSha);
  if (!changes) return null;
  return {
    filesChanged: changes.files.length,
    linesAdded: changes.files.reduce((s, f) => s + f.additions, 0),
    linesRemoved: changes.files.reduce((s, f) => s + f.deletions, 0),
  };
}
