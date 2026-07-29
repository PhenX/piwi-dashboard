/**
 * Turns pasted Playwright page-object-method/helper source into a proposed
 * test-function catalog entry — the AI half of registering a function from
 * its own code. Grounded the same way AI diagnosis is: the model only ever
 * describes what's already in the pasted code (never asked to invent a
 * step), and the response is strictly schema-validated (`validateExtractedFunction`,
 * `shared/test-function-extract-prompt.ts`) before it's handed back as a
 * *draft* — nothing is written to the catalog here; the caller still goes
 * through the normal create endpoint after the user reviews it.
 */
import { callAiProvider } from './ai-provider';
import type { ResolvedAiRole } from '~~/types/api';
import {
  EXTRACT_SYSTEM_PROMPT,
  EXTRACT_JSON_SCHEMA,
  MAX_EXTRACT_CODE_CHARS,
  validateExtractedFunction,
  type ExtractedTestFunction,
} from '#shared/test-function-extract-prompt';

export type { ExtractedTestFunction };

export async function extractTestFunctionFromCode(role: ResolvedAiRole, code: string): Promise<ExtractedTestFunction> {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('Paste some function source code first.');
  if (trimmed.length > MAX_EXTRACT_CODE_CHARS) {
    throw new Error(
      `That's too much code to analyze at once (max ${MAX_EXTRACT_CODE_CHARS.toLocaleString()} characters) — paste a single function.`,
    );
  }

  const res = await callAiProvider(role, {
    system: EXTRACT_SYSTEM_PROMPT,
    user: `Extract the pattern from this function:\n\n\`\`\`\n${trimmed}\n\`\`\``,
    jsonSchema: EXTRACT_JSON_SCHEMA as unknown as object,
    maxTokens: 2048,
    effort: 'low',
  });

  return validateExtractedFunction(res.text);
}
