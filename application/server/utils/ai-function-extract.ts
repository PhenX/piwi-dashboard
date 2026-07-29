/**
 * Turns pasted Playwright page-object-method/helper source into a proposed
 * test-function catalog entry — the AI half of registering a function from
 * its own code. Grounded the same way AI diagnosis is: the model only ever
 * describes what's already in the pasted code (never asked to invent a
 * step), and the response is strictly schema-validated before it's handed
 * back as a *draft* — nothing is written to the catalog here; the caller
 * still goes through the normal create endpoint after the user reviews it.
 */
import { callAiProvider } from './ai-provider';
import type { ResolvedAiRole } from '~~/types/api';
import { aiExtractedFunctionSchema } from './test-function-schemas';
import type { z } from 'zod';

/** A page-object method/helper is small; reject pasting a whole file — keeps cost/latency bounded and the model focused. */
const MAX_CODE_CHARS = 20_000;

const EXTRACT_SYSTEM_PROMPT = `You analyze a single Playwright page-object method or helper function's TypeScript/JavaScript source code and extract a structured, reusable pattern describing what it does. You never execute the code — this is text analysis only. Reply strictly as JSON matching the given schema, nothing else.

Rules:
- "kind" is "page-object-method" when the code is a class method acting on "this.page" (or a "page" property) — set "receiver" to a sensible instance variable name (camelCase of the class name) and "importName" to the class name. "kind" is "helper" for a standalone exported function taking a Playwright "page" as its first parameter — "receiver" and "importName" must be null in that case. Use "fixture" only if the function is clearly Playwright fixture setup, not a page action.
- "params" lists the function's own parameters (excluding "page"/"this"), inferring "type" as "string", "number", or "boolean" from the TypeScript type annotation or, absent one, from how the value is used.
- "steps" is the ordered sequence of page interactions the function performs, one entry per Playwright locator-then-action call (".click()", ".fill(value)", ".check()", ".uncheck()", ".selectOption(value)", ".press(key)"; a "page.goto(...)" call becomes a "goto" step). For each step's "target": "getByTestId('x')" sets "testId" only; "getByRole('role', { name: 'X' })" sets both "role" and "name"; a bare "getByRole('role')" sets only "role"; "getByText"/"getByLabel"/"getByPlaceholder" set "name" to that text and leave "role" null. Skip a step whose locator can't be classified this way rather than guessing.
- "paramSources" maps a step's argument back to a function parameter when that argument IS the parameter (e.g. ".fill(username)" where "username" is a parameter) — "from" is "value" for fill/selectOption/press arguments, "testId" when the parameter is interpolated into a getByTestId call, "text" when interpolated into a name/text match. Omit an entry when a step's value is a literal, not a parameter.
- "confidence": your own 0-1 confidence that "steps" faithfully represents what the code does — lower it for loops, conditionals, or calls to other helper functions you can't see the inside of.
- Never invent a step that isn't evidenced by an actual Playwright call in the code.`;

const EXTRACT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    kind: { type: 'string', enum: ['page-object-method', 'helper', 'fixture'] },
    receiver: { type: ['string', 'null'] },
    importName: { type: ['string', 'null'] },
    params: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, type: { type: 'string', enum: ['string', 'number', 'boolean'] } },
        required: ['name', 'type'],
        additionalProperties: false,
      },
    },
    returnsPage: { type: 'boolean' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['goto', 'click', 'fill', 'check', 'uncheck', 'selectOption', 'press', 'assertVisible'],
          },
          target: {
            type: 'object',
            properties: {
              role: { type: ['string', 'null'] },
              name: { type: ['string', 'null'] },
              testId: { type: ['string', 'null'] },
            },
            additionalProperties: false,
          },
        },
        required: ['action', 'target'],
        additionalProperties: false,
      },
    },
    paramSources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          param: { type: 'string' },
          stepIndex: { type: 'integer' },
          from: { type: 'string', enum: ['text', 'value', 'testId'] },
        },
        required: ['param', 'stepIndex', 'from'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'number' },
  },
  required: ['name', 'kind', 'params', 'steps'],
  additionalProperties: false,
} as const;

/** Same defensive 3-tier fallback as `parseDiagnosisJson` (`shared/ai-diagnosis.ts`): most providers return bare JSON, some wrap it in a fenced code block regardless of instructions. */
function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenceStripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    try {
      return JSON.parse(fenceStripped);
    } catch {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) throw new Error('Could not extract JSON from the AI response');
      return JSON.parse(text.slice(start, end + 1));
    }
  }
}

export type ExtractedTestFunction = z.infer<typeof aiExtractedFunctionSchema> & {
  receiver: string | null;
  importName: string | null;
  returnsPage: boolean;
  paramSources: NonNullable<z.infer<typeof aiExtractedFunctionSchema>['paramSources']>;
  confidence: number;
};

export async function extractTestFunctionFromCode(role: ResolvedAiRole, code: string): Promise<ExtractedTestFunction> {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('Paste some function source code first.');
  if (trimmed.length > MAX_CODE_CHARS) {
    throw new Error(
      `That's too much code to analyze at once (max ${MAX_CODE_CHARS.toLocaleString()} characters) — paste a single function.`,
    );
  }

  const res = await callAiProvider(role, {
    system: EXTRACT_SYSTEM_PROMPT,
    user: `Extract the pattern from this function:\n\n\`\`\`\n${trimmed}\n\`\`\``,
    jsonSchema: EXTRACT_JSON_SCHEMA as unknown as object,
    maxTokens: 2048,
    effort: 'low',
  });

  let parsed: unknown;
  try {
    parsed = parseJsonLoose(res.text);
  } catch {
    throw new Error("The AI response wasn't valid JSON — try again, or fill in the pattern by hand.");
  }

  const validation = aiExtractedFunctionSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(
      "The AI couldn't produce a valid pattern from that code — try a smaller function, or fill in the pattern by hand.",
    );
  }

  return {
    ...validation.data,
    receiver: validation.data.receiver ?? null,
    importName: validation.data.importName ?? null,
    returnsPage: validation.data.returnsPage ?? false,
    paramSources: validation.data.paramSources ?? [],
    confidence: validation.data.confidence ?? 0.7,
  };
}
