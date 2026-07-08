import { describe, test, expect } from 'vitest';
import {
  sanitizeUrl,
  sanitizeNetworkRequests,
  sanitizeWebVitals,
  sanitizeGitRemoteUrl,
  sanitizeMetadata,
  sanitizeConsoleLogs,
} from '../../server/utils/sanitize';

describe('sanitizeUrl', () => {
  test('strips query string and fragment, keeping scheme + host + path', () => {
    expect(sanitizeUrl('https://example.com/path?token=secret#frag')).toBe('https://example.com/path');
  });

  test('drops embedded credentials via the host', () => {
    expect(sanitizeUrl('https://user:pass@example.com/p?q=1')).toBe('https://example.com/p');
  });

  test('returns unparseable (relative) inputs unchanged', () => {
    expect(sanitizeUrl('/relative/path?x=1')).toBe('/relative/path?x=1');
    expect(sanitizeUrl('not a url at all')).toBe('not a url at all');
  });
});

describe('sanitizeGitRemoteUrl (secret leak prevention)', () => {
  test('strips a token-style userinfo from an https remote', () => {
    expect(sanitizeGitRemoteUrl('https://x-access-token:ghs_abc123@github.com/org/repo.git')).toBe(
      'https://github.com/org/repo.git',
    );
  });

  test('strips user:pass userinfo', () => {
    expect(sanitizeGitRemoteUrl('https://alice:hunter2@gitlab.com/o/r.git')).toBe('https://gitlab.com/o/r.git');
  });

  test('leaves a credential-free https remote intact', () => {
    expect(sanitizeGitRemoteUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo.git');
  });

  test('returns an SSH remote (unparseable as URL) unchanged', () => {
    expect(sanitizeGitRemoteUrl('git@github.com:org/repo.git')).toBe('git@github.com:org/repo.git');
  });
});

describe('sanitizeNetworkRequests', () => {
  test('returns null for missing or non-array input', () => {
    expect(sanitizeNetworkRequests(null)).toBeNull();
    expect(sanitizeNetworkRequests(undefined)).toBeNull();
    expect(sanitizeNetworkRequests('nope' as unknown as unknown[])).toBeNull();
  });

  test('strips query params from surviving request URLs', () => {
    const out = sanitizeNetworkRequests([
      { url: 'https://api.example.com/data?token=secret', resourceType: 'fetch', status: 200, duration: 10 },
    ]);
    expect(out).not.toBeNull();
    expect(out![0]!.url).toBe('https://api.example.com/data');
  });

  test('returns null when nothing survives filtering', () => {
    expect(sanitizeNetworkRequests([])).toBeNull();
  });
});

describe('sanitizeWebVitals', () => {
  test('strips the query string from the navigation URL', () => {
    expect(sanitizeWebVitals({ navigation: { url: 'https://app.example.com/p?u=alice' }, lcp: 1200 })).toEqual({
      navigation: { url: 'https://app.example.com/p' },
      lcp: 1200,
    });
  });

  test('passes vitals through unchanged when there is no navigation block', () => {
    expect(sanitizeWebVitals({ lcp: 900 })).toEqual({ lcp: 900 });
  });

  test('returns null for empty input', () => {
    expect(sanitizeWebVitals(null)).toBeNull();
  });
});

describe('sanitizeMetadata', () => {
  test('strips credentials from scm.remoteUrl', () => {
    expect(sanitizeMetadata({ scm: { remoteUrl: 'https://tok@github.com/o/r.git', branch: 'main' } })).toEqual({
      scm: { remoteUrl: 'https://github.com/o/r.git', branch: 'main' },
    });
  });

  test('leaves metadata without an scm block untouched', () => {
    expect(sanitizeMetadata({ ci: { provider: 'github' } })).toEqual({ ci: { provider: 'github' } });
  });

  test('returns null for empty input', () => {
    expect(sanitizeMetadata(null)).toBeNull();
  });
});

describe('sanitizeConsoleLogs', () => {
  test('strips the query string from the URL part of the location', () => {
    const out = sanitizeConsoleLogs([{ type: 'error', text: 'boom', location: 'https://app.example.com/p?u=1:12:5' }]);
    expect(out![0]!.location).toBe('https://app.example.com/p:12:5');
  });

  test('leaves entries whose location is not a url:line:col string', () => {
    const entry = { type: 'log', text: 'hi', location: 'not-a-location' };
    expect(sanitizeConsoleLogs([entry])![0]).toEqual(entry);
  });

  test('returns null for missing input', () => {
    expect(sanitizeConsoleLogs(null)).toBeNull();
  });
});
