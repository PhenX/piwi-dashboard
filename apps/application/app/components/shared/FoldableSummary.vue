<script setup lang="ts">
import { useFoldableSummary } from '~/composables/useFoldableSummary';

const props = defineProps<{
  storageKey: string;
}>();

const { folded, toggle } = useFoldableSummary(props.storageKey);

// Clicking the folded card expands it — but the folded slot may hold its own
// controls (e.g. the run's label editor), so a click that lands on an
// interactive element keeps that element's behavior instead of toggling. The
// chevron is the real, keyboard-focusable expand control.
function onFoldedClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest('button, a, input, select, textarea, [role="button"]')) return;
  toggle();
}
</script>

<template>
  <div>
    <!-- A non-interactive container, not a <button>: the folded slot can carry
         its own interactive controls, which must not nest inside a button. -->
    <div
      v-if="folded"
      class="border border-gray-200 dark:border-gray-800 rounded-xl p-2.5 shadow-xs cursor-pointer select-none"
      @click="onFoldedClick"
    >
      <div class="flex items-center gap-3">
        <slot name="folded" />
        <div class="ml-auto shrink-0">
          <UButton
            icon="i-lucide-chevron-down"
            size="xs"
            color="neutral"
            variant="ghost"
            title="Expand summary"
            aria-label="Expand summary"
            :aria-expanded="false"
            @click="toggle"
          />
        </div>
      </div>
    </div>
    <div v-else class="relative">
      <div class="absolute top-1 right-1 z-10">
        <UButton
          icon="i-lucide-chevron-up"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="toggle"
          title="Collapse summary"
          aria-expanded="true"
        />
      </div>
      <slot />
    </div>
  </div>
</template>
