import VueVirtualScroller from 'vue-virtual-scroller';
import 'vue-virtual-scroller/index.css';

/**
 * Registers `DynamicScroller`/`DynamicScrollerItem`/`RecycleScroller` globally.
 * Client-only: the scrollers measure the DOM, so they render inside
 * `<ClientOnly>` and never run during SSR.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(VueVirtualScroller);
});
