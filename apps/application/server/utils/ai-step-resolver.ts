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

/**
 * Cost/latency caps for one authoring iteration. Defaults are overridable per
 * deployment via the `PIWI_AI_STEP_MAX_*` env vars (parsed + clamped like the
 * diagnosis context limits in `ai-context-limits.ts`).
 */
export const DEFAULT_STEP_MAX_SNAPSHOT_CHARS = 24_000;
export const DEFAULT_STEP_MAX_OUTPUT_TOKENS = 1024;
const SNAPSHOT_CHARS_RANGE = { min: 0, max: 100_000 };
const OUTPUT_TOKENS_RANGE = { min: 256, max: 8192 };

export interface StepResolveLimits {
  maxSnapshotChars: number;
  maxOutputTokens: number;
}

function clampEnvInt(
  name: string,
  fallback: number,
  range: { min: number; max: number },
  env: NodeJS.ProcessEnv,
): number {
  const raw = env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.floor(n)));
}

/** Resolve the effective authoring caps: defaults, overridden by env vars (clamped). */
export function resolveStepLimits(env: NodeJS.ProcessEnv = process.env): StepResolveLimits {
  return {
    maxSnapshotChars: clampEnvInt(
      'PIWI_AI_STEP_MAX_SNAPSHOT_CHARS',
      DEFAULT_STEP_MAX_SNAPSHOT_CHARS,
      SNAPSHOT_CHARS_RANGE,
      env,
    ),
    maxOutputTokens: clampEnvInt(
      'PIWI_AI_STEP_MAX_OUTPUT_TOKENS',
      DEFAULT_STEP_MAX_OUTPUT_TOKENS,
      OUTPUT_TOKENS_RANGE,
      env,
    ),
  };
}

export async function resolveStep(
  role: ResolvedAiRole,
  request: StepResolutionRequest,
  limits: StepResolveLimits = resolveStepLimits(),
): Promise<StepResolutionResult> {
  const trimmed: StepResolutionRequest = {
    ...request,
    ariaSnapshot: request.ariaSnapshot.slice(0, limits.maxSnapshotChars),
  };
  const { user, stablePrefixChars } = buildStepResolutionPrompt(trimmed);

  const res = await callAiProvider(role, {
    system: STEP_RESOLUTION_SYSTEM,
    user,
    jsonSchema: STEP_RESOLUTION_SCHEMA as unknown as object,
    maxTokens: limits.maxOutputTokens,
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
