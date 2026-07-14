<script setup lang="ts">
/**
 * One ranked alternative-locator row: score badge, locator code, note, and a
 * copy button. Shared by the ranked list and failing-page supplement in
 * LocatorHealingPanel (plain display rows) and by SnapshotLocatorPicker's
 * review list (`selectable` radio-style rows).
 */
import type { RankedLocator } from '#shared/locator-healing.types';

const props = withDefaults(
  defineProps<{
    alt: RankedLocator;
    /** Overrides the note derived from the locator method/args. */
    note?: string;
    copied?: boolean;
    dense?: boolean;
    /** Renders the row as a radio-style option that emits `select`. */
    selectable?: boolean;
    selected?: boolean;
  }>(),
  { note: undefined, copied: false, dense: false, selectable: false, selected: false },
);

defineEmits<{ copy: []; select: [] }>();

function scoreColor(score: number): 'success' | 'warning' | 'error' {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'error';
}

/** Why this alternative is (or isn't) sturdy — shown as a visible line. */
function defaultNote(alt: RankedLocator): string {
  const { method, score, args } = alt;
  if (args && (args.anchorTestId || args.anchorSelector || args.anchorRole)) {
    return 'scoped to a stable ancestor — survives renames';
  }
  if (score >= 100) return 'most stable — purpose-built for testing';
  if (method === 'getByRole' && args && !('name' in args)) return 'name-free role — survives renames';
  if (method === 'getByRole') return 'browser ARIA tree — semantic and stable';
  if (method === 'getByLabel') return 'associated <label> element';
  if (method === 'getByPlaceholder') return 'input placeholder';
  if (method === 'getByText') return 'visible text';
  if (method === 'getByAltText') return 'image alt text';
  if (method === 'getByTitle') return 'title attribute';
  if (method === 'locator' && score >= 50) return 'stable selector';
  if (method === 'locator') return 'CSS class — may be fragile';
  return '';
}

const displayNote = computed(() => props.note ?? defaultNote(props.alt));
</script>

<template>
  <div
    class="flex items-center gap-2 rounded border"
    :class="[
      dense ? 'py-1 px-2' : 'py-1.5 px-2.5',
      selectable
        ? 'cursor-pointer hover:bg-elevated transition-colors focus-visible:outline-2 focus-visible:outline-primary'
        : '',
      selectable && selected ? 'border-primary/60 ring-1 ring-primary/50' : 'border-default/50',
    ]"
    :role="selectable ? 'radio' : undefined"
    :aria-checked="selectable ? selected : undefined"
    :tabindex="selectable ? 0 : undefined"
    @click="selectable && $emit('select')"
    @keydown.enter.prevent="selectable && $emit('select')"
    @keydown.space.prevent="selectable && $emit('select')"
  >
    <UBadge
      size="xs"
      :color="scoreColor(alt.score)"
      variant="subtle"
      class="shrink-0 font-mono tabular-nums cursor-default text-center"
      :class="dense ? 'min-w-[2.25rem]' : 'min-w-[2.5rem]'"
      :title="`Stability score: ${alt.score}/100`"
    >
      {{ alt.score }}
    </UBadge>

    <div class="flex-1 min-w-0">
      <code class="text-xs font-mono block truncate" :title="alt.locator">{{ alt.locator }}</code>
      <p v-if="displayNote" class="text-[11px] leading-4 text-gray-500 truncate">{{ displayNote }}</p>
    </div>

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
