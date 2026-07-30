import { describe, it, expect } from 'vitest';
import { isUiMode } from '../src/internal/support/run-mode.js';

const NODE = ['/usr/bin/node', '/path/to/playwright'];

describe('isUiMode', () => {
  it('is false for a plain test run', () => {
    expect(isUiMode([...NODE, 'test'])).toBe(false);
    expect(isUiMode([...NODE, 'test', 'tests/login.spec.ts'])).toBe(false);
  });

  it('detects the --ui flag', () => {
    expect(isUiMode([...NODE, 'test', '--ui'])).toBe(true);
  });

  it('detects --ui-host / --ui-port in both bare and = forms', () => {
    expect(isUiMode([...NODE, 'test', '--ui-host', '0.0.0.0'])).toBe(true);
    expect(isUiMode([...NODE, 'test', '--ui-host=0.0.0.0'])).toBe(true);
    expect(isUiMode([...NODE, 'test', '--ui-port', '0'])).toBe(true);
    expect(isUiMode([...NODE, 'test', '--ui-port=9000'])).toBe(true);
  });

  it('does not confuse a similarly-named token for a UI flag', () => {
    // A positional file filter or unrelated flag must not trigger UI mode.
    expect(isUiMode([...NODE, 'test', 'ui.spec.ts'])).toBe(false);
    expect(isUiMode([...NODE, 'test', '--ui-nonsense'])).toBe(false);
  });

  it('only considers tokens after the `test` subcommand', () => {
    // A `--ui` token sitting before `test` is not part of the test invocation.
    expect(isUiMode([...NODE, '--ui', 'test'])).toBe(false);
  });
});
