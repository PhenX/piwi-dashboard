/**
 * Zod building blocks for the test-function catalog's wire shape — shared by
 * the create/update endpoints and the AI-extraction endpoint so the three
 * don't drift into three slightly different ideas of what a valid pattern
 * step looks like. Mirrors `@piwitests/core/function-match`'s
 * `TestFunctionEntry` shape (that package has no validation library of its
 * own — it stays dependency-free — so the runtime check lives here instead).
 * Lives in `shared/` (no server-only imports — just zod) so the demo
 * router's client-side `validate-proposal` mirror can validate a pasted AI
 * response with this exact schema too, not a hand-rolled approximation.
 */
import { z } from 'zod';

export const testFunctionNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(120)
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'Must be a valid JS identifier');

export const stepActionSchema = z.enum([
  'goto',
  'click',
  'fill',
  'check',
  'uncheck',
  'selectOption',
  'press',
  'assertVisible',
]);

export const patternTargetSchema = z.object({
  role: z.string().nullish(),
  name: z.string().nullish(),
  testId: z.string().nullish(),
});

/**
 * `object` exists because most real Playwright helpers take an options bag
 * (`selectOption(page, { label }, { value })`), not positional scalars — its
 * `fields` list is what lets codegen emit a literal with the right keys. A
 * `paramSource` targets one of those fields via its own `path`.
 */
export const paramSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'object']),
  fields: z.array(z.string().min(1).max(80)).max(20).optional(),
});

export const patternStepSchema = z.object({
  action: stepActionSchema,
  target: patternTargetSchema,
});

export const paramSourceSchema = z.object({
  param: z.string().min(1),
  /** Which field of an `object` param this fills; omitted for a scalar param, which takes the value whole. */
  path: z.string().min(1).max(80).nullish(),
  stepIndex: z.number().int().min(0),
  from: z.enum(['text', 'value', 'testId']),
});

export const testFunctionKindSchema = z.enum(['page-object-method', 'helper', 'fixture']);

/**
 * What the AI extraction endpoint accepts back from the model. Deliberately
 * excludes `module` and `urlPattern` — a pasted function has no file path or
 * routing context to infer either from, so those stay user-supplied fields
 * in the review form rather than something the model is asked to guess.
 */
export const aiExtractedFunctionSchema = z.object({
  name: testFunctionNameSchema,
  kind: testFunctionKindSchema,
  receiver: z.string().max(120).nullish(),
  importName: z.string().max(120).nullish(),
  params: z.array(paramSchema).max(10),
  returnsPage: z.boolean().optional(),
  steps: z.array(patternStepSchema).min(1, 'At least one pattern step is required').max(30),
  paramSources: z.array(paramSourceSchema).max(10).optional(),
  /** The model's own confidence, 0-1 — surfaced in the review form so a low-confidence extraction reads as one. */
  confidence: z.number().min(0).max(1).optional(),
  /** What the model couldn't represent (unseen helper calls, collapsed branches, skipped locators) — shown beside the confidence so a thin pattern explains itself instead of looking complete. */
  notes: z.string().max(500).nullish(),
});

/**
 * The full wire shape for creating a catalog entry directly (unlike
 * `aiExtractedFunctionSchema`, includes `module`/`urlPattern`/`source` —
 * fields no extraction step can infer). Shared by the create endpoint
 * (`server/api/projects/[id]/test-functions.post.ts`) and the MCP
 * `create_test_function` tool so both hold a caller to the same shape.
 */
export const createTestFunctionSchema = z.object({
  name: testFunctionNameSchema,
  kind: testFunctionKindSchema,
  module: z.string().min(1, 'Module is required').max(240),
  receiver: z.string().max(120).nullish(),
  importName: z.string().max(120).nullish(),
  params: z.array(paramSchema).max(10),
  returnsPage: z.boolean().optional(),
  urlPattern: z.string().max(240).nullish(),
  steps: z.array(patternStepSchema).min(1, 'At least one pattern step is required').max(30),
  paramSources: z.array(paramSourceSchema).max(10).optional(),
  source: z.enum(['manual', 'scanned', 'recorded', 'ai-extracted']).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
