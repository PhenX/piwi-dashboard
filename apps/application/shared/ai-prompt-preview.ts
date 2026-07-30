/**
 * Renders the exact payload a diagnosis request would carry, as one copyable
 * string — for pasting into another assistant, or for checking what Piwi
 * actually sends before trusting it.
 *
 * Pure and shared, so the server and the demo cannot describe the same request
 * differently.
 */

export interface PromptPreviewInput {
  /** The system prompt, including any global and per-project instructions. */
  system: string;
  /** The user message: the built context, plus anything appended to it. */
  user: string;
  /** Screenshots travel as image parts and cannot appear in a text preview. */
  imageCount?: number;
  /** The response schema the model is constrained to, when one is used. */
  jsonSchema?: unknown;
  /** Model identifier, when known. */
  model?: string | null;
}

const RULE = '='.repeat(72);

function section(title: string, body: string): string {
  return `${RULE}\n${title}\n${RULE}\n\n${body.trim()}\n`;
}

export function buildPromptPreview(input: PromptPreviewInput): string {
  const parts: string[] = [];

  const header = [
    'Piwi — AI diagnosis request preview',
    input.model ? `Model: ${input.model}` : null,
    // Both are assembled at diagnosis time and cannot be known in advance, so
    // say so rather than letting the preview imply it is byte-exact.
    'Not included: any additional context you type when starting a diagnosis, and',
    'the research block, which a two-stage pipeline generates from a live model call.',
  ]
    .filter(Boolean)
    .join('\n');
  parts.push(section('REQUEST', header));

  parts.push(section('SYSTEM', input.system || '(none)'));
  parts.push(section('USER', input.user || '(none)'));

  if (input.imageCount) {
    parts.push(
      section(
        'IMAGES',
        `${input.imageCount} screenshot${input.imageCount === 1 ? '' : 's'} attached as image parts, downscaled before sending.`,
      ),
    );
  }

  if (input.jsonSchema) {
    parts.push(section('RESPONSE FORMAT (JSON SCHEMA)', JSON.stringify(input.jsonSchema, null, 2)));
  }

  return parts.join('\n');
}
