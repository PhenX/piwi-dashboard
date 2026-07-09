<script setup lang="ts">
const config = useRuntimeConfig();

const { data: versionInfo } = await useFetch('/api/version');

const appVersion = config.public.appVersion as string;
const buildSha = config.public.buildSha as string;
const buildTime = config.public.buildTime as string;
const nodeVersion = config.public.nodeVersion as string;
const authEnabled = config.public.authEnabled as boolean;

const shortSha = computed(() => (buildSha ? buildSha.slice(0, 7) : null));

const dbBackendLabel = computed(() => {
  const backend = versionInfo.value?.dbBackend;
  if (backend === 'postgresql') return 'PostgreSQL';
  if (backend === 'sqlite') return 'SQLite';
  return backend ?? null;
});
</script>

<template>
  <div class="space-y-6">
    <SectionCard icon="i-lucide-info" title="Application">
      <StatTileGrid>
        <StatTile label="Version" :value="`v${appVersion}`" />
        <StatTile v-if="shortSha" label="Build" :value="shortSha" :hint="buildSha" />
        <StatTile v-if="buildTime" label="Built" :value="formatRelativeTime(buildTime)" :hint="buildTime" />
        <StatTile label="Node.js" :value="nodeVersion" />
        <StatTile label="Database" :value="dbBackendLabel" />
        <StatTile label="Authentication" :value="authEnabled ? 'Enabled' : 'Disabled'" />
      </StatTileGrid>
    </SectionCard>

    <SectionCard icon="i-lucide-book-open" title="Resources">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <DocLink to="">Documentation</DocLink>
        <DocLink to="api">API reference</DocLink>
        <ULink
          to="https://github.com/piwitests/platform"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 text-primary hover:underline"
        >
          GitHub
          <UIcon name="i-lucide-external-link" class="w-3.5 h-3.5 shrink-0" />
        </ULink>
      </div>
    </SectionCard>
  </div>
</template>
