<script setup lang="ts">
/**
 * One ranked alternative-locator row: score badge, locator code, note, and a
 * copy button. Shared by the main ranked list and the failing-page supplement
 * in LocatorHealingPanel.
 */
import type { RankedLocator } from '#shared/locator-healing.types';

const props = withDefaults(
  defineProps<{
    alt: RankedLocator;
    note?: string;
    copied?: boolean;
    dense?: boolean;
  }>(),
  { dense: false },
);

defineEmits<{ copy: [] }>();

function scoreColor(score: number): 'success' | 'warning' | 'error' {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'error';
}
</script>

<template>
  <div
    class="flex items-center gap-2 rounded border border-default/50 hover:bg-elevated transition-colors"
    :class="dense ? 'py-1 px-2' : 'py-1.5 px-2.5'"
  >
    <UBadge
      size="xs"
      :color="scoreColor(alt.score)"
      variant="subtle"
      class="shrink-0 font-mono tabular-nums cursor-default text-center"
      :class="dense ? 'min-w-[2.25rem]' : 'min-w-[2.5rem]'"
      :title="note || undefined"
    >
      {{ alt.score }}
    </UBadge>

    <code class="text-xs font-mono truncate flex-1 min-w-0" :title="alt.locator">{{ alt.locator }}</code>

    <UIcon
      v-if="alt.pickedByUser && dense"
      name="i-lucide-user-check"
      class="size-3.5 text-primary shrink-0"
      title="Confirmed with the locator picker"
    />
    <UBadge
      v-else-if="alt.pickedByUser"
      size="xs"
      color="primary"
      variant="subtle"
      icon="i-lucide-user-check"
      class="shrink-0"
      title="Confirmed with the locator picker on the failing page"
    />

    <UButton
      size="xs"
      variant="ghost"
      color="neutral"
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      :title="copied ? 'Copied!' : 'Copy'"
      class="shrink-0"
      @click.stop="$emit('copy')"
    />
  </div>
</template>
