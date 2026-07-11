<script setup lang="ts">
import type { TraceInfo } from '~~/types/api';

defineProps<{
  traces: TraceInfo[];
  loading?: boolean;
}>();
</script>

<template>
  <TestEvidenceSection
    v-if="loading || traces.length > 0"
    icon="i-lucide-bug-play"
    label="Traces"
    :count="traces.length || null"
    :collapsible="false"
  >
    <template #default>
      <div v-if="loading && !traces.length" class="flex items-center justify-center py-4">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-gray-400" />
      </div>
      <div v-else class="divide-y divide-default">
        <TraceListItem v-for="trace in traces" :key="trace.id" :trace="trace" class="px-3 py-2" />
      </div>
    </template>
  </TestEvidenceSection>
</template>
