import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Read a snippet of source code surrounding the declaration line, optionally
 * highlighting a separate failing line. Returns a formatted string with line
 * numbers and markers (`>` for the failing line, `*` for the declaration), or
 * `null` on error.
 */
export function readSourceSnippet(
  file: string,
  declLine: number,
  context: number,
  failingLine?: number,
): string | null {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const anchor = failingLine ?? declLine;
    const start = Math.max(0, anchor - context - 1);
    const end = Math.min(lines.length, anchor + context);
    return lines
      .slice(start, end)
      .map((l, i) => {
        const lineNum = start + i + 1;
        const isFailing = failingLine != null && lineNum === failingLine;
        const isDecl = lineNum === declLine && !isFailing;
        let marker = '  ';
        if (isFailing) marker = '> ';
        else if (isDecl) marker = '* ';
        return `${marker}${String(lineNum).padStart(4)} | ${l}`;
      })
      .join('\n');
  } catch {
    return null;
  }
}

/**
 * Extract the line number of the first stack frame inside `testFile` from an
 * error's stack trace. Falls back to `declarationLine`.
 */
export function extractFailingLine(
  errorText: string | null | undefined,
  testFile: string,
  declarationLine: number,
): number {
  if (!errorText) return declarationLine;
  const expectedFile = path.resolve(testFile);
  const stackRe = /^\s+at (?:[^(]*\()?(.+?):(\d+):\d+\)?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = stackRe.exec(errorText)) !== null) {
    try {
      const frameFile = path.resolve(m[1]!);
      if (frameFile === expectedFile) {
        const line = parseInt(m[2]!, 10);
        if (!isNaN(line)) return line;
      }
    } catch {
      /* skip unresolvable paths */
    }
  }
  return declarationLine;
}
