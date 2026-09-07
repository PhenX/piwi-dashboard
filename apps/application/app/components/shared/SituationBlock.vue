<script setup lang="ts">
/**
 * The one block at the top of a failure page: what broke, what is going on and
 * what to do next. Six stacked lines, each an optional named slot the page fills
 * — identity (a kicker), headline (the page's `<h1>`), the most likely
 * explanation, the situation sentence, the next step, and the facts line. A line
 * with no slot collapses, so the same frame serves a failing execution (all six
 * lines), a passing one (identity and facts only) and — in a later phase — the
 * cluster page, which fills its own identity, state and occurrence lines.
 *
 * The block carries the page's single help hint; nothing else on it does.
 */
import type { HelpTopicKey } from '~/utils/help-content';

defineProps<{ help?: HelpTopicKey }>();
</script>

<template>
  <div
    data-shot="situation-block"
    class="rounded-lg border border-default bg-default p-3 sm:p-4 space-y-3 max-sm:rounded-none max-sm:border-x-0"
  >
    <!-- Line 1: identity kicker, with the block's one help hint and any actions -->
    <div v-if="$slots.identity || $slots.actions || help" class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1"><slot name="identity" /></div>
      <div v-if="$slots.actions || help" class="flex items-center gap-1.5 shrink-0">
        <slot name="actions" />
        <HelpHint v-if="help" :topic="help" />
      </div>
    </div>

    <!-- Line 2: the headline — the page's h1 -->
    <div v-if="$slots.headline"><slot name="headline" /></div>

    <!-- Line 3: most likely — the story line -->
    <div v-if="$slots.story"><slot name="story" /></div>

    <!-- Line 4: the situation sentence -->
    <div v-if="$slots.situation"><slot name="situation" /></div>

    <!-- Line 5: the next step -->
    <div v-if="$slots.next"><slot name="next" /></div>

    <!-- Line 6: the facts line, one size smaller, under a divider -->
    <div v-if="$slots.facts" class="border-t border-default pt-2.5"><slot name="facts" /></div>
  </div>
</template>
