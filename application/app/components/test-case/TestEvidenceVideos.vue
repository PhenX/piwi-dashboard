<script setup lang="ts">
import type { AttachmentInfo } from '~~/types/api';
import { isVideoFile } from '~/utils/text-format';

const props = defineProps<{
  attachments: AttachmentInfo[];
}>();

function getExt(path: string): string {
  return '.' + (path.toLowerCase().split('.').pop() || '');
}

function fileUrl(path: string, contentType?: string | null): string {
  let url = `/api/files/${getFileApiPath(path)}`;
  if (contentType && getExt(path) === '.') url += `?contentType=${encodeURIComponent(contentType)}`;
  return url;
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

const videos = computed(() =>
  props.attachments
    .filter((att) => isVideoFile(att.path, att.contentType))
    .map((att) => ({
      src: fileUrl(att.path, att.contentType),
      name: att.name || fileName(att.path),
    })),
);
</script>

<template>
  <TestEvidenceSection
    v-if="videos.length > 0"
    icon="i-lucide-video"
    label="Videos"
    :count="videos.length"
    :collapsible="false"
  >
    <div class="space-y-2 p-2 bg-gray-50 dark:bg-gray-900">
      <VideoPlayer v-for="video in videos" :key="video.src" :src="video.src" :label="video.name" />
    </div>
  </TestEvidenceSection>
</template>
