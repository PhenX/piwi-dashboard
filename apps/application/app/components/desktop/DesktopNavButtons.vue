<script setup lang="ts">
/**
 * Desktop shell only: back/forward history buttons at the top of the sidebar.
 * The webview has no browser chrome, so this is the visible counterpart of the
 * mouse-button and trackpad-swipe navigation the webview already supports.
 * Renders nothing in a plain browser, which has its own chrome.
 */
defineProps<{ collapsed?: boolean }>();

const isDesktop = useIsDesktop();
const { canGoBack, canGoForward, goBack, goForward } = useDesktopHistoryNav();
</script>

<template>
  <div v-if="isDesktop" class="flex gap-0.5" :class="collapsed ? 'flex-col items-stretch' : 'items-center'">
    <UButton
      icon="i-lucide-chevron-left"
      color="neutral"
      variant="ghost"
      size="sm"
      square
      :disabled="!canGoBack"
      aria-label="Back"
      title="Back"
      @click="goBack"
    />
    <UButton
      icon="i-lucide-chevron-right"
      color="neutral"
      variant="ghost"
      size="sm"
      square
      :disabled="!canGoForward"
      aria-label="Forward"
      title="Forward"
      @click="goForward"
    />
  </div>
</template>
