/**
 * Renders an `ExportBundle` as one self-contained HTML document.
 *
 * The only difference between the standalone `.html` download and the copy
 * inside a ZIP is `assetUrl`: the former returns `data:` URIs, the latter
 * returns relative paths next to the file. Everything else is identical, and
 * printing this document is what produces the PDF.
 *
 * Every value interpolated here comes from a test run — error text, console
 * output, page source. The `html` tagged template escapes interpolations by
 * default, so markup has to be opted into explicitly with `raw()`.
 */
import { markdownToHtml } from '#shared/markdown-to-html';
import { html, joinHtml, raw, toHtmlString, type RawHtml } from './html';
import { stripAnsi } from '#shared/error-fingerprint';
import type { ExportAsset, ExportBundle, ExportCase } from './types';

export interface RenderOptions {
  /** Resolves an asset to a URL usable from the rendered document, or null to omit it. */
  assetUrl: (asset: ExportAsset) => string | null;
  /** Emit the auto-print hook, for "Save as PDF". */
  print?: boolean;
}

const STYLES = `
:root { color-scheme: light dark; --bg:#fff; --fg:#18181b; --muted:#71717a; --line:#e4e4e7; --card:#fafafa; --accent:#2563eb; --fail:#dc2626; --pass:#16a34a; }
@media (prefers-color-scheme: dark) { :root { --bg:#18181b; --fg:#f4f4f5; --muted:#a1a1aa; --line:#3f3f46; --card:#27272a; --accent:#60a5fa; --fail:#f87171; --pass:#4ade80; } }
* { box-sizing: border-box; }
body { margin:0; padding:0 1rem 4rem; background:var(--bg); color:var(--fg); font-family:system-ui,-apple-system,Segoe UI,sans-serif; line-height:1.6; }
.wrap { max-width: 60rem; margin: 0 auto; }
header.doc { padding:2rem 0 1rem; border-bottom:1px solid var(--line); }
h1 { font-size:1.6rem; margin:0 0 .25rem; overflow-wrap:anywhere; }
h2 { font-size:1.15rem; margin:0; }
h3 { font-size:1rem; margin:1.25rem 0 .35rem; }
.meta { color:var(--muted); font-size:.85rem; }
.meta code { overflow-wrap:anywhere; }
dl.facts { display:grid; grid-template-columns:max-content 1fr; gap:.15rem .75rem; margin:.75rem 0; font-size:.9rem; }
dl.facts dt { color:var(--muted); }
dl.facts dd { margin:0; overflow-wrap:anywhere; }
section.card { border:1px solid var(--line); border-radius:8px; margin:1rem 0; background:var(--card); overflow:hidden; }
section.card > summary, details > summary { cursor:pointer; padding:.6rem .9rem; font-weight:600; list-style:none; display:flex; justify-content:space-between; gap:1rem; align-items:center; }
details > summary::-webkit-details-marker { display:none; }
details > summary::after { content:'▾'; color:var(--muted); font-weight:400; }
details[open] > summary::after { content:'▴'; }
.body { padding:0 .9rem .9rem; }
pre { background:var(--bg); border:1px solid var(--line); padding:.75rem; border-radius:6px; overflow-x:auto; font-size:.82rem; white-space:pre-wrap; overflow-wrap:anywhere; }
code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
img.shot, video { max-width:100%; height:auto; border:1px solid var(--line); border-radius:6px; }
figure { margin:.5rem 0; }
figcaption { font-size:.75rem; color:var(--muted); margin-top:.2rem; overflow-wrap:anywhere; }
table { border-collapse:collapse; width:100%; font-size:.82rem; }
th, td { text-align:left; padding:.3rem .5rem; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }
th { color:var(--muted); font-weight:600; }
.scroll { overflow-x:auto; }
.badge { display:inline-block; padding:.05rem .45rem; border-radius:99px; font-size:.75rem; border:1px solid var(--line); }
.badge.failed, .badge.timedout { color:var(--fail); border-color:var(--fail); }
.badge.passed { color:var(--pass); border-color:var(--pass); }
.note { border-left:3px solid var(--accent); padding:.4rem .75rem; margin:1rem 0; font-size:.85rem; background:var(--card); }
.toolbar { display:flex; gap:.5rem; padding:1rem 0 0; }
button { font:inherit; padding:.35rem .8rem; border:1px solid var(--line); border-radius:6px; background:var(--card); color:var(--fg); cursor:pointer; }
@media (max-width: 30rem) { body { padding:0 .6rem 3rem; } dl.facts { grid-template-columns:1fr; } dl.facts dt { margin-top:.4rem; } }
@media print {
  :root { --bg:#fff; --fg:#000; --muted:#555; --line:#bbb; --card:#fff; }
  body { padding:0; font-size:11pt; }
  .no-print { display:none !important; }
  details { break-inside:avoid; }
  section.case { break-before:page; }
  section.case:first-of-type { break-before:auto; }
  pre { white-space:pre-wrap; word-break:break-word; }
}
`;

/** Expand every <details> before printing so nothing is lost in the PDF. */
const SCRIPT = `
document.addEventListener('click', function (e) {
  var t = e.target;
  if (t && t.dataset && t.dataset.action === 'expand') {
    document.querySelectorAll('details').forEach(function (d) { d.open = true; });
  }
  if (t && t.dataset && t.dataset.action === 'print') { window.print(); }
});
window.addEventListener('beforeprint', function () {
  document.querySelectorAll('details').forEach(function (d) { d.open = true; });
});
`;

const AUTO_PRINT = `window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });`;

function fmtDuration(ms: unknown): string {
  const n = typeof ms === 'number' ? ms : Number(ms);
  if (!Number.isFinite(n)) return '—';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  const m = Math.floor(n / 60_000);
  return `${m}m ${Math.round((n % 60_000) / 1000)}s`;
}

function fmtBytes(bytes: unknown): string {
  const n = typeof bytes === 'number' ? bytes : Number(bytes);
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function facts(rows: [string, string | null | undefined][]): RawHtml {
  const present = rows.filter(([, v]) => v != null && v !== '');
  if (!present.length) return raw('');
  return html`<dl class="facts">
    ${present.map(
      ([k, v]) => html`<dt>${k}</dt>
        <dd>${String(v)}</dd>`,
    )}
  </dl>`;
}

function details(title: string, inner: RawHtml | string, open = false): RawHtml {
  const body = toHtmlString(inner);
  if (!body.trim()) return raw('');
  return html`<details class="card" ${open ? raw('open') : ''}>
    <summary>${title}</summary>
    <div class="body">${raw(body)}</div>
  </details>`;
}

function pre(text: string): RawHtml {
  return html`<pre>${stripAnsi(text)}</pre>`;
}

/** AI prose is Markdown; links are flattened so the document stays self-contained. */
function prose(markdown: string): RawHtml {
  return raw(markdownToHtml(markdown, { linkMode: 'text' }));
}

function renderDiagnosis(diagnosis: Record<string, any> | null): RawHtml {
  if (!diagnosis || diagnosis.status !== 'completed') return raw('');
  const det = (diagnosis.details ?? {}) as Record<string, any>;
  const parts: (RawHtml | string)[] = [];

  parts.push(
    facts([
      ['Category', diagnosis.category],
      ['Confidence', diagnosis.confidence],
      ['Severity', det.severity],
      ['Affected area', det.affectedArea],
    ]),
  );
  if (diagnosis.summary) parts.push(html`<p><strong>${String(diagnosis.summary)}</strong></p>`);
  if (diagnosis.rootCause) parts.push(html`<p><strong>Root cause:</strong> ${String(diagnosis.rootCause)}</p>`);

  const evidence = (det.evidence ?? []) as unknown[];
  if (evidence.length) {
    parts.push(html`<h3>Evidence</h3>
      <ul>
        ${evidence.map((e) => html`<li>${String(e)}</li>`)}
      </ul>`);
  }

  const fix = (det.suggestedFix ?? null) as Record<string, any> | null;
  if (fix) {
    parts.push(html`<h3>Suggested fix</h3>`);
    if (fix.description) parts.push(prose(String(fix.description)));
    if (fix.patch) parts.push(pre(String(fix.patch)));
    else if (fix.code) parts.push(pre(String(fix.code)));
  }

  return details('AI diagnosis', joinHtml(parts, '\n'), true);
}

function renderAssets(exportCase: ExportCase, assetUrl: RenderOptions['assetUrl']): RawHtml {
  const shots = exportCase.assets.filter((a) => a.kind === 'screenshot');
  const videos = exportCase.assets.filter((a) => a.kind === 'video');
  const traces = exportCase.assets.filter((a) => a.kind === 'trace');
  const others = exportCase.assets.filter((a) => a.kind === 'attachment');
  const out: (RawHtml | string)[] = [];

  const shotFigures = shots
    .map((a) => {
      const url = assetUrl(a);
      if (!url) return null;
      return html`<figure>
        <img class="shot" src="${url}" alt="${a.name}" />
        <figcaption>${a.name}</figcaption>
      </figure>`;
    })
    .filter((f): f is RawHtml => f !== null);
  if (shotFigures.length)
    out.push(
      html`<h3>Screenshots</h3>
        ${shotFigures}`,
    );

  const videoFigures = videos
    .map((a) => {
      const url = assetUrl(a);
      if (!url) return null;
      return html`<figure>
        <video controls preload="metadata" src="${url}"></video>
        <figcaption>${a.name} — video does not play in a printed PDF</figcaption>
      </figure>`;
    })
    .filter((f): f is RawHtml => f !== null);
  if (videoFigures.length)
    out.push(
      html`<h3>Video</h3>
        ${videoFigures}`,
    );

  const fileRows = [...traces, ...others].map((a) => {
    const url = assetUrl(a);
    const label = url ? html`<a href="${url}">${a.name}</a>` : html`${a.name} <span class="meta">(not included)</span>`;
    return html`<tr>
      <td>${label}</td>
      <td>${a.kind}</td>
      <td>${fmtBytes(a.size)}</td>
    </tr>`;
  });
  if (fileRows.length) {
    out.push(
      html`<h3>Files</h3>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              ${fileRows}
            </tbody>
          </table>
        </div>
        <p class="meta">
          Trace archives open at <code>trace.playwright.dev</code> or in any Playwright trace viewer.
        </p>`,
    );
  }

  return joinHtml(out, '\n');
}

function renderSteps(steps: unknown): RawHtml {
  if (!Array.isArray(steps) || !steps.length) return raw('');
  const rows = steps.map((s) => {
    const step = s as Record<string, any>;
    return html`<tr>
      <td>${String(step.title ?? '')}</td>
      <td>${String(step.category ?? '')}</td>
      <td>${fmtDuration(step.duration)}</td>
    </tr>`;
  });
  return html`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Step</th>
          <th>Category</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>`;
}

function renderConsole(logs: unknown): RawHtml {
  if (!Array.isArray(logs) || !logs.length) return raw('');
  return pre(
    logs
      .map((l) => {
        const entry = l as Record<string, any>;
        return `[${entry.type ?? 'log'}] ${entry.text ?? ''}`;
      })
      .join('\n'),
  );
}

function renderNetwork(requests: unknown): RawHtml {
  if (!Array.isArray(requests) || !requests.length) return raw('');
  const rows = requests.map((r) => {
    const req = r as Record<string, any>;
    return html`<tr>
      <td>${String(req.method ?? '')}</td>
      <td>${String(req.status ?? '')}</td>
      <td>${fmtDuration(req.duration)}</td>
      <td>${String(req.url ?? '')}</td>
    </tr>`;
  });
  return html`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Method</th>
          <th>Status</th>
          <th>Time</th>
          <th>URL</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>`;
}

function renderCase(exportCase: ExportCase, opts: RenderOptions, index: number, total: number): RawHtml {
  const d = exportCase.detail as Record<string, any>;
  const run = (d.testRun ?? {}) as Record<string, any>;
  const browser = (d.browser ?? {}) as Record<string, any>;
  const parts: (RawHtml | string)[] = [];

  parts.push(html`<header>
    <h2>${exportCase.title} <span class="badge ${exportCase.status}">${exportCase.status}</span></h2>
    <p class="meta"><code>${exportCase.location ?? exportCase.filePath ?? ''}</code></p>
  </header>`);

  parts.push(
    facts([
      ['Duration', fmtDuration(d.duration)],
      ['Retries', d.retries != null ? String(d.retries) : null],
      ['Run', run.id != null ? `#${run.id}` : null],
      ['Browser', browser.projectName ?? browser.browserName ?? null],
      ['Worker', d.workerIndex != null ? String(d.workerIndex) : null],
      ['Shard', d.shardIndex != null ? String(d.shardIndex) : null],
      ['New regression', d.isNewRegression ? 'yes' : null],
      ['Newly flaky', d.isNewFlaky ? 'yes' : null],
      ['Slowest step', d.slowestStep ? `${d.slowestStep} (${fmtDuration(d.slowestStepDuration)})` : null],
    ]),
  );

  if (d.error) parts.push(details('Error', pre(String(d.error)), true));
  parts.push(renderDiagnosis(exportCase.diagnosis));

  const assetsHtml = renderAssets(exportCase, opts.assetUrl);
  if (toHtmlString(assetsHtml).trim()) parts.push(details('Evidence', assetsHtml, true));

  parts.push(details('Steps', renderSteps(d.steps)));
  parts.push(details('Console', renderConsole(d.consoleLogs)));
  parts.push(details('Network', renderNetwork(d.networkRequests)));
  if (d.testSource) parts.push(details('Test source', pre(String(d.testSource))));
  if (Array.isArray(d.testSourceFrames) && d.testSourceFrames.length) {
    parts.push(
      details(
        'Call stack',
        joinHtml(
          (d.testSourceFrames as Record<string, any>[]).map(
            (f) =>
              html`<h3>${`${f.file ?? ''}:${f.line ?? ''}`}</h3>
                ${pre(String(f.snippet ?? ''))}`,
          ),
        ),
      ),
    );
  }
  if (d.ariaSnapshot) parts.push(details('ARIA snapshot', pre(String(d.ariaSnapshot))));
  if (d.pageState) parts.push(details('Page state', pre(JSON.stringify(d.pageState, null, 2))));
  if (d.webVitals) parts.push(details('Web vitals', pre(JSON.stringify(d.webVitals, null, 2))));

  return html`<section class="case">
    <p class="meta no-print">Case ${index + 1} of ${total}</p>
    ${joinHtml(parts, '\n')}
  </section>`;
}

function renderClusterHeader(bundle: ExportBundle): RawHtml {
  const c = bundle.cluster as Record<string, any> | null;
  if (!c) return raw('');
  const parts: (RawHtml | string)[] = [
    facts([
      ['Signature', c.signature],
      ['Error type', c.errorType],
      ['Selector', c.selector],
      ['Status', c.status],
      ['Occurrences', c.occurrences != null ? String(c.occurrences) : null],
      ['Affected tests', c.affectedTests != null ? String(c.affectedTests) : null],
      ['First seen', c.firstSeenAt ? new Date(c.firstSeenAt).toISOString() : null],
      ['Last seen', c.lastSeenAt ? new Date(c.lastSeenAt).toISOString() : null],
      ['Triage note', c.triageNote],
    ]),
  ];
  if (c.sampleError) parts.push(details('Representative error', pre(String(c.sampleError)), true));
  parts.push(renderDiagnosis((c.diagnosis ?? null) as Record<string, any> | null));

  if (bundle.truncatedCases.length) {
    parts.push(
      details(
        `Other affected tests (${bundle.truncatedCases.length}, evidence not included)`,
        html`<ul>
          ${bundle.truncatedCases.map((t) => html`<li>${t.title} <span class="meta">${t.filePath ?? ''}</span></li>`)}
        </ul>`,
      ),
    );
  }
  return joinHtml(parts, '\n');
}

const OMISSION_REASONS: Record<string, string> = {
  'too-large': 'larger than the per-file inline limit',
  'budget-exhausted': 'the export size budget was reached',
  unreadable: 'the file could not be read from storage',
  'html-format': 'not embeddable in a single HTML file — use the ZIP export',
};

function renderOmissions(bundle: ExportBundle): RawHtml {
  if (!bundle.omitted.length) return raw('');
  const rows = bundle.omitted.map(
    (o) => html`<tr>
      <td>${o.name}</td>
      <td>${o.kind}</td>
      <td>${fmtBytes(o.bytes)}</td>
      <td>${OMISSION_REASONS[o.reason] ?? o.reason}</td>
    </tr>`,
  );
  return html`<section class="card">
    <div class="body">
      <h2>Omitted from this export</h2>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Kind</th>
              <th>Size</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  </section>`;
}

export function renderExportHtml(bundle: ExportBundle, opts: RenderOptions): string {
  const kindLabel = bundle.kind === 'cluster' ? 'Failure cluster' : 'Test execution';
  const projectLabel = bundle.project ? bundle.project.label || bundle.project.name : null;

  const head = joinHtml([
    raw('<meta charset="utf-8">'),
    raw('<meta name="viewport" content="width=device-width, initial-scale=1">'),
    // Standalone files are opened from disk and carry untrusted test output —
    // deny everything except the data/blob URIs this document embeds itself.
    raw(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: 'self'; media-src data: blob: 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:">`,
    ),
    html`<title>${`Piwi — ${bundle.title}`}</title>`,
    raw(`<style>${STYLES}</style>`),
  ]);

  const body = joinHtml(
    [
      raw('<div class="wrap">'),
      html`<header class="doc">
        <p class="meta">${kindLabel}${projectLabel ? ` · ${projectLabel}` : ''}</p>
        <h1>${bundle.title}</h1>
        <p class="meta">Exported ${bundle.generatedAt}${bundle.piwiVersion ? ` · Piwi ${bundle.piwiVersion}` : ''}</p>
        ${bundle.sourceUrl ? html`<p class="meta">Source: <code>${bundle.sourceUrl}</code></p>` : ''}
        <div class="toolbar no-print">
          <button type="button" data-action="print">Print / Save as PDF</button>
          <button type="button" data-action="expand">Expand all</button>
        </div>
      </header>`,
      renderClusterHeader(bundle),
      ...bundle.cases.map((c, i) => renderCase(c, opts, i, bundle.cases.length)),
      bundle.cases.length === 0 ? html`<p class="note">No executions were included in this export.</p>` : '',
      renderOmissions(bundle),
      html`<p class="meta">Generated by Piwi. This file is self-contained and needs no network connection.</p>`,
      raw('</div>'),
      raw(`<script>${SCRIPT}${opts.print ? AUTO_PRINT : ''}</script>`),
    ],
    '\n',
  );

  return `<!DOCTYPE html><html lang="en"><head>${toHtmlString(head)}</head><body>${toHtmlString(body)}</body></html>`;
}
