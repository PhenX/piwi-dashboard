<script setup lang="ts">
import type { ProjectDetails } from '~~/types/api';

const route = useRoute();
const projectId = String(route.params.id);

const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`);

const tableRef = ref<{ refresh: () => void } | null>(null);

useHead(
  computed(() => ({
    title: `${project.value?.label || project.value?.name || 'Project'} — Test cases — Piwi Dashboard`,
  })),
);
</script>

<template>
  <UDashboardPanel id="project-test-cases">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Test cases' },
            ]"
          />
        </template>
        <template #right>
          <NavbarActions
            :actions="[{ label: 'Refresh', icon: 'i-lucide-refresh-cw', onClick: () => tableRef?.refresh() }]"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4">
        <ProjectTestCasesTable ref="tableRef" :project-id="projectId" :project-name="project?.name" sync-query />
      </div>
    </template>
  </UDashboardPanel>
</template>
