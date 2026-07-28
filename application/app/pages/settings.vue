<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui';

useHead({ title: 'Settings — Piwi Dashboard' });

const { envManaged } = useSettingsEnvState();
const navItems = useSettingsNav(envManaged);

// `navItems` already arrives grouped (Instance / Analysis / meta); the docs link
// is appended as its own trailing section.
const links = computed<NavigationMenuItem[][]>(() => [
  ...navItems.value,
  [
    {
      label: 'Documentation',
      icon: 'i-lucide-book-open',
      to: 'https://piwitests.github.io',
      target: '_blank',
    },
  ],
]);
</script>

<template>
  <UDashboardPanel id="settings" :ui="{ body: 'lg:py-12' }">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb :items="[{ label: 'Home', icon: 'i-lucide-house', to: '/' }, { label: 'Settings' }]" />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <!-- NOTE: The `-mx-1` class is used to align with the `DashboardSidebarCollapse` button here. -->
        <UNavigationMenu
          :items="links"
          highlight
          class="-mx-1 flex-1"
          :ui="{ list: 'overflow-x-auto', root: 'min-w-0' }"
        />
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 sm:gap-6 lg:gap-12 w-full lg:max-w-4xl mx-auto">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
