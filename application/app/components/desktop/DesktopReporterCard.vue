<script setup lang="ts">
/**
 * Desktop build only: how to point the Playwright reporter at this local app.
 *
 * The desktop app runs with auth off but the desktop guard enforces a local
 * access token on every request, so — unlike a no-auth server — the reporter
 * MUST send this token as its `apiKey`. It is a `pd_`-prefixed local secret.
 */
const props = defineProps<{
  /** Base server URL, e.g. `http://localhost:1234`. */
  url: string;
  /** The `pd_` access token enforced by the desktop guard. */
  token: string;
}>();

const { copy } = useCopy();

const snippet = computed(
  () => `reporter: [
  ['@piwitests/reporter', {
    serverUrl: '${props.url}',
    projectName: 'my-project',
    apiKey: '${props.token}',
  }],
],`,
);
</script>

<template>
  <SectionCard icon="i-lucide-upload" title="Send results to this app">
    <template #subtitle>
      Point the Playwright reporter at this desktop app. The access token is a local secret — prefer passing it via a
      <code>PIWI_API_KEY</code> env var rather than committing it.
    </template>

    <div class="space-y-3 text-sm">
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
        <div class="text-muted">playwright.config.ts</div>
        <CodeBlock :code="snippet" lang="typescript" />
      </div>
    </div>
  </SectionCard>
</template>
