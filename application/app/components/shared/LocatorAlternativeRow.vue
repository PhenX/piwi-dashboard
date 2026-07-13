<script setup lang="ts">
/**
 * One ranked alternative-locator row: score badge, locator code, note, and a
 * copy button. Shared by the main ranked list and the failing-page supplement
 * in LocatorHealingPanel.
 */
import type { RankedLocator } from '#shared/locator-healing.types';

defineProps<{
  alt: RankedLocator;
  note: string;
  copied: boolean;
}>();

defineEmits<{ copy: [] }>();

function scoreColor(score: number): 'success' | 'warning' | 'error' {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'error';
}

function scoreBgClass(score: number): string {
  if (score >= 80) return 'bg-success/10';
  if (score >= 50) return 'bg-warning/10';
  return 'bg-error/10';
}
</script>

<template>
  <div class="flex items-center gap-3 rounded-lg p-3 border border-default" :class="scoreBgClass(alt.score)">
    <UBadge size="sm" :color="scoreColor(alt.score)" variant="subtle" class="shrink-0 w-12 text-center font-mono">
      {{ alt.score }}/100
    </UBadge>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 min-w-0">
        <code class="text-sm font-mono truncate">{{ alt.locator }}</code>
        <UBadge
          v-if="alt.pickedByUser"
          size="sm"
          color="primary"
          variant="subtle"
          icon="i-lucide-user-check"
          class="shrink-0"
          title="Confirmed with the locator picker on the failing page"
        >
          Your pick
        </UBadge>
      </div>
      <p v-if="note" class="text-xs text-gray-500 mt-0.5">{{ note }}</p>
    </div>
    <UButton
      size="xs"
      variant="outline"
      color="neutral"
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      :title="copied ? 'Copied!' : 'Copy'"
      @click="$emit('copy')"
    />
  </div>
</template>
