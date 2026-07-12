import { describe, test, expect } from 'vitest';
import { isScreenshotFileRow } from '~~/server/utils/case-screenshots';

describe('isScreenshotFileRow', () => {
  test('accepts legacy type=screenshot rows', () => {
    expect(isScreenshotFileRow({ type: 'screenshot', path: 'x/shot.png' })).toBe(true);
  });

  test('accepts attachment rows with a screenshot subtype (incl. numbered variants)', () => {
    expect(isScreenshotFileRow({ type: 'attachment', subtype: 'screenshot', path: 'x/a.bin' })).toBe(true);
    expect(isScreenshotFileRow({ type: 'attachment', subtype: 'screenshot-1', path: 'x/a.bin' })).toBe(true);
  });

  test('accepts attachment rows with an image content-type label', () => {
    expect(isScreenshotFileRow({ type: 'attachment', subtype: 'my-shot', label: 'image/png', path: 'x/a' })).toBe(true);
  });

  test('accepts attachment rows with an image file extension', () => {
    expect(isScreenshotFileRow({ type: 'attachment', subtype: 'evidence', path: 'x/final-state.JPG' })).toBe(true);
  });

  test('rejects non-image attachments and other file types', () => {
    expect(isScreenshotFileRow({ type: 'attachment', subtype: 'video', label: 'video/webm', path: 'x/v.webm' })).toBe(
      false,
    );
    expect(isScreenshotFileRow({ type: 'attachment', subtype: 'error-context', path: 'x/error-context.md' })).toBe(
      false,
    );
    expect(isScreenshotFileRow({ type: 'trace', path: 'x/trace.zip' })).toBe(false);
    expect(isScreenshotFileRow({ type: 'report', subtype: 'html', path: 'x/index.html' })).toBe(false);
  });
});
