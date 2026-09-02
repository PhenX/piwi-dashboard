<script setup lang="ts">
/**
 * Desktop build only: how to point the Playwright reporter at this local app.
 *
 * The desktop app runs with auth off but the desktop guard enforces a local
 * access token on every request, so — unlike a no-auth server — the reporter
 * MUST send this token as its `apiKey`. It is a `pd_`-prefixed local secret.
 *
 * While the app runs it publishes that token and its URL to `~/.piwi/desktop.json`,
 * which the reporter reads when nothing else sets a server URL or API key — so
 * the usual path needs no token at all. The values stay on show for the cases
 * discovery does not cover: another user account, a container, or a config that
 * already sets `serverUrl`.
 */
const props = defineProps<{
  /** Base server URL, e.g. `http://localhost:1234`. */
  url: string;
  /** The `pd_` access token enforced by the desktop guard. */
  token: string;
}>();

const { copy } = useCopy();

const autoSnippet = `reporter: [
  ['@piwitests/reporter', { projectName: 'my-project' }],
],`;

const manualSnippet = computed(
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
      While this app is running, the Playwright reporter finds it on its own — no URL and no token in your config.
    </template>

    <div class="space-y-4 text-sm">
      <div class="space-y-1">
        <div class="text-muted">playwright.config.ts</div>
        <CodeBlock :code="autoSnippet" lang="typescript" />
        <p class="text-muted text-xs">
          The app publishes its address and token to <code>~/.piwi/desktop.json</code> while it runs. The reporter reads
          that file only when your config and environment set no <code>serverUrl</code> and no <code>apiKey</code>, so a
          project already pointed at another dashboard is never redirected here.
        </p>
      </div>

      <USeparator />

      <div class="space-y-3">
        <p class="text-muted">
          Configure it by hand when discovery cannot apply — tests running as another user, in a container, or with a
          config that already sets <code>serverUrl</code>. The token is a local secret: prefer the
          <code>PIWI_API_KEY</code> env var over committing it.
        </p>

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
          <CodeBlock :code="manualSnippet" lang="typescript" />
        </div>
      </div>
    </div>
  </SectionCard>
</template>
