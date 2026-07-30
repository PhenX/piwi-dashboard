import { describe, it, expect } from 'vitest';
import { classifyInputKind, isPasswordInput } from '../../src/content/record-capture.js';

describe('classifyInputKind', () => {
  it('classifies a <select> regardless of type', () => {
    expect(classifyInputKind('select', null)).toBe('select');
    expect(classifyInputKind('SELECT', null)).toBe('select');
  });

  it('classifies checkbox and radio inputs', () => {
    expect(classifyInputKind('input', 'checkbox')).toBe('checkbox');
    expect(classifyInputKind('input', 'radio')).toBe('radio');
  });

  it('defaults an <input> with no/other type to text', () => {
    expect(classifyInputKind('input', null)).toBe('text');
    expect(classifyInputKind('input', 'email')).toBe('text');
    expect(classifyInputKind('input', 'password')).toBe('text');
  });

  it('is case-insensitive on the type attribute', () => {
    expect(classifyInputKind('input', 'CHECKBOX')).toBe('checkbox');
  });

  it('returns null for anything else (button, textarea, div, ...)', () => {
    expect(classifyInputKind('button', null)).toBeNull();
    expect(classifyInputKind('textarea', null)).toBeNull();
    expect(classifyInputKind('div', null)).toBeNull();
  });
});

describe('isPasswordInput', () => {
  it('is true only for <input type="password">', () => {
    expect(isPasswordInput('input', 'password')).toBe(true);
    expect(isPasswordInput('input', 'PASSWORD')).toBe(true);
  });

  it('is false for other input types and other tags', () => {
    expect(isPasswordInput('input', 'text')).toBe(false);
    expect(isPasswordInput('input', null)).toBe(false);
    expect(isPasswordInput('textarea', 'password')).toBe(false);
  });
});
