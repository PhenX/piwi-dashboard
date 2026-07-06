<script setup lang="ts">
const {
  clusterId,
  baseCommit,
  selectedCommitShas,
  autoSelectedCommits,
  baseCommitIsPinned,
  coverage,
  scmChanges,
  contextLoading,
  refreshContext,
} = useClusterDiagnosis();

const commitBrowserOpen = ref(false);

const { scmStatus } = useScmStatusSummary(coverage);
</script>

<template>
  <div class="space-y-3">
    <div class="pb-2 border-b border-default">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs text-gray-500 font-medium shrink-0 inline-flex items-center gap-1">
          Baseline <HelpHint topic="cluster.baseline" />
        </span>
        <CommitPicker v-model="baseCommit" :cluster-id="clusterId" />
        <UTooltip v-if="baseCommitIsPinned" text="Baseline commit pinned for this cluster">
          <UIcon name="i-lucide-pin" class="size-3.5 text-primary shrink-0" />
        </UTooltip>
        <div class="flex items-center gap-1.5 ml-auto">
          <div
            v-if="selectedCommitShas.length"
            class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
          >
            <UIcon name="i-lucide-git-commit-horizontal" class="size-3" />
            <span>{{ selectedCommitShas.length }} commit{{ selectedCommitShas.length === 1 ? '' : 's' }}</span>
            <button class="ml-0.5 hover:opacity-70 transition-opacity" @click="selectedCommitShas = []">
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </div>
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-list" @click="commitBrowserOpen = true">
            Browse
          </UButton>
          <UButton
            icon="i-lucide-refresh-cw"
            size="xs"
            color="neutral"
            variant="outline"
            :loading="contextLoading"
            @click="refreshContext"
          />
        </div>
      </div>
    </div>

    <div
      v-if="coverage"
      class="flex items-start gap-1.5 text-xs px-2 py-1.5 rounded-md bg-elevated border border-default"
    >
      <UIcon :name="scmStatus.icon" class="size-3.5 mt-0.5 shrink-0" :class="scmStatus.color" />
      <div>
        <span :class="scmStatus.color">{{ scmStatus.text }}</span>
        <span v-if="scmStatus.detail" class="text-gray-400 ml-1">— {{ scmStatus.detail }}</span>
      </div>
    </div>

    <div v-if="contextLoading && !scmChanges" class="flex items-center justify-center py-6">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-gray-400" />
    </div>

    <ScmChangesView v-else-if="scmChanges" :changes="scmChanges" />

    <p v-else-if="coverage && !contextLoading && !scmChanges" class="text-xs text-gray-400 text-center py-4">
      No changes found in this range.
    </p>
  </div>

  <CommitBrowserModal
    v-model:open="commitBrowserOpen"
    :cluster-id="clusterId"
    :initial-selected="selectedCommitShas"
    :auto-selected-shas="autoSelectedCommits"
    @confirm="selectedCommitShas = $event"
  />
</template>
