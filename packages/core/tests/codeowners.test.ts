import { describe, test, expect } from 'vitest';
import {
  compileCodeowners,
  ownersForPath,
  parseCodeowners,
  primaryOwnerForPath,
  type CompiledCodeowners,
} from '../src/codeowners';

function compile(content: string): CompiledCodeowners {
  return compileCodeowners(parseCodeowners(content));
}

describe('parseCodeowners', () => {
  test('reads pattern and owners', () => {
    expect(parseCodeowners('tests/ @qa-team @alice')).toEqual([
      { pattern: 'tests/', owners: ['@qa-team', '@alice'], line: 1 },
    ]);
  });

  test('ignores comments, blank lines and trailing comments', () => {
    const rules = parseCodeowners(['# ownership', '', 'tests/ @qa   # the QA team', '   '].join('\n'));
    expect(rules).toEqual([{ pattern: 'tests/', owners: ['@qa'], line: 3 }]);
  });

  test('drops a pattern with no owners', () => {
    expect(parseCodeowners('tests/')).toEqual([]);
  });

  test('accepts emails as owners', () => {
    expect(parseCodeowners('*.ts qa@example.com')[0]?.owners).toEqual(['qa@example.com']);
  });

  test('records the line number for display', () => {
    expect(parseCodeowners('\n\n*.ts @a')[0]?.line).toBe(3);
  });
});

describe('ownersForPath', () => {
  test('the last matching rule wins', () => {
    const compiled = compile(['* @default-team', 'tests/checkout/ @checkout-team'].join('\n'));
    expect(ownersForPath(compiled, 'tests/checkout/pay.spec.ts')).toEqual(['@checkout-team']);
    expect(ownersForPath(compiled, 'tests/other/thing.spec.ts')).toEqual(['@default-team']);
  });

  test('returns an empty array when nothing matches', () => {
    expect(ownersForPath(compile('docs/ @writers'), 'tests/a.spec.ts')).toEqual([]);
  });

  test('a bare name floats to any depth', () => {
    const compiled = compile('tests @qa');
    expect(ownersForPath(compiled, 'tests/a.spec.ts')).toEqual(['@qa']);
    expect(ownersForPath(compiled, 'apps/web/tests/a.spec.ts')).toEqual(['@qa']);
  });

  test('an extension pattern floats to any depth', () => {
    const compiled = compile('*.spec.ts @qa');
    expect(ownersForPath(compiled, 'a.spec.ts')).toEqual(['@qa']);
    expect(ownersForPath(compiled, 'tests/deep/a.spec.ts')).toEqual(['@qa']);
    expect(ownersForPath(compiled, 'tests/a.test.ts')).toEqual([]);
  });

  test('a leading slash anchors to the repository root', () => {
    const compiled = compile('/tests @qa');
    expect(ownersForPath(compiled, 'tests/a.spec.ts')).toEqual(['@qa']);
    expect(ownersForPath(compiled, 'apps/web/tests/a.spec.ts')).toEqual([]);
  });

  test('an interior slash anchors too', () => {
    const compiled = compile('apps/web/ @web');
    expect(ownersForPath(compiled, 'apps/web/tests/a.spec.ts')).toEqual(['@web']);
    expect(ownersForPath(compiled, 'packages/apps/web/a.spec.ts')).toEqual([]);
  });

  test('a directory owns everything beneath it', () => {
    const compiled = compile('/tests/checkout/ @checkout');
    expect(ownersForPath(compiled, 'tests/checkout/deep/nested/a.spec.ts')).toEqual(['@checkout']);
  });

  // `a/**/b` has to match `a/b`, which is why `**` cannot just become `.*`.
  test('** spans zero or more segments', () => {
    const compiled = compile('/apps/**/tests/ @qa');
    expect(ownersForPath(compiled, 'apps/tests/a.spec.ts')).toEqual(['@qa']);
    expect(ownersForPath(compiled, 'apps/web/tests/a.spec.ts')).toEqual(['@qa']);
    expect(ownersForPath(compiled, 'apps/web/admin/tests/a.spec.ts')).toEqual(['@qa']);
    expect(ownersForPath(compiled, 'apps/web/src/a.spec.ts')).toEqual([]);
  });

  test('a trailing ** matches everything below', () => {
    const compiled = compile('/apps/** @apps');
    expect(ownersForPath(compiled, 'apps/web/a.spec.ts')).toEqual(['@apps']);
  });

  test('* does not cross a directory separator', () => {
    const compiled = compile('/tests/*.spec.ts @qa');
    expect(ownersForPath(compiled, 'tests/a.spec.ts')).toEqual(['@qa']);
    expect(ownersForPath(compiled, 'tests/deep/a.spec.ts')).toEqual([]);
  });

  test('? matches exactly one character', () => {
    const compiled = compile('/tests/a?.spec.ts @qa');
    expect(ownersForPath(compiled, 'tests/ab.spec.ts')).toEqual(['@qa']);
    expect(ownersForPath(compiled, 'tests/abc.spec.ts')).toEqual([]);
  });

  test('a dot in a pattern is literal, not a wildcard', () => {
    const compiled = compile('/tests/a.spec.ts @qa');
    expect(ownersForPath(compiled, 'tests/axspecxts')).toEqual([]);
  });

  test('tolerates a leading ./ on the queried path', () => {
    expect(ownersForPath(compile('/tests/ @qa'), './tests/a.spec.ts')).toEqual(['@qa']);
  });

  test('* on its own owns the whole repository', () => {
    const compiled = compile('* @everyone');
    expect(ownersForPath(compiled, 'anything/at/all.ts')).toEqual(['@everyone']);
  });
});

describe('primaryOwnerForPath', () => {
  test('takes the first owner, which is the conventional primary', () => {
    expect(primaryOwnerForPath(compile('/tests/ @first @second'), 'tests/a.spec.ts')).toBe('@first');
  });

  test('is null when nothing matches', () => {
    expect(primaryOwnerForPath(compile('/docs/ @writers'), 'tests/a.spec.ts')).toBeNull();
  });
});
