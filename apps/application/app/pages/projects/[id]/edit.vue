<script setup lang="ts">
import { z } from 'zod';
import type { ProjectDetails, TagsResponse, TagInfo } from '~~/types/api';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const projectId = route.params.id as string;

const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`);
const { data: tagsData, refresh: refreshTags } = await useFetch<TagsResponse>('/api/tags');

useHead(
  computed(() => ({ title: `Edit ${project.value?.label || project.value?.name || 'Project'} — Piwi Dashboard` })),
);

const allTags = computed(() => tagsData.value?.items || []);

const hasToken = computed(() => Boolean(project.value?.hasScmToken));

const storedCiRerun = (project.value?.ciRerun ?? null) as {
  enabled?: boolean;
  github?: { workflow?: string; ref?: string; inputName?: string };
  gitlab?: { ref?: string; variableName?: string };
  bitbucket?: { pipeline?: string; variableName?: string };
} | null;

const state = ref({
  label: project.value?.label || '',
  description: project.value?.description || '',
  diagnosisInstructions: project.value?.diagnosisInstructions || '',
  scmToken: '',
  defaultBranch: project.value?.defaultBranch || '',
  ciRerun: {
    enabled: storedCiRerun?.enabled ?? false,
    github: {
      workflow: storedCiRerun?.github?.workflow ?? '',
      ref: storedCiRerun?.github?.ref ?? '',
      inputName: storedCiRerun?.github?.inputName ?? '',
    },
    gitlab: {
      ref: storedCiRerun?.gitlab?.ref ?? '',
      variableName: storedCiRerun?.gitlab?.variableName ?? '',
    },
    bitbucket: {
      pipeline: storedCiRerun?.bitbucket?.pipeline ?? '',
      variableName: storedCiRerun?.bitbucket?.variableName ?? '',
    },
  },
});

const selectedTags = ref<TagInfo[]>(project.value?.tags || []);

const schema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  diagnosisInstructions: z.string().optional(),
  scmToken: z.string().optional(),
  defaultBranch: z.string().optional(),
});

const saving = ref(false);

async function onSubmit() {
  try {
    saving.value = true;

    await $fetch(`/api/projects/${projectId}` as '/api/projects/:id', {
      method: 'PATCH',
      body: {
        label: state.value.label || null,
        description: state.value.description || null,
        diagnosisInstructions: state.value.diagnosisInstructions || null,
        scmToken: state.value.scmToken || null,
        defaultBranch: state.value.defaultBranch || null,
        ciRerun: state.value.ciRerun,
        tagIds: selectedTags.value.map((t) => t.id),
      },
    });

    toast.add({
      title: 'Project updated',
      description: 'Project settings have been saved successfully',
      color: 'success',
    });

    await router.push(`/projects/${projectId}`);
  } catch (error) {
    console.error('Error updating project:', error);
    toast.add({
      title: 'Error',
      description: 'Failed to update project',
      color: 'error',
    });
  } finally {
    saving.value = false;
  }
}

function onCancel() {
  router.push(`/projects/${projectId}`);
}
</script>

<template>
  <UDashboardPanel id="project-edit">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Edit' },
            ]"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-4">
        <UCard>
          <template #header>
            <h2>Edit project settings</h2>
            <p class="text-sm text-gray-600 mt-1">
              Project Name: <span class="font-medium">{{ project?.name }}</span>
            </p>
            <p class="text-xs text-gray-500 mt-1">
              Note: The project name is used to match test results from the reporter and cannot be changed.
            </p>
          </template>

          <UForm :schema="schema" :state="state" class="space-y-5" @submit="onSubmit">
            <ProjectFormFields
              mode="edit"
              :has-token="hasToken"
              v-model:label="state.label"
              v-model:description="state.description"
              v-model:diagnosisInstructions="state.diagnosisInstructions"
              v-model:scmToken="state.scmToken"
              v-model:defaultBranch="state.defaultBranch"
              v-model:ciRerun="state.ciRerun"
              v-model:tags="selectedTags"
              :all-tags="allTags"
              @tag-created="refreshTags()"
            />

            <div class="flex justify-end gap-2 pt-2">
              <UButton variant="ghost" color="neutral" @click="onCancel"> Cancel </UButton>
              <UButton type="submit" icon="i-lucide-check" :loading="saving"> Save changes </UButton>
            </div>
          </UForm>
        </UCard>

        <!-- Desktop shell only: the linked folder is a per-machine setting managed here,
             with the rest of the project settings (renders nothing without the bridge). -->
        <DesktopProjectFolderSection :project-id="projectId" />
      </div>
    </template>
  </UDashboardPanel>
</template>
