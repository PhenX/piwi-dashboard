<script setup lang="ts">
import type { AttachmentInfo } from '~~/types/api';
import { isImageFile } from '~/utils/text-format';

const props = defineProps<{
  attachments: AttachmentInfo[];
  /** Drop the bordered frame — render a plain heading row over the thumbnails. */
  embedded?: boolean;
}>();

const config = useRuntimeConfig();

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

const images = computed(() =>
  props.attachments
    .filter((att) => isImageFile(att.path, att.contentType))
    .map((att) => ({
      src: fileApiUrl(att.path, att.contentType, config.app?.baseURL),
      name: att.name || fileName(att.path),
    })),
);

const currentIndex = ref<number | null>(null);
</script>

<template>
  <TestEvidenceSection
    v-if="images.length > 0"
    icon="i-lucide-image"
    label="Screenshots"
    :count="images.length"
    :collapsible="false"
    :embedded="embedded"
  >
    <div class="grid grid-cols-2 gap-2" :class="embedded ? '-mx-3 sm:-mx-4' : 'p-2 bg-gray-50 dark:bg-gray-900'">
      <div
        v-for="(img, idx) in images"
        :key="img.src"
        class="relative group cursor-pointer rounded overflow-hidden border border-default outline-none focus-visible:outline-2 focus-visible:outline-primary"
        role="button"
        tabindex="0"
        :aria-label="`View screenshot ${img.name}`"
        @click="currentIndex = idx"
        @keydown.enter="currentIndex = idx"
        @keydown.space.prevent="currentIndex = idx"
      >
        <img
          :src="img.src"
          :alt="img.name"
          class="w-full h-28 object-cover object-top transition-opacity group-hover:opacity-80"
          loading="lazy"
        />
        <div
          class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30"
        >
          <UIcon name="i-lucide-zoom-in" class="size-5 text-white" />
        </div>
        <p class="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[10px] text-white bg-black/50 truncate">
          {{ img.name }}
        </p>
      </div>
    </div>
    <ScreenshotLightbox v-model="currentIndex" :images="images" />
  </TestEvidenceSection>
</template>
