<script setup lang="ts">
/**
 * A cluster's history at a glance: how often it has occurred, how many diagnosis
 * versions exist (a link opens the version slide-over) and, when a fix has been
 * observed, the fix-verification date.
 */
import type { FailureClusterDetail } from '~~/types/api';
import { formatRelativeTime } from '~/utils';

const props = defineProps<{ cluster: FailureClusterDetail }>();

const emit = defineEmits<{ 'open-history': [] }>();

const versionCount = ref(0);
onMounted(async () => {
  try {
    const res = await $fetch<{ items: unknown[] }>(`/api/failure-clusters/${props.cluster.id}/diagnoses`);
    versionCount.value = res.items.length;
  } catch {
    versionCount.value = 0;
  }
});

const fixBadge = computed(() => fixVerificationBadge(props.cluster.fixVerification));
</script>

<template>
  <SectionCard icon="i-lucide-history" title="History" data-shot="cluster-history">
    <div class="flex flex-col gap-2 text-sm">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span class="tabular-nums">
          <strong>{{ cluster.occurrences }}</strong> occurrence{{ cluster.occurrences === 1 ? '' : 's' }} across
          <strong>{{ cluster.affectedTests }}</strong> {{ cluster.affectedTests === 1 ? 'test' : 'tests' }}
        </span>
        <span class="inline-flex items-center gap-1">
          first seen
          <NuxtLink :to="`/test-runs/${cluster.firstSeenRunId}`" class="text-primary hover:underline">
            run #{{ cluster.firstSeenRunId }}
          </NuxtLink>
          <ClientOnly>
            <span v-if="cluster.firstSeenAt" class="text-dimmed">({{ formatRelativeTime(cluster.firstSeenAt) }})</span>
          </ClientOnly>
        </span>
        <span class="inline-flex items-center gap-1">
          last seen
          <NuxtLink :to="`/test-runs/${cluster.lastSeenRunId}`" class="text-primary hover:underline">
            run #{{ cluster.lastSeenRunId }}
          </NuxtLink>
          <ClientOnly>
            <span v-if="cluster.lastSeenAt" class="text-dimmed">({{ formatRelativeTime(cluster.lastSeenAt) }})</span>
          </ClientOnly>
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span v-if="versionCount > 0" class="inline-flex items-center gap-1.5">
          <UIcon name="i-lucide-sparkles" class="size-3.5 shrink-0 text-primary" />
          Diagnosed <strong>{{ versionCount }}</strong> {{ versionCount === 1 ? 'time' : 'times' }}
          <UButton size="xs" color="neutral" variant="link" class="px-0" @click="emit('open-history')">
            View versions
          </UButton>
        </span>
        <span v-if="fixBadge && cluster.fixLandedAt" class="inline-flex items-center gap-1.5">
          <UBadge :color="fixBadge.color" variant="subtle" size="sm">{{ fixBadge.label }}</UBadge>
          <ClientOnly>
            <span class="text-dimmed">{{ formatRelativeTime(cluster.fixLandedAt) }}</span>
          </ClientOnly>
        </span>
      </div>
    </div>
  </SectionCard>
</template>
