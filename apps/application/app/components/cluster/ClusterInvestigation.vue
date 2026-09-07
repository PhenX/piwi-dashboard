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

// A healthy resolve with an empty diff reads "No changes found"; any other
// state (no baseline, unsupported host, fetch failed) is the block's empty
// state, shown as the status sentence — never both at once.
const scmHealthy = computed(
  () => scmStatus.value.color === 'text-green-500' || scmStatus.value.color === 'text-blue-500',
);

// The block opens — baseline picker, commit browser and diff — only when there
// is something to show: a resolved diff or a hand-selected commit range. With
// nothing (unsupported host, no last passing run, an empty range) it collapses
// to one line, so *What changed* never spends the first screen on a picker for
// a diff it does not have.
const hasOpenBlock = computed(() => Boolean(scmChanges.value) || selectedCommitShas.value.length > 0);
</script>

<template>
  <!-- Open: the full card with the baseline picker and the diff, when there are commits or a diff. -->
  <SectionCard v-if="hasOpenBlock" icon="i-lucide-git-compare-arrows" title="What changed" help="cluster.scm">
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

      <div v-if="contextLoading && !scmChanges" class="flex items-center justify-center py-6">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-gray-400" />
      </div>
      <ScmChangesView v-else-if="scmChanges" :changes="scmChanges" />
    </div>
    <CommitBrowserModal
      v-model:open="commitBrowserOpen"
      :cluster-id="clusterId"
      :initial-selected="selectedCommitShas"
      :auto-selected-shas="autoSelectedCommits"
      @confirm="selectedCommitShas = $event"
    />
  </SectionCard>

  <!-- Collapsed: one line — nothing to diff yet. -->
  <p v-else class="text-sm text-muted flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
    <span class="font-medium text-toned">What changed:</span>
    <template v-if="contextLoading && !coverage">
      <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
      <span>looking for the change that broke this…</span>
    </template>
    <template v-else-if="coverage && scmHealthy">no commits in the range</template>
    <template v-else-if="coverage">
      <span :class="scmStatus.color">{{ scmStatus.text }}</span>
      <span v-if="scmStatus.detail" class="text-gray-400">— {{ scmStatus.detail }}</span>
    </template>
    <template v-else>not available</template>
  </p>
</template>
