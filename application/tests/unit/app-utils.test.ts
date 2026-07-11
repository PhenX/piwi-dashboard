import { describe, test, expect, vi } from 'vitest';
import {
  formatBytes,
  formatDuration,
  prettyDateFormat,
  formatRelativeTime,
  getStatusColor,
  formatStatusLabel,
  clusterStatusColor,
  clusterErrorTypeColor,
  getFileApiPath,
  getTraceViewerUrl,
  errorMessage,
  filterCommits,
  scmFileStatusMeta,
  parsePatchLines,
  patchLineClass,
  renderAnsi,
  copyPreview,
  reportIcon,
  getBrowserIcon,
} from '../../app/utils/index';

describe('formatBytes', () => {
  test('handles zero / empty as "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
  });

  test('scales into KB/MB with two decimals', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(1048576)).toBe('1.00 MB');
  });
});

describe('formatDuration', () => {
  test('returns N/A for nullish input', () => {
    expect(formatDuration(null)).toBe('N/A');
    expect(formatDuration(undefined)).toBe('N/A');
  });

  test('formats seconds and prefixes a minus sign for negative durations', () => {
    expect(formatDuration(5000)).toBe('5 seconds');
    expect(formatDuration(-5000)).toBe('−5 seconds');
  });
});

describe('prettyDateFormat', () => {
  test('returns N/A for empty or invalid input', () => {
    expect(prettyDateFormat(null)).toBe('N/A');
    expect(prettyDateFormat('')).toBe('N/A');
    expect(prettyDateFormat('not-a-date')).toBe('N/A');
  });

  test('renders a valid date to a non-N/A string', () => {
    expect(prettyDateFormat(new Date('2024-01-01T00:00:00Z'))).not.toBe('N/A');
  });
});

describe('formatRelativeTime', () => {
  test('returns N/A for nullish input', () => {
    expect(formatRelativeTime(null)).toBe('N/A');
  });

  test('renders a past date with an "ago" suffix', () => {
    expect(formatRelativeTime(new Date(Date.now() - 60_000))).toContain('ago');
  });
});

describe('getStatusColor', () => {
  test('maps known statuses to badge colors', () => {
    expect(getStatusColor('passed')).toBe('success');
    expect(getStatusColor('failed')).toBe('error');
    expect(getStatusColor('timedout')).toBe('warning');
    expect(getStatusColor('timedOut')).toBe('warning');
    expect(getStatusColor('running')).toBe('info');
    expect(getStatusColor('cancelled')).toBe('neutral');
  });

  test('falls back to neutral for unknown statuses', () => {
    expect(getStatusColor('whatever')).toBe('neutral');
  });
});

describe('formatStatusLabel', () => {
  test('normalizes timedOut/timedout to "failed" and didnotrun to "didn\'t run"', () => {
    expect(formatStatusLabel('timedOut')).toBe('failed');
    expect(formatStatusLabel('timedout')).toBe('failed');
    expect(formatStatusLabel('didnotrun')).toBe("didn't run");
    expect(formatStatusLabel('passed')).toBe('passed');
  });
});

describe('cluster color helpers', () => {
  test('clusterStatusColor', () => {
    expect(clusterStatusColor('open')).toBe('warning');
    expect(clusterStatusColor('resolved')).toBe('success');
    expect(clusterStatusColor('ignored')).toBe('neutral');
    expect(clusterStatusColor(null)).toBe('neutral');
    expect(clusterStatusColor('mystery')).toBe('neutral');
  });

  test('clusterErrorTypeColor', () => {
    expect(clusterErrorTypeColor('timeout')).toBe('warning');
    expect(clusterErrorTypeColor('assertion')).toBe('error');
    expect(clusterErrorTypeColor('strict-mode')).toBe('info');
    expect(clusterErrorTypeColor('navigation')).toBe('secondary');
    expect(clusterErrorTypeColor('crash')).toBe('error');
    expect(clusterErrorTypeColor(null)).toBe('neutral');
  });
});

describe('file path helpers', () => {
  test('getFileApiPath strips the storage prefix and passes relative paths through', () => {
    expect(getFileApiPath('.data/storage/reports/index.html')).toBe('reports/index.html');
    expect(getFileApiPath('reports/index.html')).toBe('reports/index.html');
  });

  test('getTraceViewerUrl embeds the encoded file API URL using the current origin', () => {
    vi.stubGlobal('location', { origin: 'http://localhost:3000' });
    const url = getTraceViewerUrl('.data/storage/t.zip');
    expect(url).toBe(`/trace-viewer/?trace=${encodeURIComponent('http://localhost:3000/api/files/t.zip')}`);
    vi.unstubAllGlobals();
  });

  test('getTraceViewerUrl prefixes the base path for both the viewer and the trace URL', () => {
    vi.stubGlobal('location', { origin: 'http://localhost:3000' });
    const url = getTraceViewerUrl('.data/storage/t.zip', '/demo/');
    expect(url).toBe(`/demo/trace-viewer/?trace=${encodeURIComponent('http://localhost:3000/demo/api/files/t.zip')}`);
    vi.unstubAllGlobals();
  });

  test('getTraceViewerUrl falls back to a relative trace URL when location is absent (SSR)', () => {
    vi.stubGlobal('location', undefined);
    const url = getTraceViewerUrl('t.zip');
    expect(url).toBe(`/trace-viewer/?trace=${encodeURIComponent('/api/files/t.zip')}`);
    vi.unstubAllGlobals();
  });

  test('getTraceViewerUrl points at the static asset URL when staticAsset is set (demo mode)', () => {
    vi.stubGlobal('location', { origin: 'http://localhost:3000' });
    const url = getTraceViewerUrl('demo/traces/t.zip', '/demo/', true);
    expect(url).toBe(`/demo/trace-viewer/?trace=${encodeURIComponent('http://localhost:3000/demo/demo/traces/t.zip')}`);
    vi.unstubAllGlobals();
  });
});

describe('errorMessage (fetch error unwrapping)', () => {
  test('unwraps the { data: { message } } shape', () => {
    expect(errorMessage({ data: { message: 'Boom' } })).toBe('Boom');
  });

  test('falls back to the top-level message', () => {
    expect(errorMessage({ message: 'Plain' })).toBe('Plain');
  });

  test('returns the fallback for non-object / empty values', () => {
    expect(errorMessage('a string')).toBe('Unknown error');
    expect(errorMessage(null)).toBe('Unknown error');
    expect(errorMessage({}, 'custom fallback')).toBe('custom fallback');
  });
});

describe('filterCommits', () => {
  const commits = [
    { sha: 'aaa111bbb', shortSha: 'aaa111b', message: 'Fix login bug', author: 'Alice' },
    { sha: 'ccc222ddd', shortSha: 'ccc222d', message: 'Add dashboard', author: 'Bob' },
  ] as never[];

  test('returns all commits for an empty query', () => {
    expect(filterCommits(commits, '   ')).toHaveLength(2);
  });

  test('matches on message, author, and sha (case-insensitive)', () => {
    expect(filterCommits(commits, 'login')).toHaveLength(1);
    expect(filterCommits(commits, 'bob')).toHaveLength(1);
    expect(filterCommits(commits, 'ccc222')).toHaveLength(1);
    expect(filterCommits(commits, 'nomatch')).toHaveLength(0);
  });
});

describe('scmFileStatusMeta', () => {
  test('maps status to icon + badge color', () => {
    expect(scmFileStatusMeta('added').badgeColor).toBe('success');
    expect(scmFileStatusMeta('removed').badgeColor).toBe('error');
    expect(scmFileStatusMeta('renamed').badgeColor).toBe('info');
    expect(scmFileStatusMeta('modified').badgeColor).toBe('neutral');
  });
});

describe('parsePatchLines', () => {
  test('classifies added, removed, hunk and context lines', () => {
    const lines = parsePatchLines(
      ['@@ -1,2 +1,2 @@', '+added', '-removed', ' context', '+++ b/file', '--- a/file'].join('\n'),
    );
    expect(lines.map((l) => l.type)).toEqual(['hunk', 'add', 'remove', 'context', 'context', 'context']);
  });

  test('patchLineClass has an entry for every line type', () => {
    expect(Object.keys(patchLineClass).sort()).toEqual(['add', 'context', 'hunk', 'remove']);
  });
});

describe('renderAnsi', () => {
  test('escapes HTML in plain text', () => {
    expect(renderAnsi('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
  });

  test('wraps colored segments in styled spans and resets on code 0', () => {
    expect(renderAnsi('\u001B[31mred\u001B[0m')).toBe('<span style="color:#dc2626">red</span>');
  });
});

describe('copyPreview', () => {
  test('returns empty string for nullish input', () => {
    expect(copyPreview(null)).toBe('');
    expect(copyPreview(undefined)).toBe('');
  });

  test('joins newlines with a middot and truncates past the cap', () => {
    expect(copyPreview('a\nb')).toBe('a · b');
    expect(copyPreview('x'.repeat(200), 10)).toBe('xxxxxxxxxx…');
  });
});

describe('icon helpers', () => {
  test('reportIcon maps known report types', () => {
    expect(reportIcon('html')).toBe('i-lucide-layout-dashboard');
    expect(reportIcon('blob')).toBe('i-lucide-download');
    expect(reportIcon('unknown')).toBe('i-lucide-file-text');
  });

  test('getBrowserIcon maps browser families', () => {
    expect(getBrowserIcon('chromium')).toBe('i-simple-icons-googlechrome');
    expect(getBrowserIcon('firefox')).toBe('i-simple-icons-firefoxbrowser');
    expect(getBrowserIcon('webkit')).toBe('i-simple-icons-safari');
    expect(getBrowserIcon(null)).toBe('i-lucide-globe');
  });
});
