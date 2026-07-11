<script setup lang="ts">
import type { TraceInfo } from '~~/types/api';

const props = withDefaults(
  defineProps<{
    trace: TraceInfo;
    showTime?: boolean;
  }>(),
  {
    showTime: true,
  },
);

const name = computed(() => props.trace.filePath.split('/').pop() || props.trace.filePath);

function downloadUrl(path: string): string {
  return `/api/files/${getFileApiPath(path)}`;
}
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-2 min-w-0">
      <UIcon name="i-lucide-file-archive" class="size-4 text-gray-400 shrink-0" />
      <span class="text-sm truncate">{{ name }}</span>
      <span v-if="trace.size" class="text-xs text-gray-400 shrink-0">{{ formatBytes(trace.size) }}</span>
      <span v-if="showTime" class="text-xs text-gray-400 shrink-0">{{ formatRelativeTime(trace.createdAt) }}</span>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      <UButton
        :to="getTraceViewerUrl(trace.filePath)"
        target="_blank"
        icon="i-lucide-bug-play"
        size="xs"
        label="View trace"
      />
      <UButton
        :to="downloadUrl(trace.filePath)"
        target="_blank"
        icon="i-lucide-download"
        size="xs"
        color="neutral"
        variant="soft"
        label="Download"
      />
    </div>
  </div>
</template>
