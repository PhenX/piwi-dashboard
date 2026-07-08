<script setup lang="ts">
export interface DetailTabItem {
  label: string;
  icon?: string;
  value: string;
  slot?: string;
}

const props = defineProps<{
  tabItems: DetailTabItem[];
  tabPanelClass?: Record<string, string>;
}>();

const activeTab = defineModel<string>({ required: true });

// Mobile only: let the user fold the (often tall) summary away so the tab
// content is reachable without a long scroll. Ignored at `lg`+ where the
// summary is pinned and the panel scrolls independently.
const summaryCollapsed = ref(false);

const activeTabIcon = computed(() => props.tabItems.find((t) => t.value === activeTab.value)?.icon);

// Desktop keeps the independent-scroll panel; on mobile the panel flows into
// the page scroll (no clipping, no nested scroll area).
function panelClasses(value: string) {
  const desktop = props.tabPanelClass?.[value] ?? 'overflow-y-auto';
  return ['min-h-0', 'lg:flex-1', desktop, 'max-lg:!block', 'max-lg:!overflow-visible'];
}
</script>

<template>
  <!-- Mobile: the whole panel scrolls as one document. Desktop: fixed summary + independently scrolling tab body. -->
  <div class="flex flex-col h-full gap-4 p-1 max-lg:overflow-y-auto lg:overflow-hidden">
    <div v-if="$slots.summary" class="lg:shrink-0">
      <div :class="summaryCollapsed ? 'max-lg:hidden' : ''">
        <slot name="summary" />
      </div>
      <button
        type="button"
        class="lg:hidden mt-2 w-full flex items-center justify-center gap-1 rounded-md border border-default py-1.5 text-xs font-medium text-muted hover:bg-elevated/60 transition-colors"
        @click="summaryCollapsed = !summaryCollapsed"
      >
        <UIcon :name="summaryCollapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'" class="size-3.5" />
        {{ summaryCollapsed ? 'Show summary' : 'Hide summary' }}
      </button>
    </div>

    <!-- Tab switcher: a full-width select on phones, a (scrollable) tab strip from sm up. Sticky on mobile. -->
    <div
      class="lg:shrink-0 max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:-mx-1 max-lg:bg-default max-lg:px-1 max-lg:py-1.5"
    >
      <USelect v-model="activeTab" :items="tabItems" :icon="activeTabIcon" size="md" class="w-full sm:hidden" />
      <UTabs
        v-model="activeTab"
        :items="tabItems"
        size="sm"
        class="hidden sm:flex"
        :ui="{ list: 'overflow-x-auto', trigger: 'shrink-0' }"
      />
    </div>

    <template v-for="item in tabItems" :key="item.value">
      <div v-if="activeTab === item.value" :class="panelClasses(item.value)">
        <slot :name="`tab-${item.slot ?? item.value}`" />
      </div>
    </template>
  </div>
</template>
