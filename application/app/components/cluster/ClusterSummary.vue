<script setup lang="ts">
import type { FailureClusterDetail } from '~~/types/api';

const props = defineProps<{
  cluster: FailureClusterDetail;
  triageStatus: string;
  triageNote: string;
  triageSaving: boolean;
  triageChanged: boolean;
}>();

const emit = defineEmits<{
  'update:triageStatus': [value: string];
  'update:triageNote': [value: string];
  'save-triage': [];
}>();

// Triage is the only metadata block alongside the cluster info card.
const { summaryColSpanClass } = useDetailGrid(() => 1);

const triageStatusOptions = [
  { label: 'Open', value: 'open', color: 'warning' as const },
  { label: 'Resolved', value: 'resolved', color: 'success' as const },
  { label: 'Ignored', value: 'ignored', color: 'neutral' as const },
];
</script>

<template>
  <FoldableSummary storage-key="failure-cluster">
    <template #folded>
      <div class="flex items-center gap-3 flex-1 min-w-0 justify-between">
        <div class="flex items-center gap-3 min-w-0">
          <UBadge :color="clusterStatusColor(cluster.status)" variant="solid" size="sm" class="shrink-0 capitalize">
            {{ cluster.status }}
          </UBadge>
          <span class="font-mono text-sm truncate text-gray-600 dark:text-gray-400 min-w-0">
            {{ cluster.signature }}
          </span>
          <UBadge v-if="cluster.errorType" :color="clusterErrorTypeColor(cluster.errorType)" variant="subtle" size="sm">
            {{ cluster.errorType }}
          </UBadge>
        </div>
        <div class="flex items-center gap-3 shrink-0 max-sm:hidden">
          <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
            {{ cluster.occurrences }} occurrence{{ cluster.occurrences === 1 ? '' : 's' }}
          </span>
          <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
            {{ cluster.affectedTests }} {{ cluster.affectedTests === 1 ? 'test' : 'tests' }}
          </span>
          <UBadge
            v-if="cluster.diagnosis?.status === 'completed' && cluster.diagnosis?.category"
            color="neutral"
            variant="outline"
            size="sm"
            class="gap-1 whitespace-nowrap"
          >
            <UIcon name="i-lucide-sparkles" class="size-3" />
            {{ cluster.diagnosis.category }}
          </UBadge>
          <span v-if="cluster.lastSeenAt" class="text-xs text-gray-400 whitespace-nowrap">
            last seen {{ formatRelativeTime(cluster.lastSeenAt) }}
          </span>
        </div>
      </div>
    </template>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <!-- Left: cluster metadata -->
      <div :class="summaryColSpanClass">
        <SectionCard :title="cluster.signature">
          <div class="space-y-3">
            <p v-if="cluster.title" class="text-sm font-medium break-words text-gray-500 dark:text-gray-400">
              {{ cluster.title }}
            </p>
            <div class="flex flex-wrap gap-2">
              <UBadge v-if="cluster.errorType" :color="clusterErrorTypeColor(cluster.errorType)" variant="subtle">
                {{ cluster.errorType }}
              </UBadge>
              <UBadge color="neutral" variant="subtle">
                {{ cluster.occurrences }} occurrence{{ cluster.occurrences === 1 ? '' : 's' }}
              </UBadge>
              <UBadge color="neutral" variant="subtle">
                {{ cluster.affectedTests }} {{ cluster.affectedTests === 1 ? 'test' : 'tests' }} affected
              </UBadge>
              <UBadge
                v-if="cluster.diagnosis?.status === 'completed' && cluster.diagnosis?.category"
                color="neutral"
                variant="outline"
                class="gap-1"
              >
                <UIcon name="i-lucide-sparkles" class="size-3" />
                {{ cluster.diagnosis.category }}
              </UBadge>
              <HelpHint topic="cluster.concept" />
            </div>
            <p class="text-sm text-gray-500">
              First seen in
              <NuxtLink :to="`/test-runs/${cluster.firstSeenRunId}`" class="text-primary hover:underline">
                run #{{ cluster.firstSeenRunId }}
              </NuxtLink>
              <template v-if="cluster.firstSeenAt"> ({{ formatRelativeTime(cluster.firstSeenAt) }}) </template>
              · Last seen in
              <NuxtLink :to="`/test-runs/${cluster.lastSeenRunId}`" class="text-primary hover:underline">
                run #{{ cluster.lastSeenRunId }}
              </NuxtLink>
              <template v-if="cluster.lastSeenAt"> ({{ formatRelativeTime(cluster.lastSeenAt) }}) </template>
              <RunStatusBadge
                v-if="cluster.lastSeenRunStatus"
                :status="cluster.lastSeenRunStatus"
                size="sm"
                class="ml-1 align-middle"
              />
            </p>
          </div>
        </SectionCard>
      </div>

      <!-- Triage card -->
      <SectionCard
        class="lg:col-span-3"
        icon="i-lucide-triangle-alert"
        icon-class="text-amber-500"
        title="Triage"
        help="cluster.triage"
      >
        <div class="flex items-start gap-3">
          <div class="flex flex-col gap-1 shrink-0">
            <UButton
              v-for="opt in triageStatusOptions"
              :key="opt.value"
              size="xs"
              class="justify-start"
              :color="triageStatus === opt.value ? opt.color : 'neutral'"
              :variant="triageStatus === opt.value ? 'solid' : 'outline'"
              @click="emit('update:triageStatus', opt.value)"
            >
              {{ opt.label }}
            </UButton>
          </div>
          <div class="flex-1 min-w-0 space-y-1.5">
            <UTextarea
              :model-value="triageNote"
              placeholder="Optional note…"
              :rows="3"
              class="text-sm w-full"
              @update:model-value="emit('update:triageNote', $event)"
            />
            <div class="flex justify-end">
              <UButton
                v-if="triageChanged"
                size="xs"
                icon="i-lucide-check"
                :loading="triageSaving"
                @click="emit('save-triage')"
              >
                Save
              </UButton>
            </div>
          </div>
        </div>
      </SectionCard>

    </div>
  </FoldableSummary>
</template>
