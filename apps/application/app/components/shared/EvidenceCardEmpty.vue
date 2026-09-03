<script setup lang="ts">
/**
 * An evidence card that holds no data, shown in place of folding it away so the
 * reader learns *why* it is empty. Same header contract as the real card
 * (icon/title/help/storageKey) and folds like it, with a one-line peek naming
 * the state; the body is the full `not captured` / `nothing happened` /
 * `not applicable` message from `resolveEvidenceState`.
 */
import type { EvidenceState } from '#shared/evidence-state';
import type { HelpTopicKey } from '~/utils/help-content';

const props = withDefaults(
  defineProps<{
    title: string;
    icon: string;
    state: EvidenceState;
    /** Inline-help topic key for the header. */
    help?: HelpTopicKey;
    /** Persist the fold state per user. */
    storageKey: string;
    /** Docs page for the empty state's link. */
    doc?: string;
  }>(),
  { doc: '/capture-fixtures' },
);

/** One-line summary shown on the folded header. */
const peek = computed(() => {
  switch (props.state.state) {
    case 'not-captured':
      return 'Not captured — add the capture fixtures';
    case 'nothing-happened':
      return 'The fixtures were active and recorded nothing';
    case 'not-applicable':
      return 'Not applicable for this app';
    default:
      return '';
  }
});
</script>

<template>
  <CollapsibleSectionCard :icon="icon" :title="title" :help="help" :storage-key="storageKey" default-folded>
    <template #folded>{{ peek }}</template>
    <EvidenceEmptyState :state="state" :doc="doc" compact />
  </CollapsibleSectionCard>
</template>
