<script setup lang="ts">
import { MAX_ANALYTICS_DAYS } from '#shared/analytics/scope';
import type { AnalyticsScopeState } from '~/composables/useAnalyticsScope';

const props = defineProps<{
  modelValue: AnalyticsScopeState;
  availableEnvironments: string[];
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

const ENV_ALL = 'All environments';

const environment = computed({
  get: () => props.modelValue.environment ?? ENV_ALL,
  set: (val: string) => emit('update:modelValue', { ...props.modelValue, environment: val === ENV_ALL ? null : val }),
});

const environmentItems = computed(() => [ENV_ALL, ...props.availableEnvironments]);

const fullRunsOnly = computed({
  get: () => props.modelValue.fullRunsOnly,
  set: (val: boolean) => emit('update:modelValue', { ...props.modelValue, fullRunsOnly: val }),
});
</script>

<template>
  <div class="flex items-center gap-3 flex-wrap">
    <USelect v-model="days" :items="PERIOD_ITEMS" size="sm" class="min-w-[140px]" icon="i-lucide-calendar-range" />

    <USelect
      v-if="availableEnvironments.length > 0"
      v-model="environment"
      :items="environmentItems"
      size="sm"
      class="min-w-[160px]"
      icon="i-lucide-server"
    />

    <label
      class="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
    >
      <UCheckbox v-model="fullRunsOnly" size="sm" />
      Full runs only
    </label>
  </div>
</template>
