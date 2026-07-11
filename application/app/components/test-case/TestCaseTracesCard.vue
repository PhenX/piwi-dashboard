<script setup lang="ts">
import type { TraceInfo } from '~~/types/api';

defineProps<{
  traces: TraceInfo[];
}>();
</script>

<template>
  <SectionCard
    v-if="traces.length > 0"
    icon="i-lucide-bug-play"
    title="Traces"
    :count="traces.length"
    help="case.traces"
  >
    <div class="space-y-2">
      <TraceListItem v-for="trace in traces" :key="trace.id" :trace="trace" class="py-2 px-3 rounded-lg border" />
    </div>
  </SectionCard>
</template>
