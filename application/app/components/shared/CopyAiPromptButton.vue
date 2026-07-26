<script setup lang="ts">
/**
 * Copies the exact request a diagnosis would send — system prompt, user message,
 * image count and response schema — so it can be pasted into another assistant
 * or read to check what Piwi actually transmits.
 *
 * It works whether or not an AI provider is configured: the payload is built
 * from stored data, not from a model call.
 */
const props = defineProps<{
  /** API path of the context endpoint, e.g. `/api/failure-clusters/12/context`. */
  contextEndpoint: string;
}>();

const { copy, copied } = useCopy();
const toast = useToast();
const loading = ref(false);

// Fetched directly rather than through `$fetch`, so the base path is applied by
// hand — the demo's service worker only intercepts its own `/demo/` prefix.
const base = computed(() => (useRuntimeConfig().app?.baseURL ?? '/').replace(/\/$/, ''));

async function copyPrompt() {
  loading.value = true;
  try {
    const response = await fetch(`${base.value}${props.contextEndpoint}?format=prompt`);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    copy(await response.text(), { toast: 'AI prompt copied' });
  } catch (error) {
    toast.add({ title: 'Could not copy the prompt', description: errorMessage(error), color: 'error' });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UButton
    :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard-copy'"
    size="xs"
    color="neutral"
    variant="outline"
    :loading="loading"
    title="Copy the exact request Piwi would send to the model — to reuse it elsewhere, or to check what it contains"
    @click="copyPrompt"
  >
    {{ copied ? 'Copied' : 'Copy prompt' }}
  </UButton>
</template>
