import { describe, test, expect } from 'vitest';
import { normalizeBaseUrl, projectCatalogUrl } from '../../src/shared/piwi-client';

describe('normalizeBaseUrl', () => {
  test('trims whitespace and a trailing slash', () => {
    expect(normalizeBaseUrl('  https://piwi.example.com/  ')).toBe('https://piwi.example.com');
  });

  test('strips multiple trailing slashes', () => {
    expect(normalizeBaseUrl('https://piwi.example.com///')).toBe('https://piwi.example.com');
  });

  test('leaves an already-clean URL untouched', () => {
    expect(normalizeBaseUrl('https://piwi.example.com')).toBe('https://piwi.example.com');
  });
});

describe('projectCatalogUrl', () => {
  test('builds the dashboard test-functions page URL for a project', () => {
    expect(projectCatalogUrl('https://piwi.example.com', 7)).toBe('https://piwi.example.com/projects/7/test-functions');
  });

  test('normalizes a trailing slash on the instance URL first', () => {
    expect(projectCatalogUrl('https://piwi.example.com/', 7)).toBe(
      'https://piwi.example.com/projects/7/test-functions',
    );
  });
});
