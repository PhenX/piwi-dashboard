import type { DynamicScroller, DynamicScrollerItem, RecycleScroller } from 'vue-virtual-scroller';

// `vue-virtual-scroller` registers these globally via a client plugin; teach the
// template type-checker about them so `<DynamicScroller>` etc. type-check.
declare module 'vue' {
  interface GlobalComponents {
    DynamicScroller: typeof DynamicScroller;
    DynamicScrollerItem: typeof DynamicScrollerItem;
    RecycleScroller: typeof RecycleScroller;
  }
}

export {};
