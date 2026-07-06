<script setup lang="ts">
/**
 * Compact banner shown on the failure tab of a test-run case when the failure
 * belongs to a cluster. Summarises the cluster (new/known, siblings in this run,
 * triage) and hands off to the cluster page — the single place where the full
 * investigation lives (cross-test evidence, what changed, AI diagnosis).
 */
export interface FailureClusterBannerCluster {
  id: number;
  sameRunCaseCount: number;
  isNew: boolean;
  firstSeenRunId: number;
  firstSeenAt: string | Date | null;
  status?: string | null;
  triageNote?: string | null;
}

const props = defineProps<{
  cluster: FailureClusterBannerCluster;
}>();

const otherFailingCount = computed(() => Math.max(0, props.cluster.sameRunCaseCount - 1));
</script>

<template>
  <div class="rounded-lg border border-default bg-elevated/40 p-4">
    <div class="flex items-start gap-3">
      <UIcon name="i-lucide-layers" class="size-5 shrink-0 text-primary mt-0.5" />
      <div class="min-w-0 flex-1 space-y-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-sm font-medium">Part of a failure cluster</span>
          <HelpHint topic="cluster.new-vs-known" />
          <UBadge v-if="cluster.isNew" color="warning" variant="subtle" size="sm">New failure</UBadge>
          <UBadge
            v-if="cluster.status && cluster.status !== 'open'"
            :color="cluster.status === 'resolved' ? 'success' : 'neutral'"
            variant="subtle"
            size="sm"
          >
            {{ cluster.status }}
          </UBadge>
        </div>

        <p class="text-xs text-gray-500 dark:text-gray-400">
          <template v-if="otherFailingCount > 0">
            Matches {{ otherFailingCount }} other failing
            {{ otherFailingCount === 1 ? 'test' : 'tests' }} in this run.
          </template>
          <template v-if="!cluster.isNew">
            Known failure — first seen in
            <NuxtLink :to="`/test-runs/${cluster.firstSeenRunId}`" class="text-primary hover:underline">
              run #{{ cluster.firstSeenRunId }}
            </NuxtLink>
            <template v-if="cluster.firstSeenAt"> ({{ formatRelativeTime(cluster.firstSeenAt) }})</template>.
          </template>
        </p>

        <p v-if="cluster.triageNote" class="text-xs italic text-gray-500 dark:text-gray-400" :title="cluster.triageNote">
          “{{ cluster.triageNote }}”
        </p>

        <p class="text-xs text-gray-400 dark:text-gray-500 pt-1">
          Open the cluster to see evidence across every affected test, what changed since the last green run, and the AI
          diagnosis.
        </p>
      </div>
    </div>

    <div class="flex justify-end mt-3">
      <UButton
        :to="`/failure-clusters/${cluster.id}`"
        size="sm"
        color="primary"
        variant="solid"
        trailing-icon="i-lucide-arrow-right"
      >
        Investigate in failure cluster
      </UButton>
    </div>
  </div>
</template>
