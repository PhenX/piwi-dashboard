<script setup lang="ts">
/**
 * Desktop shell only: the entry point to "run these tests locally". Renders
 * nothing without the IPC bridge (plain browsers, web deployments), so pages
 * can mount it unconditionally next to the copyable retry command.
 */
import type { RetryCase } from '~/utils/retry-command';

const props = defineProps<{
  projectId?: string | number | null;
  projectLabel?: string | null;
  cases: RetryCase[];
}>();

const available = ref(false);
onMounted(() => {
  available.value = !!tauriCore();
});

const open = ref(false);
const canRun = computed(() => available.value && props.projectId != null && props.cases.length > 0);
</script>

<template>
  <span v-if="canRun" class="inline-flex">
    <UTooltip text="Run these tests on this machine">
      <UButton size="xs" color="warning" variant="subtle" icon="i-lucide-monitor-play" @click="open = true">
        Run locally
      </UButton>
    </UTooltip>
    <DesktopRunLocallyModal v-model:open="open" :project-id="projectId!" :project-label="projectLabel" :cases="cases" />
  </span>
</template>
