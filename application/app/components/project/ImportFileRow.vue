<script setup lang="ts">
/**
 * One archive in the import list: its verdict, why it got that verdict, and —
 * once imported — what actually landed, so the user can confirm the history
 * joined up with the runs their reporter already sends.
 */
import type { ImportFileEntry, ImportFileState } from '~/composables/useBlobReportImport';

const props = defineProps<{ entry: ImportFileEntry; removable: boolean }>();
defineEmits<{ remove: [id: number] }>();

const PRESENTATION: Record<ImportFileState, { label: string; color: string; icon: string }> = {
  hashing: { label: 'Reading', color: 'neutral', icon: 'i-lucide-loader-circle' },
  checking: { label: 'Checking', color: 'neutral', icon: 'i-lucide-loader-circle' },
  ready: { label: 'Ready', color: 'primary', icon: 'i-lucide-circle-check' },
  uploading: { label: 'Importing', color: 'primary', icon: 'i-lucide-loader-circle' },
  imported: { label: 'Imported', color: 'success', icon: 'i-lucide-check' },
  duplicate: { label: 'Already imported', color: 'neutral', icon: 'i-lucide-copy-check' },
  'too-large': { label: 'Too large', color: 'warning', icon: 'i-lucide-weight' },
  invalid: { label: 'Not importable', color: 'warning', icon: 'i-lucide-file-x' },
  failed: { label: 'Failed', color: 'error', icon: 'i-lucide-circle-alert' },
};

const presentation = computed(() => PRESENTATION[props.entry.state]);
const spinning = computed(() => ['hashing', 'checking', 'uploading'].includes(props.entry.state));
const result = computed(() => props.entry.result);
/** A summary only exists for an archive this request actually imported. */
const summary = computed(() => (props.entry.state === 'imported' ? result.value : null));
</script>

<template>
  <div class="p-3 sm:p-4 space-y-2">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <p class="font-medium text-sm break-all">{{ entry.name }}</p>
        <p class="text-xs text-gray-500">{{ formatBytes(entry.size) }}</p>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <UBadge :color="presentation.color as never" variant="subtle" size="sm">
          <UIcon :name="presentation.icon" class="size-3.5 mr-1" :class="spinning && 'animate-spin'" />
          {{ presentation.label }}
        </UBadge>
        <UButton
          v-if="removable"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          title="Remove from the list"
          @click="$emit('remove', entry.id)"
        />
      </div>
    </div>

    <UProgress v-if="entry.state === 'uploading'" :model-value="Math.round(entry.progress * 100)" size="sm" />

    <p v-if="entry.message" class="text-xs" :class="entry.state === 'failed' ? 'text-error' : 'text-gray-500'">
      {{ entry.message }}
    </p>

    <div v-if="result?.testRunId" class="text-xs">
      <ULink :to="`/test-runs/${result.testRunId}`" class="text-primary hover:underline">
        View run #{{ result.testRunId }}
      </ULink>
    </div>

    <template v-if="summary">
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>{{ summary.totalTests }} executions</span>
        <span>{{ summary.passedTests }} passed</span>
        <span>{{ summary.failedTests }} failed</span>
        <span v-if="summary.skippedTests">{{ summary.skippedTests }} skipped</span>
        <span v-if="summary.flakyTests">{{ summary.flakyTests }} flaky</span>
        <span v-if="summary.traceCount">{{ summary.traceCount }} traces</span>
        <span v-if="summary.attachmentCount">{{ summary.attachmentCount }} attachments</span>
      </div>

      <UAlert
        v-if="summary.shard"
        color="warning"
        variant="subtle"
        icon="i-lucide-split"
        :description="`This archive is shard ${summary.shard.current} of ${summary.shard.total}. Each shard imports as its own run — they are not merged.`"
        :ui="{ description: 'text-xs' }"
      />

      <div v-if="summary.filePaths.length" class="text-xs text-gray-500">
        <p class="mb-1">
          Spec files recorded as
          <span class="text-gray-400">(these must match the paths your live runs report for history to line up)</span>:
        </p>
        <ul class="space-y-0.5">
          <li v-for="path in summary.filePaths" :key="path">
            <code class="text-[11px]">{{ path }}</code>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
