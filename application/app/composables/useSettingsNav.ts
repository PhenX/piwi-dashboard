import type { NavigationMenuItem } from '@nuxt/ui';
import { toValue, type MaybeRefOrGetter } from 'vue';
import { SETTINGS_PAGES, SETTINGS_GROUPS, type SettingsPageId } from '~/utils/settings-metadata';

/**
 * Build the Settings sub-navigation from the shared `SETTINGS_PAGES` registry,
 * grouped into sections (Instance / Analysis / meta) so the ten pages read as
 * two jobs rather than one undifferentiated list. Returns the `[][]` shape
 * `UNavigationMenu` renders with a separator between sections.
 *
 * Admin-only pages are hidden for non-admins (no more 403 on click). Pages that
 * are currently env-managed get a trailing lock badge, so an admin can see at a
 * glance which settings are pinned by the environment. A section whose pages are
 * all hidden collapses away rather than leaving an empty separator.
 *
 * `envManaged` is the per-page state from `useSettingsEnvState` (a ref or
 * getter); pass it to make the lock badges reactive. When omitted, no lock
 * badges are shown.
 */
export function useSettingsNav(envManaged?: MaybeRefOrGetter<Record<SettingsPageId, boolean>>) {
  const { isAdmin } = useAuth();
  const config = useRuntimeConfig();
  // When auth is disabled, every visitor is a virtual administrator — show all
  // pages (mirrors the per-page `isAdmin` fallback in users.vue/tags.vue).
  const canSeeAdmin = computed(() => !config.public.authEnabled || isAdmin.value);
  // The desktop build is single-user with auth off, so account/user management
  // (pages flagged `authOnly`) is meaningless there — hide it.
  const isDesktop = useIsDesktop();

  const items = computed<NavigationMenuItem[][]>(() => {
    const admin = canSeeAdmin.value;
    const managedMap = envManaged ? toValue(envManaged) : undefined;

    const visible = SETTINGS_PAGES.filter((page) => (!page.roles || admin) && !(isDesktop && page.authOnly));

    const toItem = (page: (typeof visible)[number]): NavigationMenuItem => {
      const managed = managedMap?.[page.id] ?? false;
      return {
        label: page.label,
        icon: page.icon,
        to: page.to,
        // Trailing lock badge marks env-pinned pages.
        ...(managed ? { badge: { icon: 'i-lucide-lock', color: 'neutral' as const } } : {}),
      } satisfies NavigationMenuItem;
    };

    return SETTINGS_GROUPS.map((group) => visible.filter((page) => page.group === group.id).map(toItem)).filter(
      (section) => section.length > 0,
    );
  });

  return items;
}
