<script setup lang="ts">
/**
 * Responsive breadcrumb. From `sm` up it renders the standard `UBreadcrumb`
 * (all levels, any custom item slots forwarded). Below `sm`, where a deep
 * path is unreadable, it collapses the ancestor levels into a dropdown and
 * shows only the current page label — tapping the leading chip reveals the
 * full path. Drop-in replacement for `<UBreadcrumb :items>`.
 */
import type { BreadcrumbItem, DropdownMenuItem } from '@nuxt/ui';

const props = defineProps<{ items: BreadcrumbItem[] }>();

const current = computed(() => props.items[props.items.length - 1]);

// Every level except the current page, as dropdown links.
const ancestorItems = computed<DropdownMenuItem[]>(() =>
  props.items.slice(0, -1).map((item) => ({
    label: typeof item.label === 'string' ? item.label : String(item.label ?? ''),
    icon: item.icon,
    to: item.to as string | undefined,
  })),
);

const hasAncestors = computed(() => ancestorItems.value.length > 0);
</script>

<template>
  <!-- Desktop: full breadcrumb, forwarding any custom per-item slots (e.g. #project). -->
  <UBreadcrumb :items="items" class="hidden min-w-0 sm:flex">
    <template v-for="(_, name) in $slots" #[name]="slotData">
      <slot :name="name" v-bind="slotData ?? {}" />
    </template>
  </UBreadcrumb>

  <!-- Mobile: ancestor dropdown + current page. -->
  <div class="flex min-w-0 items-center gap-1 sm:hidden">
    <UDropdownMenu v-if="hasAncestors" :items="ancestorItems" :content="{ align: 'start', collisionPadding: 12 }">
      <UButton
        :icon="items[0]?.icon || 'i-lucide-ellipsis'"
        trailing-icon="i-lucide-chevron-down"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        aria-label="Show navigation path"
        class="shrink-0"
      />
    </UDropdownMenu>
    <UIcon v-if="hasAncestors" name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted" />
    <span class="truncate text-sm font-medium">
      <slot :name="current?.slot || 'current'" :item="current">{{ current?.label }}</slot>
    </span>
  </div>
</template>
