import type { InjectionKey } from 'vue';

/**
 * Lets the diagnosis result (right column) reveal the matching evidence section
 * in the left column when a citation is clicked. The cluster page provides the
 * implementation over its section refs; other consumers get a no-op default.
 */
export interface ClusterSectionLocator {
  /** Whether a diagnosis section id maps to a foldable left-column section. */
  canLocate: (sectionId: string) => boolean;
  /** Unfold and scroll the left-column section for this diagnosis section id. */
  open: (sectionId: string) => void;
}

export const clusterSectionLocatorKey: InjectionKey<ClusterSectionLocator> = Symbol('clusterSectionLocator');

export function useClusterSectionLocator(): ClusterSectionLocator {
  return inject(clusterSectionLocatorKey, { canLocate: () => false, open: () => {} });
}
