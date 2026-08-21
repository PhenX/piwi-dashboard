<script setup lang="ts">
/**
 * The app's one page-level tab strip. Every page renders through this
 * component (via `DetailPageLayout` or directly) so tabs look, behave and
 * announce identically everywhere — never hand-roll `role="tablist"` or add
 * a new `UTabs` for page navigation.
 *
 * Replaces the reka-based `UTabs`: tabpanels are real wired elements,
 * disabled tabs stay focusable with a reason (`aria-disabled`), and roving
 * focus is explicit (arrows move within the strip, Home/End jump to the ends).
 */
export interface TabStripItem {
  label: string;
  icon?: string;
  value: string;
  slot?: string;
  /** Kept visible but not selectable — a tab that has nothing to show. */
  disabled?: boolean;
  /** Why the tab is disabled, shown on hover and to assistive tech. */
  disabledReason?: string;
}

const props = withDefaults(
  defineProps<{
    items: TabStripItem[];
    size?: 'sm' | 'md';
    /** Extra classes for the `role="tablist"` wrapper (e.g. responsive hiding). */
    class?: string;
    /** Per-tab extra classes for the panel wrapper (e.g. `overflow-y-auto`). */
    panelClasses?: Record<string, string>;
  }>(),
  { size: 'md', class: '', panelClasses: () => ({}) },
);

const activeTab = defineModel<string>({ required: true });

const stripRef = ref<HTMLElement | null>(null);

function tabId(value: string): string {
  return `detail-tab-${value}`;
}

function panelId(value: string): string {
  return `detail-panel-${value}`;
}

function onStripKeydown(event: KeyboardEvent) {
  const tabs = props.items;
  const current = tabs.findIndex((t) => t.value === activeTab.value);
  if (current < 0) return;
  let next = -1;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  if (next < 0) return;
  event.preventDefault();
  activeTab.value = tabs[next]!.value;
  const el = stripRef.value?.querySelector<HTMLElement>(`#${CSS.escape(tabId(tabs[next]!.value))}`);
  el?.focus();
}
</script>

<template>
  <div>
    <div
      ref="stripRef"
      role="tablist"
      aria-label="Sections"
      class="relative flex p-1 group gap-0.5 bg-elevated rounded-lg overflow-x-auto"
      :class="class"
      @keydown="onStripKeydown"
    >
      <button
        v-for="item in items"
        :key="item.value"
        :id="tabId(item.value)"
        type="button"
        role="tab"
        :aria-selected="activeTab === item.value"
        :aria-disabled="item.disabled || undefined"
        :aria-description="item.disabled ? item.disabledReason : undefined"
        :tabindex="activeTab === item.value ? 0 : -1"
        :title="item.disabled ? item.disabledReason : undefined"
        class="relative inline-flex items-center justify-center font-medium rounded-md transition-colors disabled:cursor-not-allowed"
        :class="[
          size === 'sm' ? 'px-2.5 py-1.5 text-xs gap-1.5' : 'px-3 py-1.5 text-sm gap-1.5',
          activeTab === item.value
            ? 'bg-default shadow-xs text-highlighted'
            : item.disabled
              ? 'text-muted/60 hover:text-muted'
              : 'text-muted hover:text-default',
        ]"
        @click="!item.disabled && (activeTab = item.value)"
      >
        <UIcon v-if="item.icon" :name="item.icon" class="shrink-0" :class="size === 'sm' ? 'size-4' : 'size-5'" />
        {{ item.label }}
      </button>
    </div>

    <template v-for="item in items" :key="item.value">
      <div
        v-if="activeTab === item.value"
        :id="panelId(item.value)"
        role="tabpanel"
        :aria-labelledby="tabId(item.value)"
        class="w-full focus-visible:outline-3 outline-primary/25"
        :class="panelClasses[item.value]"
      >
        <slot name="panel" :item="item">
          <slot :name="item.slot || 'content'" :item="item" />
        </slot>
      </div>
    </template>
  </div>
</template>
