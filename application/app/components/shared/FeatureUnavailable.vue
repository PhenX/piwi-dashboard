<script setup lang="ts">
/**
 * Empty state for a block whose data depends on an optional capability the user
 * may simply never have switched on.
 *
 * A plain "no data" message is indistinguishable from a broken feature, which
 * is the fastest way to make a tool feel thin. This says *why* it is empty and
 * links to the fix. Use it only where emptiness has a known cause — a genuinely
 * empty-but-working block should keep using `EmptyState`.
 */
const props = withDefaults(
  defineProps<{
    /** What's missing, e.g. "Network capture". */
    title: string;
    /** One line naming the requirement, e.g. "needs the Piwi capture fixtures". */
    text: string;
    icon?: string;
    /** Docs page (+ optional `#anchor`) for the setup instructions. */
    doc?: string;
    /** In-app route that switches it on, when one exists. Defaults to /setup. */
    to?: string;
    toLabel?: string;
    padded?: boolean;
  }>(),
  { icon: 'i-lucide-plug-zap', to: '/setup', toLabel: 'How to enable', padded: true },
);
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-2 text-center text-gray-500"
    :class="props.padded && 'py-8'"
  >
    <UIcon :name="props.icon" class="size-6 opacity-60" />
    <p class="text-sm font-medium text-gray-600 dark:text-gray-300">{{ props.title }}</p>
    <p class="text-sm max-w-md">{{ props.text }}</p>
    <div class="flex items-center gap-3 mt-1">
      <UButton :to="props.to" size="xs" variant="soft" icon="i-lucide-rocket">{{ props.toLabel }}</UButton>
      <DocLink v-if="props.doc" :to="props.doc" class="text-sm">Docs</DocLink>
    </div>
    <slot />
  </div>
</template>
