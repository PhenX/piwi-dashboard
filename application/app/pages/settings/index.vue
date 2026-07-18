<script setup lang="ts">
const runtimeConfig = useRuntimeConfig();
const isDemoMode = runtimeConfig.public.demoMode;
const { isResetting, resetDemo } = useDemoReset();
</script>

<template>
  <SectionCard icon="i-lucide-settings" title="General settings" help="settings.general">
    <template #actions>
      <UButton
        v-if="isDemoMode"
        color="error"
        variant="soft"
        icon="i-lucide-refresh-cw"
        :loading="isResetting"
        @click="resetDemo"
      >
        Reset demo
      </UButton>
    </template>

    <div v-if="isDemoMode" class="flex max-sm:flex-col justify-between items-start gap-4">
      <div>
        <p class="font-medium text-sm">Reset demo data</p>
        <p class="text-sm text-muted">
          Wipe the in-browser database and reload with fresh sample data dated to the current moment. All changes made
          during this demo session will be lost.
        </p>
      </div>
    </div>

    <div v-else class="text-sm text-muted">
      <p>
        Appearance and theme are in the top bar. Use the sidebar to manage your account, users, AI diagnosis,
        notifications, storage, and tags.
      </p>
      <p class="mt-2">
        Settings that can be overridden by <code class="font-mono text-xs">PIWI_*</code> environment variables show a
        lock badge with the variable name — hover the help icon on any card to see which env var backs a setting.
      </p>
    </div>
  </SectionCard>
</template>
