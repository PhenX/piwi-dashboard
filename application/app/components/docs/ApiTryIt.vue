<script setup lang="ts">
import type { FlatOperation, OpenApiSpec } from '~/utils/openapi';

const props = defineProps<{
  item: FlatOperation;
  spec?: OpenApiSpec | null;
}>();

const config = useRuntimeConfig();
const isDemo = config.public.demoMode;
// App base path (e.g. '' self-hosted, '/demo' in the static demo). Requests go
// to the same origin the dashboard is served from — never a third party.
const base = (config.app?.baseURL ?? '/').replace(/\/$/, '');

const { token } = useApiConsole();

const requiresAuth = computed(() => operationRequiresAuth(props.item.operation, props.spec));

const pathParams = computed(() => props.item.parameters.filter((p) => p.in === 'path'));
const queryParams = computed(() => props.item.parameters.filter((p) => p.in === 'query'));

const pathValues = reactive<Record<string, string>>(Object.fromEntries(pathParams.value.map((p) => [p.name, ''])));
const queryValues = reactive<Record<string, string>>(Object.fromEntries(queryParams.value.map((p) => [p.name, ''])));

const supportsBody = computed(() => hasJsonBody(props.item.operation));
const isMultipart = computed(
  () => Boolean(props.item.operation.requestBody?.content?.['multipart/form-data']) && !supportsBody.value,
);
const jsonBody = ref(requestBodyExample(props.item.operation, props.spec) ?? '');

const bodyToSend = computed(() => (supportsBody.value && jsonBody.value.trim() ? jsonBody.value : undefined));

// Same-origin request path (base-prefixed so the demo's service worker, whose
// scope is the sub-path, intercepts it).
const requestPath = computed(() => base + substitutePath(props.item.path, pathValues) + buildQuery(queryValues));

// Headers shown in the code samples (auth + content-type; no demo-only header).
const sampleHeaders = computed<Record<string, string>>(() => {
  const headers: Record<string, string> = {};
  if (bodyToSend.value) headers['Content-Type'] = 'application/json';
  if (requiresAuth.value && token.value) headers.Authorization = `Bearer ${token.value}`;
  return headers;
});

// Absolute URL for copy-paste samples (client-only; window is available on use).
const absoluteUrl = computed(() => (import.meta.client ? window.location.origin : '') + requestPath.value);

const curl = computed(() =>
  buildCurl({
    method: props.item.method,
    url: absoluteUrl.value,
    headers: sampleHeaders.value,
    body: bodyToSend.value,
  }),
);
const fetchSnippet = computed(() =>
  buildFetchSnippet({
    method: props.item.method,
    url: absoluteUrl.value,
    headers: sampleHeaders.value,
    body: bodyToSend.value,
  }),
);

const codeTab = ref<'curl' | 'fetch'>('curl');
const sending = ref(false);
const netError = ref<string | null>(null);
const result = ref<{ status: number; statusText: string; ok: boolean; timeMs: number; body: string } | null>(null);

async function send(): Promise<void> {
  sending.value = true;
  netError.value = null;
  result.value = null;
  const started = performance.now();
  try {
    const headers: Record<string, string> = { ...sampleHeaders.value };
    // Tag demo requests with the selected "act as" identity, mirroring the
    // demo fetch plugin, so the in-browser API applies that user's scope.
    if (isDemo) headers['x-demo-user-id'] = localStorage.getItem('piwi-demo-user-id') || '1';

    const res = await fetch(requestPath.value, {
      method: props.item.method.toUpperCase(),
      headers,
      body: bodyToSend.value,
      credentials: 'same-origin',
    });
    const timeMs = Math.round(performance.now() - started);
    const text = await res.text();
    let body = text;
    try {
      body = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // Non-JSON response — show as-is.
    }
    result.value = { status: res.status, statusText: res.statusText, ok: res.ok, timeMs, body };
  } catch (error) {
    netError.value = errorMessage(error);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="rounded-lg border border-default bg-default/50 p-3 space-y-3">
    <div class="flex items-center justify-between gap-2">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Try it out</h4>
      <UButton size="xs" color="primary" icon="i-lucide-play" :loading="sending" label="Send" @click="send" />
    </div>

    <!-- Authorization -->
    <div v-if="requiresAuth" class="space-y-1">
      <label class="text-xs text-dimmed">Authorization — Bearer token</label>
      <UInput v-model="token" type="password" placeholder="pd_…" size="sm" class="w-full" :ui="{ base: 'font-mono' }" />
    </div>

    <!-- Path parameters -->
    <div v-if="pathParams.length" class="space-y-1.5">
      <label class="text-xs text-dimmed">Path parameters</label>
      <div v-for="p in pathParams" :key="p.name" class="flex items-center gap-2">
        <code class="text-xs font-mono text-primary w-28 shrink-0 truncate" :title="p.name">{{ p.name }}</code>
        <UInput
          v-model="pathValues[p.name]"
          :placeholder="p.name"
          size="sm"
          class="flex-1"
          :ui="{ base: 'font-mono' }"
        />
      </div>
    </div>

    <!-- Query parameters -->
    <div v-if="queryParams.length" class="space-y-1.5">
      <label class="text-xs text-dimmed">Query parameters</label>
      <div v-for="p in queryParams" :key="p.name" class="flex items-center gap-2">
        <code class="text-xs font-mono text-primary w-28 shrink-0 truncate" :title="p.name">{{ p.name }}</code>
        <USelect
          v-if="p.schema?.enum?.length"
          v-model="queryValues[p.name]"
          :items="['', ...p.schema.enum.map(String)]"
          size="sm"
          class="flex-1"
        />
        <UInput
          v-else
          v-model="queryValues[p.name]"
          :placeholder="p.name"
          size="sm"
          class="flex-1"
          :ui="{ base: 'font-mono' }"
        />
      </div>
    </div>

    <!-- Request body -->
    <div v-if="supportsBody" class="space-y-1">
      <label class="text-xs text-dimmed">Request body — application/json</label>
      <UTextarea v-model="jsonBody" :rows="6" class="w-full" :ui="{ base: 'font-mono text-xs' }" />
    </div>
    <p v-else-if="isMultipart" class="text-xs text-dimmed">
      This endpoint expects <code class="font-mono">multipart/form-data</code> (file upload) — use the cURL sample below
      as a starting point.
    </p>

    <!-- Response -->
    <div v-if="result" class="space-y-1.5">
      <div class="flex items-center gap-2 text-xs">
        <UBadge :color="result.ok ? 'success' : 'error'" variant="subtle" class="font-mono">
          {{ result.status }} {{ result.statusText }}
        </UBadge>
        <span class="text-dimmed">{{ result.timeMs }} ms</span>
      </div>
      <div class="max-h-80 overflow-auto">
        <CodeBlock :code="result.body" lang="json" />
      </div>
    </div>
    <p v-else-if="netError" class="text-xs text-error">Request failed: {{ netError }}</p>

    <!-- Code samples -->
    <div class="space-y-1.5">
      <div class="flex gap-1">
        <button
          type="button"
          class="text-xs px-2 py-0.5 rounded-md transition-colors"
          :class="codeTab === 'curl' ? 'bg-elevated text-highlighted' : 'text-muted hover:text-highlighted'"
          @click="codeTab = 'curl'"
        >
          cURL
        </button>
        <button
          type="button"
          class="text-xs px-2 py-0.5 rounded-md transition-colors"
          :class="codeTab === 'fetch' ? 'bg-elevated text-highlighted' : 'text-muted hover:text-highlighted'"
          @click="codeTab = 'fetch'"
        >
          JavaScript
        </button>
      </div>
      <CodeBlock v-if="codeTab === 'curl'" :code="curl" lang="bash" />
      <CodeBlock v-else :code="fetchSnippet" lang="javascript" />
    </div>
  </div>
</template>
