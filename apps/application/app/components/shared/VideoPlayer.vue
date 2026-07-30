<script setup lang="ts">
defineProps<{
  src: string;
  label?: string | null;
}>();
</script>

<template>
  <figure class="m-0">
    <div class="bg-black rounded overflow-hidden">
      <video :src="src" controls preload="metadata" class="w-full max-h-96">
        Your browser does not support the video tag.
      </video>
    </div>
    <figcaption v-if="label" class="mt-1 text-xs text-gray-400 truncate" :title="label">{{ label }}</figcaption>
  </figure>
</template>
