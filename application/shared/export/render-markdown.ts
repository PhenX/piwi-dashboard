/**
 * Renders an `ExportBundle` as Markdown — for pasting into an issue tracker or
 * handing to an AI agent. Text only; evidence files are listed, not embedded.
 */
import { stripAnsi } from '#shared/error-fingerprint';
import type { ExportBundle, ExportCase } from './types';

function fence(text: string, lang = ''): string {
  return `\`\`\`${lang}\n${stripAnsi(text).replace(/```/g, '\\`\\`\\`')}\n\`\`\``;
}

function diagnosisMarkdown(diagnosis: Record<string, any> | null): string[] {
  if (!diagnosis || diagnosis.status !== 'completed') return [];
  const det = (diagnosis.details ?? {}) as Record<string, any>;
  const out: string[] = ['### AI diagnosis', ''];
  if (diagnosis.category) out.push(`- Category: ${diagnosis.category}`);
  if (diagnosis.confidence) out.push(`- Confidence: ${diagnosis.confidence}`);
  out.push('');
  if (diagnosis.summary) out.push(String(diagnosis.summary), '');
  if (diagnosis.rootCause) out.push(`**Root cause:** ${diagnosis.rootCause}`, '');
  const evidence = (det.evidence ?? []) as unknown[];
  if (evidence.length) {
    out.push('**Evidence:**', ...evidence.map((e) => `- ${String(e)}`), '');
  }
  const fix = (det.suggestedFix ?? null) as Record<string, any> | null;
  if (fix?.patch) out.push('**Suggested fix:**', fence(String(fix.patch), 'diff'), '');
  else if (fix?.code) out.push('**Suggested fix:**', fence(String(fix.code)), '');
  return out;
}

function caseMarkdown(exportCase: ExportCase): string[] {
  const d = exportCase.detail as Record<string, any>;
  const out: string[] = [
    `## ${exportCase.title}`,
    '',
    `- Status: ${exportCase.status}`,
    `- Location: \`${exportCase.location ?? exportCase.filePath ?? ''}\``,
  ];
  if (d.duration != null) out.push(`- Duration: ${d.duration}ms`);
  if (d.retries) out.push(`- Retries: ${d.retries}`);
  out.push('');

  if (d.error) out.push('### Error', '', fence(String(d.error)), '');
  out.push(...diagnosisMarkdown(exportCase.diagnosis));

  if (Array.isArray(d.consoleLogs) && d.consoleLogs.length) {
    out.push(
      '### Console',
      '',
      fence((d.consoleLogs as Record<string, any>[]).map((l) => `[${l.type ?? 'log'}] ${l.text ?? ''}`).join('\n')),
      '',
    );
  }
  if (d.ariaSnapshot) out.push('### ARIA snapshot', '', fence(String(d.ariaSnapshot), 'yaml'), '');
  if (d.testSource) out.push('### Test source', '', fence(String(d.testSource), 'ts'), '');

  if (exportCase.assets.length) {
    out.push('### Evidence files', '', ...exportCase.assets.map((a) => `- ${a.name} (${a.kind})`), '');
  }
  return out;
}

export function renderExportMarkdown(bundle: ExportBundle): string {
  const out: string[] = [`# ${bundle.title}`, ''];
  out.push(`_${bundle.kind === 'cluster' ? 'Failure cluster' : 'Test execution'} exported ${bundle.generatedAt}_`, '');
  if (bundle.project) out.push(`Project: ${bundle.project.label || bundle.project.name}`, '');
  if (bundle.sourceUrl) out.push(`Source: ${bundle.sourceUrl}`, '');

  const c = bundle.cluster as Record<string, any> | null;
  if (c) {
    out.push('## Cluster', '');
    if (c.errorType) out.push(`- Error type: ${c.errorType}`);
    if (c.selector) out.push(`- Selector: \`${c.selector}\``);
    if (c.status) out.push(`- Status: ${c.status}`);
    if (c.occurrences != null) out.push(`- Occurrences: ${c.occurrences}`);
    if (c.affectedTests != null) out.push(`- Affected tests: ${c.affectedTests}`);
    out.push('');
    if (c.sampleError) out.push('### Representative error', '', fence(String(c.sampleError)), '');
    out.push(...diagnosisMarkdown((c.diagnosis ?? null) as Record<string, any> | null));
  }

  for (const exportCase of bundle.cases) out.push(...caseMarkdown(exportCase));

  if (bundle.truncatedCases.length) {
    out.push(
      `## Other affected tests (${bundle.truncatedCases.length}, evidence not included)`,
      '',
      ...bundle.truncatedCases.map((t) => `- ${t.title} — \`${t.filePath ?? ''}\``),
      '',
    );
  }

  if (bundle.omitted.length) {
    out.push(
      '## Omitted from this export',
      '',
      ...bundle.omitted.map((o) => `- ${o.name} (${o.kind}) — ${o.reason}`),
      '',
    );
  }

  return out.join('\n');
}
