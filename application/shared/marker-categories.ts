// Timeline marker categories. A marker's `category` is stored as a string; its
// icon and colors are derived here so the badge, chart line, and tooltip all
// stay consistent. `color` is a Nuxt UI semantic token (for UBadge); `hex` is a
// concrete color used to paint the SVG marker line on the trend charts.

export interface MarkerCategoryMeta {
  id: string;
  label: string;
  icon: string;
  color: 'primary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
  hex: string;
}

export const MARKER_CATEGORIES: MarkerCategoryMeta[] = [
  { id: 'deploy', label: 'Deploy', icon: 'i-lucide-rocket', color: 'primary', hex: '#3b82f6' },
  { id: 'config', label: 'Config change', icon: 'i-lucide-sliders-horizontal', color: 'warning', hex: '#f59e0b' },
  { id: 'infra', label: 'Infrastructure', icon: 'i-lucide-server', color: 'info', hex: '#06b6d4' },
  { id: 'incident', label: 'Incident', icon: 'i-lucide-triangle-alert', color: 'error', hex: '#ef4444' },
  { id: 'release', label: 'Release', icon: 'i-lucide-package', color: 'success', hex: '#22c55e' },
  { id: 'event', label: 'Event', icon: 'i-lucide-flag', color: 'neutral', hex: '#8b5cf6' },
];

export const DEFAULT_MARKER_CATEGORY = 'event';

const CATEGORY_BY_ID = new Map(MARKER_CATEGORIES.map((c) => [c.id, c]));

/** Category ids in declaration order (for form selects and validation). */
export const MARKER_CATEGORY_IDS = MARKER_CATEGORIES.map((c) => c.id);

/** Resolve a category's metadata, falling back to the generic "event" category. */
export function getMarkerCategory(id: string | null | undefined): MarkerCategoryMeta {
  return (id && CATEGORY_BY_ID.get(id)) || CATEGORY_BY_ID.get(DEFAULT_MARKER_CATEGORY)!;
}
