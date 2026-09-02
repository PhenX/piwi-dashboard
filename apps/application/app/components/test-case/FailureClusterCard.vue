<script setup lang="ts">
/**
 * Rail card shown on the Diagnosis tab of a failing test-run case when the failure
 * belongs to a cluster. Summarises the cluster — signature, error type, how many
 * tests it hit, new/known, triage — and surfaces the cluster's AI verdict when one
 * exists, then hands off to the cluster page where the full cross-test investigation
 * (evidence across every affected test, what changed, AI diagnosis) lives.
 */
import { clusterErrorTypeColor } from '~/utils';
import { describeCluster, clusterSignatureLine } from '#shared/describe-cluster';

export interface FailureClusterCardCluster {
  id: number;
  signature: string;
  title?: string | null;
  selector?: string | null;
  errorType?: string | null;
  status?: string | null;
  triageNote?: string | null;
  occurrences?: number | null;
  firstSeenRunId: number;
  firstSeenAt?: string | Date | null;
  isNew: boolean;
  sameRunCaseCount: number;
  diagnosis?: {
    status?: string | null;
    category?: string | null;
    confidence?: string | null;
    summary?: string | null;
  } | null;
}

const props = defineProps<{
  cluster: FailureClusterCardCluster;
}>();

const otherFailingCount = computed(() => Math.max(0, props.cluster.sameRunCaseCount - 1));

const aiVerdict = computed(() => {
  const d = props.cluster.diagnosis;
  return d && d.status === 'completed' && d.summary ? d : null;
});

const confidenceColor = (c?: string | null): 'success' | 'warning' | 'neutral' =>
  c === 'high' ? 'success' : c === 'medium' ? 'warning' : 'neutral';
</script>

<template>
  <SectionCard icon="i-lucide-layers" icon-class="text-primary" title="Failure cluster" help="cluster.concept">
    <template #actions>
      <UBadge v-if="cluster.isNew" color="warning" variant="subtle" size="sm">New</UBadge>
      <UBadge
        v-if="cluster.status && cluster.status !== 'open'"
        color="neutral"
        variant="subtle"
        size="sm"
        class="capitalize"
      >
        Triage: {{ formatTriageStatus(cluster.status) }}
      </UBadge>
    </template>

    <div class="space-y-3">
      <!-- Signature + error type -->
      <div class="space-y-1.5">
        <div class="flex items-center gap-2 flex-wrap">
          <UBadge v-if="cluster.errorType" :color="clusterErrorTypeColor(cluster.errorType)" variant="soft" size="sm">
            {{ cluster.errorType }}
          </UBadge>
          <span class="text-xs text-gray-500">
            {{ cluster.occurrences ?? 0 }} occurrence{{ (cluster.occurrences ?? 0) === 1 ? '' : 's' }}
          </span>
        </div>
        <p class="text-sm font-medium break-words" :title="cluster.signature">{{ describeCluster(cluster) }}</p>
        <p
          v-if="clusterSignatureLine(cluster)"
          class="font-mono text-xs text-gray-600 dark:text-gray-400 break-all line-clamp-2"
        >
          {{ cluster.signature }}
        </p>
      </div>

      <!-- Scope: siblings in this run + new/known -->
      <p class="text-xs text-gray-500 dark:text-gray-400">
        <template v-if="otherFailingCount > 0">
          Matches {{ otherFailingCount }} other failing {{ otherFailingCount === 1 ? 'test' : 'tests' }} in this run.
        </template>
        <template v-if="!cluster.isNew">
          Known failure — first seen in
          <NuxtLink :to="`/test-runs/${cluster.firstSeenRunId}`" class="text-primary hover:underline">
            run #{{ cluster.firstSeenRunId }}
          </NuxtLink>
          <template v-if="cluster.firstSeenAt"> ({{ formatRelativeTime(cluster.firstSeenAt) }})</template>.
        </template>
        <template v-else>Opened a new cluster in this run.</template>
      </p>

      <!-- Cluster AI verdict, when already diagnosed -->
      <div v-if="aiVerdict" class="rounded-lg border border-default bg-elevated/40 p-2.5 space-y-1">
        <div class="flex items-center gap-1.5 flex-wrap">
          <UIcon name="i-lucide-sparkles" class="size-3.5 text-primary shrink-0" />
          <span class="text-xs font-medium">AI verdict</span>
          <UBadge v-if="aiVerdict.category" color="neutral" variant="soft" size="xs">{{ aiVerdict.category }}</UBadge>
          <UBadge v-if="aiVerdict.confidence" :color="confidenceColor(aiVerdict.confidence)" variant="soft" size="xs">
            {{ aiVerdict.confidence }} confidence
          </UBadge>
        </div>
        <p class="text-xs text-gray-600 dark:text-gray-400 line-clamp-3">{{ aiVerdict.summary }}</p>
      </div>

      <!-- Triage note -->
      <p v-if="cluster.triageNote" class="text-xs italic text-gray-500 dark:text-gray-400" :title="cluster.triageNote">
        “{{ cluster.triageNote }}”
      </p>

      <UButton
        :to="`/failure-clusters/${cluster.id}`"
        size="sm"
        color="primary"
        variant="solid"
        block
        trailing-icon="i-lucide-arrow-right"
      >
        Open cluster investigation
      </UButton>
    </div>
  </SectionCard>
</template>
