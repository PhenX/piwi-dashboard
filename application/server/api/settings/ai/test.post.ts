import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { resolveAiConfig, callAiProvider } from '../../../utils/ai-provider';
import { embedTexts } from '../../../utils/ai-embeddings';
import type { AiModelRole, AiProvider, ResolvedAiRole } from '~~/types/api';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Test AI provider connection',
    description:
      'Sends a connectivity test to the configured AI provider for a given model role (`diagnosis`, `research`, or `embedding` — the embedding role is probed via the embeddings endpoint). Accepts optional role, provider, apiKey, model, and baseUrl in the request body; omitted fields fall back to the saved configuration. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  const body = (await readBody(event).catch(() => null)) as {
    role?: string;
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  } | null;

  const role: AiModelRole = body?.role === 'research' || body?.role === 'embedding' ? body.role : 'diagnosis';

  const db = await getDatabase();
  const resolved = await resolveAiConfig(db);

  let config: ResolvedAiRole | null;

  if (!body?.provider) {
    config = resolved ? resolved.roles[role] : null;
  } else {
    // Form values win; a blank key falls back to the saved key for this role
    // (users leave the field empty to keep the stored secret), then to the
    // diagnosis role's key (the common "reuse" source).
    const apiKey = body.apiKey || resolved?.roles[role]?.apiKey || resolved?.roles.diagnosis?.apiKey || '';
    config = {
      provider: body.provider as AiProvider,
      apiKey,
      model: body.model || '',
      baseUrl: body.baseUrl || null,
    };
  }

  if (!config) throw createError({ statusCode: 503, message: `The ${role} role is not configured` });

  try {
    if (role === 'embedding') {
      const vectors = await embedTexts(config, ['connectivity check']);
      if (!vectors[0]?.length) throw new Error('embeddings endpoint returned no vector');
      return { success: true, model: config.model };
    }
    const result = await callAiProvider(config, {
      system: 'You are a connectivity check.',
      user: 'Reply with the single word OK.',
      maxTokens: 8,
    });
    return { success: true, model: result.model };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
});
