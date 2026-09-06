<script setup lang="ts">
/**
 * In-execution structural page diff — the failing action's page *before* it ran
 * against the page *at the failure* (the modal that stayed open, the table that
 * emptied). Read straight from this run's trace aria snapshots, so it needs no
 * green baseline. Complements the vs-last-green PageDiffCard.
 */
import { formatPageDiffSummary } from '#shared/page-diff';
import type { EvidenceState } from '#shared/evidence-state';
import { useTraceSnapshots } from '~/composables/useTraceSnapshots';
import SectionCard from '../shared/SectionCard.vue';
import PageDiffHunkList from './PageDiffHunkList.vue';

const props = defineProps<{
  testRunsCaseId: number;
  /** Drop the card chrome when embedded inside an evidence tab panel. */
  embedded?: boolean;
}>();

const { data, pending, error, hasAria } = useTraceSnapshots(() => props.testRunsCaseId);

const pageDiff = computed(() => (data.value?.status === 'ok' ? (data.value.pageDiff ?? null) : null));
const hunks = computed(() => pageDiff.value?.hunks ?? []);
const summaryText = computed(() => (pageDiff.value ? formatPageDiffSummary(pageDiff.value.summary) : ''));

// The tab reads `available` to show the Screenshot · Page diff toggle for
// exactly the condition under which this diff renders.
const emit = defineEmits<{ available: [value: boolean] }>();
const available = computed(() => !pending.value && !error.value && pageDiff.value != null);
watch(available, (value) => emit('available', value), { immediate: true });

// The three-state empty copy: not captured (no aria snapshots at all), or not
// applicable (aria present but the failing action lacks a before/after pair).
const emptyState = computed<EvidenceState | null>(() => {
  if (pending.value || available.value) return null;
  if (!hasAria.value) {
    return {
      state: 'not-captured',
      title: 'Page diff',
      description: 'The page around the failing action is not captured for this project — enable trace snapshots.',
      to: '/setup',
      toLabel: 'Open setup',
    };
  }
  return {
    state: 'not-applicable',
    title: 'Page diff',
    description: 'This failure has no before-and-after page to compare — not applicable here.',
  };
});
</script>

<template>
  <SectionCard :embedded="embedded" icon="i-lucide-file-diff" title="Page diff" help="case.page-diff">
    <template v-if="available" #subtitle>
      <span>before the failing action → at the failure</span>
    </template>
    <template v-if="available" #actions>
      <UBadge color="neutral" variant="subtle" size="sm" class="font-mono tabular-nums">{{ summaryText }}</UBadge>
    </template>

    <LoadingState v-if="pending" text="Comparing the page before and at the failure…" />

    <template v-else-if="available">
      <!-- No structural change is positive evidence — state it explicitly. -->
      <UAlert
        v-if="hunks.length === 0"
        color="success"
        icon="i-lucide-check-circle"
        variant="subtle"
        description="The page structure did not change while the failing action ran — a structural change is unlikely to explain this failure."
      />
      <PageDiffHunkList v-else :hunks="hunks" />
    </template>

    <EvidenceEmptyState v-else-if="emptyState" :state="emptyState" doc="/evidence" compact />
  </SectionCard>
</template>
