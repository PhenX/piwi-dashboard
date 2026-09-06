<script setup lang="ts">
/**
 * The failing action's page as a pair of trace screenshots — the frame *before
 * the failing action* beside the frame *at the failure* — when the trace was
 * recorded with `snapshots.screen`. Reads this run's own trace, so it needs no
 * baseline.
 */
import type { EvidenceState } from '#shared/evidence-state';
import { useTraceSnapshots } from '~/composables/useTraceSnapshots';
import SectionCard from '../shared/SectionCard.vue';

const props = defineProps<{
  testRunsCaseId: number;
  /** Drop the card chrome when embedded inside an evidence tab panel. */
  embedded?: boolean;
}>();

const { pending, error, hasScreen, failingStep, snapshotUrl } = useTraceSnapshots(() => props.testRunsCaseId);

const beforeSrc = computed(() =>
  failingStep.value?.screen.before ? snapshotUrl(failingStep.value.callId, 'screen', 'before') : null,
);
const afterSrc = computed(() =>
  failingStep.value?.screen.after ? snapshotUrl(failingStep.value.callId, 'screen', 'after') : null,
);
const hasPair = computed(() => Boolean(beforeSrc.value));

const emit = defineEmits<{ available: [value: boolean] }>();
const available = computed(() => !pending.value && !error.value && hasPair.value);
watch(available, (value) => emit('available', value), { immediate: true });

const emptyState = computed<EvidenceState | null>(() => {
  if (pending.value || hasPair.value) return null;
  if (!hasScreen.value) {
    return {
      state: 'not-captured',
      title: 'Before the failing action',
      description: 'The page before the failing action is not captured for this project — enable trace snapshots.',
      to: '/setup',
      toLabel: 'Open setup',
    };
  }
  return {
    state: 'not-applicable',
    title: 'Before the failing action',
    description: 'No screenshot was recorded before the failing action — not applicable here.',
  };
});
</script>

<template>
  <SectionCard :embedded="embedded" icon="i-lucide-image" title="Before the failing action">
    <LoadingState v-if="pending" text="Loading trace screenshots…" />

    <div v-else-if="hasPair" class="grid gap-4" :class="afterSrc ? 'sm:grid-cols-2' : ''">
      <figure class="min-w-0">
        <figcaption class="mb-1 text-[11px] font-medium text-muted">Before the failing action</figcaption>
        <img
          :src="beforeSrc!"
          alt="Page before the failing action"
          loading="lazy"
          class="w-full rounded border border-default bg-elevated object-contain"
        />
      </figure>
      <figure v-if="afterSrc" class="min-w-0">
        <figcaption class="mb-1 text-[11px] font-medium text-muted">At the failure</figcaption>
        <img
          :src="afterSrc"
          alt="Page at the failure"
          loading="lazy"
          class="w-full rounded border border-default bg-elevated object-contain"
        />
      </figure>
    </div>

    <EvidenceEmptyState v-else-if="emptyState" :state="emptyState" doc="/evidence" compact />
  </SectionCard>
</template>
