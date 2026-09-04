/**
 * Render a fix plan as Markdown — the whole plan an agent or a ticket can take
 * away as text. One renderer, used by the dashboard's "Copy as Markdown" button,
 * the `?format=markdown` export endpoint and its demo mirror, so the three can
 * never drift.
 *
 * Every section degrades independently, exactly like the plan itself: a cluster
 * with no diagnosis still renders its failing tests and verification command.
 */
import type { FixPlan } from '#shared/fix-plan.types';
import { reproScript } from '#shared/reproduce';

/** Fenced code block, guarding against a body that already ends in a newline. */
function fence(body: string, lang = ''): string {
  const trimmed = body.replace(/\n+$/, '');
  return `\`\`\`${lang}\n${trimmed}\n\`\`\``;
}

function patchValidationLine(plan: NonNullable<FixPlan['diagnosis']>): string | null {
  const v = plan.patchValidation;
  if (!v) return null;
  const label: Record<string, string> = {
    applies: 'Applies cleanly — verified against the real file at the failing commit',
    'applies-with-offset': 'Applies with offset — context matched at a shifted line',
    'stale-file': 'Does not apply — the file changed since this patch was proposed',
    invalid: 'Invalid diff — could not be parsed as a unified diff',
    unchecked: 'Unverified — the source file was not in context',
  };
  return label[v.status] ?? v.status;
}

/**
 * Build the Markdown rendering of a fix plan. `url` is the cluster page link,
 * appended as a footer when supplied.
 */
export function fixPlanToMarkdown(plan: FixPlan, opts: { url?: string } = {}): string {
  const { cluster, diagnosis, edits, failingTests, ownership, verify } = plan;
  const lines: string[] = [];

  const title = cluster.title || cluster.signature;
  lines.push(`# Fix plan — ${title}`, '');

  const meta = [
    cluster.errorType,
    `${cluster.occurrences} occurrence${cluster.occurrences === 1 ? '' : 's'}`,
    cluster.status !== 'open' ? `status: ${cluster.status}` : null,
    cluster.fixVerification ? `fix: ${cluster.fixVerification}` : null,
  ].filter(Boolean);
  if (meta.length) lines.push(meta.join(' · '), '');

  // Diagnosis
  if (diagnosis && (diagnosis.summary || diagnosis.rootCause || diagnosis.patch)) {
    lines.push('## Diagnosis', '');
    const badges = [
      diagnosis.category ? `**Category:** ${diagnosis.category}` : null,
      diagnosis.confidence ? `**Confidence:** ${diagnosis.confidence}` : null,
    ].filter(Boolean);
    if (badges.length) lines.push(badges.join(' · '), '');
    if (diagnosis.summary) lines.push(diagnosis.summary, '');
    if (diagnosis.rootCause) lines.push(`**Root cause:** ${diagnosis.rootCause}`, '');
    if (diagnosis.patch) {
      const validation = patchValidationLine(diagnosis);
      if (validation) lines.push(`**Patch validation:** ${validation}`, '');
      lines.push(fence(diagnosis.patch, 'diff'), '');
    }
  }

  // Locator edits
  if (edits.length) {
    lines.push('## Suggested locator edits', '');
    for (const edit of edits) {
      const where = edit.line != null ? `${edit.filePath}:${edit.line}` : edit.filePath;
      lines.push(`### \`${where}\``, '');
      if (edit.failingLocator) lines.push(`- Failing: \`${edit.failingLocator}\``);
      if (edit.suggestedLocator) {
        const score = edit.score != null ? ` (score ${edit.score}/100)` : '';
        lines.push(`- Suggested: \`${edit.suggestedLocator}\`${score}`);
      }
      if (edit.currentLine) lines.push(`- Current line: \`${edit.currentLine.trim()}\``);
      lines.push('');
      if (edit.edit?.unifiedDiff) lines.push(fence(edit.edit.unifiedDiff, 'diff'), '');
    }
  }

  // Failing tests
  if (failingTests.length) {
    lines.push('## Failing tests', '');
    for (const test of failingTests) {
      lines.push(`- ${test.title} — \`${test.filePath}\` (execution #${test.executionId})`);
    }
    lines.push('');
  }

  // Owner
  if (ownership.owner) {
    const source = ownership.source ? ` (${ownership.source})` : '';
    lines.push('## Owner', '', `${ownership.owner}${source}`, '');
  }

  // Verify
  lines.push('## Verify', '', fence(verify.command), '', verify.expectation, '');

  // Reproduce locally — the commands are git/npm/npx, identical on every OS.
  if (plan.reproduce.steps.length) {
    lines.push('## Reproduce locally', '', fence(reproScript(plan.reproduce, 'bash'), 'bash'), '');
    for (const e of plan.reproduce.env) lines.push(`- ${e.label}: ${e.value}`);
    if (plan.reproduce.env.length) lines.push('');
    for (const note of plan.reproduce.notes) lines.push(`> ${note}`);
    if (plan.reproduce.notes.length) lines.push('');
  }

  // Bisect
  if (plan.bisect.available) {
    lines.push('## Bisect the regression', '', fence(plan.bisect.bash, 'bash'), '', plan.bisect.explanation, '');
  } else {
    lines.push('## Bisect the regression', '', plan.bisect.reason, '');
  }

  if (opts.url) lines.push('---', '', `[Open this cluster in Piwi](${opts.url})`, '');

  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}
