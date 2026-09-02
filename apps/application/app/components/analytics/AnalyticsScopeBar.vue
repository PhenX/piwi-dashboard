<script setup lang="ts">
import { MAX_ANALYTICS_DAYS } from '#shared/analytics/scope';
import { DEFAULT_ANALYTICS_SCOPE_STATE, type AnalyticsScopeState } from '~/composables/useAnalyticsScope';
import type { ProjectMenuItem } from '~~/types/api';

const props = defineProps<{
  modelValue: AnalyticsScopeState;
  availableProjects: ProjectMenuItem[];
  availableEnvironments: string[];
  availableBranches?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: AnalyticsScopeState];
}>();

const PERIOD_ITEMS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'Last year', value: 365 },
  { label: 'All time', value: MAX_ANALYTICS_DAYS },
];

const days = computed({
  get: () => props.modelValue.days,
  set: (val: number) => emit('update:modelValue', { ...props.modelValue, days: val }),
});

const projectItems = computed(() => props.availableProjects.map((p) => ({ label: p.label || p.name, value: p.id })));

const projectIds = computed({
  get: () => props.modelValue.projectIds,
  set: (val: number[]) => emit('update:modelValue', { ...props.modelValue, projectIds: val }),
});

function projectLabel(id: number) {
  return projectItems.value.find((item) => item.value === id)?.label ?? `#${id}`;
}

const ENV_ALL = 'All environments';

const environment = computed({
  get: () => props.modelValue.environment ?? ENV_ALL,
  set: (val: string) => emit('update:modelValue', { ...props.modelValue, environment: val === ENV_ALL ? null : val }),
});

const environmentItems = computed(() => [ENV_ALL, ...props.availableEnvironments]);

const BRANCH_ALL = 'All branches';

const branch = computed({
  get: () => props.modelValue.branch ?? BRANCH_ALL,
  set: (val: string) => emit('update:modelValue', { ...props.modelValue, branch: val === BRANCH_ALL ? null : val }),
});

const branchItems = computed(() => [BRANCH_ALL, ...(props.availableBranches ?? [])]);

const fullRunsOnly = computed({
  get: () => props.modelValue.fullRunsOnly,
  set: (val: boolean) => emit('update:modelValue', { ...props.modelValue, fullRunsOnly: val }),
});

const isDefault = computed(
  () =>
    props.modelValue.days === DEFAULT_ANALYTICS_SCOPE_STATE.days &&
    props.modelValue.projectIds.length === 0 &&
    props.modelValue.environment === null &&
    props.modelValue.branch === null &&
    props.modelValue.fullRunsOnly === DEFAULT_ANALYTICS_SCOPE_STATE.fullRunsOnly,
);

function reset() {
  emit('update:modelValue', { ...DEFAULT_ANALYTICS_SCOPE_STATE });
}
</script>

<template>
  <div class="flex items-center gap-3 flex-wrap">
    <USelect v-model="days" :items="PERIOD_ITEMS" size="sm" class="min-w-[140px]" icon="i-lucide-calendar-range" />

    <USelectMenu
      v-if="projectItems.length > 0"
      v-model="projectIds"
      :items="projectItems"
      value-key="value"
      multiple
      searchable
      size="sm"
      class="min-w-[170px]"
      placeholder="All projects"
    >
      <template #default="{ modelValue: selected }">
        <div class="flex items-center gap-1.5">
          <UIcon
            name="i-lucide-folder"
            class="size-3.5 shrink-0"
            :class="(selected as number[]).length ? 'text-primary' : 'text-gray-400'"
          />
          <span v-if="!(selected as number[]).length" class="text-gray-500">All projects</span>
          <span v-else-if="(selected as number[]).length === 1" class="truncate">{{
            projectLabel((selected as number[])[0]!)
          }}</span>
          <span v-else>{{ (selected as number[]).length }} projects</span>
        </div>
      </template>
    </USelectMenu>

    <USelect
      v-if="availableEnvironments.length > 0"
      v-model="environment"
      :items="environmentItems"
      size="sm"
      class="min-w-[160px]"
      icon="i-lucide-server"
    />

    <USelect
      v-if="(availableBranches?.length ?? 0) > 0"
      v-model="branch"
      :items="branchItems"
      size="sm"
      class="min-w-[160px]"
      icon="i-lucide-git-branch"
    />

    <label
      class="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
    >
      <UCheckbox v-model="fullRunsOnly" size="sm" />
      Full runs only
    </label>

    <UButton v-if="!isDefault" variant="ghost" size="sm" color="neutral" icon="i-lucide-x" @click="reset">
      Reset
    </UButton>
  </div>
</template>
