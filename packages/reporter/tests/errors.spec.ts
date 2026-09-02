import { describe, it, expect } from 'vitest';
import { errorMessage } from '../src/internal/support/errors.js';
import { HttpError } from '../src/internal/transport/http-client.js';

describe('errorMessage', () => {
  it('returns the message of a plain Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns the message of an HttpError subclass', () => {
    expect(errorMessage(new HttpError(500, 'server exploded'))).toBe('server exploded');
  });

  it('stringifies a raw string', () => {
    expect(errorMessage('just a string')).toBe('just a string');
  });

  it('stringifies a number', () => {
    expect(errorMessage(42)).toBe('42');
  });

  it('stringifies null and undefined', () => {
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('stringifies a plain object without a message', () => {
    expect(errorMessage({ code: 'E' })).toBe('[object Object]');
  });
});
