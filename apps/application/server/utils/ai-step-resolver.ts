/**
 * The server half of AI-step authoring: given one resolution iteration from the
 * reporter, ask the configured model for a single decision and hand it back
 * schema-validated. The model only ever names an element (role + accessible name
 * from the snapshot) and an action — the reporter turns that into the committed,
 * deterministic locator. Keys stay server-side; usage lands in existing token
 * tracking; prompt caching covers the stable system+template+history prefix.
 */
import { callAiProvider, type AiCallResult } from './ai-provider';
import type { ResolvedAiRole } from '~~/types/api';
import {
  STEP_RESOLUTION_SCHEMA,
  STEP_RESOLUTION_SYSTEM,
  buildStepResolutionPrompt,
  validateStepResolution,
  type StepResolutionRequest,
  type StepResolutionResponse,
} from '#shared/ai-step-resolution';

/** A resolution decision plus the token accounting for the call that produced it. */
export interface StepResolutionResult {
  decision: StepResolutionResponse;
  usage: Pick<
    AiCallResult,
    'model' | 'inputTokens' | 'outputTokens' | 'cacheCreationInputTokens' | 'cacheReadInputTokens'
  >;
}

/** ARIA snapshots can be large; cap what we send so cost/latency stay bounded. */
export const MAX_SNAPSHOT_CHARS = 24_000;

export async function resolveStep(role: ResolvedAiRole, request: StepResolutionRequest): Promise<StepResolutionResult> {
  const trimmed: StepResolutionRequest = {
    ...request,
    ariaSnapshot: request.ariaSnapshot.slice(0, MAX_SNAPSHOT_CHARS),
  };
  const { user, stablePrefixChars } = buildStepResolutionPrompt(trimmed);

  const res = await callAiProvider(role, {
    system: STEP_RESOLUTION_SYSTEM,
    user,
    jsonSchema: STEP_RESOLUTION_SCHEMA as unknown as object,
    maxTokens: 1024,
    // Single-element grounding is a cheap call; a flow's next step gets a little
    // more headroom. Both stay well below diagnosis-tier spend.
    effort: request.kind === 'run' ? 'medium' : 'low',
    cacheControl: true,
    stablePrefixChars,
    images: trimmed.screenshot
      ? [{ name: 'page', mediaType: trimmed.screenshot.mediaType, data: trimmed.screenshot.data }]
      : undefined,
  });

  return {
    decision: validateStepResolution(res.text),
    usage: {
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      cacheCreationInputTokens: res.cacheCreationInputTokens,
      cacheReadInputTokens: res.cacheReadInputTokens,
    },
  };
}
