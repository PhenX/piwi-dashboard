import { describe, it, expect } from 'vitest';
import { fixPlanToMarkdown } from '#shared/fix-plan-markdown';
import type { FixPlan } from '#shared/fix-plan.types';

function makePlan(overrides: Partial<FixPlan> = {}): FixPlan {
  return {
    cluster: {
      id: 7,
      title: 'Pay button never enables',
      signature: 'Timeout <N>ms exceeded.',
      errorType: 'TimeoutError',
      status: 'open',
      occurrences: 3,
      fixVerification: null,
    },
    diagnosis: null,
    edits: [],
    failingTests: [{ testCaseId: 1, title: 'checkout completes', filePath: 'tests/checkout.spec.ts', executionId: 42 }],
    ownership: { owner: null, source: null },
    verify: {
      command: 'npx playwright test tests/checkout.spec.ts',
      expectation: 'When these pass, Piwi records the fix.',
    },
    reproduce: {
      steps: [
        {
          step: 'Check out the failing commit',
          bash: 'git switch --detach abc123',
          powershell: 'git switch --detach abc123',
        },
        {
          step: 'Run the failing test',
          bash: 'npx playwright test tests/checkout.spec.ts',
          powershell: 'npx playwright test tests/checkout.spec.ts',
        },
      ],
      env: [{ label: 'Environment', value: 'production' }],
      notes: [],
      commit: 'abc123',
      playwrightVersion: '1.50.1',
      browser: 'chromium',
      project: 'chromium',
    },
    bisect: {
      available: true,
      good: 'green01',
      bad: 'abc123',
      goodShort: 'green01',
      badShort: 'abc123',
      bash: 'git bisect start abc123 green01\ngit bisect run npx playwright test\ngit bisect reset',
      powershell: 'git bisect start abc123 green01\ngit bisect run npx playwright test\ngit bisect reset',
      explanation: 'Walks the commits between green01 and abc123.',
    },
    ...overrides,
  };
}

describe('fixPlanToMarkdown', () => {
  it('renders the title, failing tests and verify command for a thin plan', () => {
    const md = fixPlanToMarkdown(makePlan());
    expect(md).toContain('# Fix plan — Pay button never enables');
    expect(md).toContain('## Failing tests');
    expect(md).toContain('checkout completes');
    expect(md).toContain('## Verify');
    expect(md).toContain('npx playwright test tests/checkout.spec.ts');
    // No diagnosis / edits / owner sections when those are absent.
    expect(md).not.toContain('## Diagnosis');
    expect(md).not.toContain('## Suggested locator edits');
    expect(md).not.toContain('## Owner');
  });

  it('renders the reproduce recipe and the bisect', () => {
    const md = fixPlanToMarkdown(makePlan());
    expect(md).toContain('## Reproduce locally');
    expect(md).toContain('# Check out the failing commit');
    expect(md).toContain('git switch --detach abc123');
    expect(md).toContain('Environment: production');
    expect(md).toContain('## Bisect the regression');
    expect(md).toContain('git bisect start abc123 green01');
  });

  it('renders the bisect reason when the window is unavailable', () => {
    const md = fixPlanToMarkdown(
      makePlan({ bisect: { available: false, reason: 'A git bisect needs a last-green commit.' } }),
    );
    expect(md).toContain('## Bisect the regression');
    expect(md).toContain('A git bisect needs a last-green commit.');
  });

  it('renders the diagnosis, its patch validation and the patch fence', () => {
    const md = fixPlanToMarkdown(
      makePlan({
        diagnosis: {
          category: 'test-bug',
          confidence: 'high',
          rootCause: 'The locator no longer matches.',
          summary: 'Renamed button.',
          patch: '--- a/x\n+++ b/x\n@@\n-old\n+new',
          patchValidation: { status: 'applies', filesChecked: 1, filesInPatch: 1, errors: [] },
        },
      }),
    );
    expect(md).toContain('## Diagnosis');
    expect(md).toContain('**Category:** test-bug');
    expect(md).toContain('**Root cause:** The locator no longer matches.');
    expect(md).toContain('**Patch validation:** Applies cleanly');
    expect(md).toContain('```diff');
  });

  it('renders locator edits and the owner, and appends the url footer', () => {
    const md = fixPlanToMarkdown(
      makePlan({
        edits: [
          {
            filePath: 'tests/checkout.spec.ts',
            line: 12,
            currentLine: "  await page.getByRole('button').click();",
            failingLocator: "getByRole('button')",
            suggestedLocator: "getByRole('button', { name: 'Pay' })",
            score: 90,
            edit: null,
            executionId: 42,
          },
        ],
        ownership: { owner: '@checkout-team', source: 'codeowners' },
      }),
      { url: 'https://piwi.example/failure-clusters/7' },
    );
    expect(md).toContain('## Suggested locator edits');
    expect(md).toContain('tests/checkout.spec.ts:12');
    expect(md).toContain("getByRole('button', { name: 'Pay' })");
    expect(md).toContain('(score 90/100)');
    expect(md).toContain('## Owner');
    expect(md).toContain('@checkout-team (codeowners)');
    expect(md).toContain('[Open this cluster in Piwi](https://piwi.example/failure-clusters/7)');
  });
});
