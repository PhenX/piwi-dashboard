<script setup lang="ts">
/**
 * Desktop build only: how to connect an MCP client to this local app.
 *
 * The endpoint is `<url>/mcp`. Auth is off, but the desktop guard requires the
 * local access token — a `pd_` secret that doubles as the Bearer token (the MCP
 * route authenticates with the same `pd_` keys as the REST API, and accepts any
 * caller once the guard has validated the token).
 */
const props = defineProps<{
  /** Base server URL, e.g. `http://localhost:1234`. */
  url: string;
  /** The `pd_` access token enforced by the desktop guard. */
  token: string;
}>();

const { copy } = useCopy();

const mcpUrl = computed(() => `${props.url}/mcp`);
const claudeCodeSnippet = computed(
  () => `claude mcp add --transport http piwi ${mcpUrl.value} \\\n  --header "Authorization: Bearer ${props.token}"`,
);
</script>

<template>
  <SectionCard icon="i-lucide-plug" title="Connect an AI assistant (MCP)">
    <template #subtitle>
      This app exposes a local MCP endpoint. Point your client at the URL below and authenticate with the access token —
      it is the Bearer token, even though sign-in is off.
    </template>

    <div class="space-y-3 text-sm">
      <div class="space-y-1">
        <div class="text-muted">MCP URL</div>
        <div class="flex items-start gap-2">
          <code class="text-xs break-all flex-1">{{ mcpUrl }}</code>
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Copy MCP URL"
            @click="copy(mcpUrl, { toast: true })"
          />
        </div>
      </div>

      <div class="space-y-1">
        <div class="text-muted">Access token</div>
        <div class="flex items-start gap-2">
          <code class="text-xs break-all flex-1">{{ token }}</code>
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Copy access token"
            @click="copy(token, { toast: true })"
          />
        </div>
      </div>

      <div class="space-y-1">
        <div class="text-muted">Claude Code</div>
        <CodeBlock :code="claudeCodeSnippet" lang="sh" />
      </div>
    </div>
  </SectionCard>
</template>
