<script setup lang="ts">
const config = useRuntimeConfig();
const isDemo = config.public.demoMode;
const specUrl = isDemo ? '/demo/_openapi.json' : '/_openapi.json';
const container = ref<HTMLDivElement>();

// The interactive reference is loaded from a CDN; a restricted/offline network
// must fall back to a plain link to the raw spec instead of a blank page.
const status = ref<'loading' | 'ready' | 'error'>('loading');
const SCRIPT_TIMEOUT_MS = 8000;

useHead({
  title: 'API Reference — Piwi Dashboard',
});

onMounted(() => {
  const timeout = setTimeout(() => {
    if (status.value === 'loading') status.value = 'error';
  }, SCRIPT_TIMEOUT_MS);

  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';
  script.async = true;
  script.onload = () => {
    clearTimeout(timeout);
    const S = (window as unknown as Record<string, unknown>).Scalar as
      | { createApiReference: (element: HTMLElement, config: Record<string, unknown>) => void }
      | undefined;
    if (S?.createApiReference && container.value) {
      S.createApiReference(container.value, {
        url: specUrl,
        darkMode: true,
        showSidebar: true,
        metaData: {
          title: 'Piwi Dashboard API',
          description:
            'REST API for storing and querying Playwright test results, traces, failure diagnoses, and project statistics.',
        },
      });
      status.value = 'ready';
    } else {
      status.value = 'error';
    }
  };
  script.onerror = () => {
    clearTimeout(timeout);
    status.value = 'error';
  };
  document.head.appendChild(script);
});
</script>

<template>
  <ClientOnly>
    <div v-if="status === 'error'" class="flex flex-col items-center justify-center h-screen gap-3 text-center px-4">
      <UIcon name="i-lucide-circle-alert" class="size-6 text-red-400" />
      <p class="text-sm text-gray-400 max-w-sm">
        Couldn't load the interactive API reference (it's fetched from a CDN, which may be unreachable on this network).
      </p>
      <UButton :to="specUrl" target="_blank" size="sm" variant="outline" icon="i-lucide-file-json">
        View the raw OpenAPI spec
      </UButton>
    </div>
    <div v-show="status !== 'error'" ref="container" class="scalar-container" />
    <template #fallback>
      <div class="flex items-center justify-center h-screen text-gray-400">Loading API reference...</div>
    </template>
  </ClientOnly>
</template>

<style>
.scalar-container {
  height: 100vh;
  width: 100%;
}
.scalar-container :deep(.scalar-app) {
  min-height: 100vh;
}
</style>
