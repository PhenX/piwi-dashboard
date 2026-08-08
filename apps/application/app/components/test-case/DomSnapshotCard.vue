<script setup lang="ts">
/**
 * Failure-time DOM snapshot rendered server-side from the execution's stored
 * trace ZIP (nothing extra is captured or uploaded). Sanitized: input values,
 * inline handlers and script bodies are removed, token-shaped strings masked.
 * Used on the test-case detail page and the cluster evidence column.
 */

import SectionCard from '../shared/SectionCard.vue';
import CollapsibleSectionCard from '../shared/CollapsibleSectionCard.vue';

const props = defineProps<{
  runId: number;
  testRunsCaseId: number;
  /** When set, the card folds to a header with a peek (persisted per user). */
  storageKey?: string;
}>();

interface DomSnapshotResponse {
  status: 'ok' | 'no-trace' | 'no-snapshot';
  html?: string;
  truncated?: boolean;
  snapshotName?: string;
  action?: string;
}

const cardComponent = computed(() => (props.storageKey ? CollapsibleSectionCard : SectionCard));
const cardBind = computed(() => (props.storageKey ? { storageKey: props.storageKey } : {}));

const {
  data: snapshot,
  pending,
  error,
} = useFetch<DomSnapshotResponse>(() => `/api/test-run-cases/${props.testRunsCaseId}/dom-snapshot`, {
  lazy: true,
});

// Highlighting hundreds of KB of HTML would freeze the tab — show a capped
// excerpt inline and offer the full document via copy.
const DISPLAY_CAP = 20_000;
const excerpt = computed(() => (snapshot.value?.html ?? '').slice(0, DISPLAY_CAP));
const capped = computed(() => (snapshot.value?.html?.length ?? 0) > DISPLAY_CAP);

const subtitle = computed(() => {
  const s = snapshot.value;
  if (!s || s.status !== 'ok') return '';
  const kb = Math.round((s.html?.length ?? 0) / 1024);
  return `${kb} KB · rendered from the uploaded trace${s.snapshotName ? ` (${s.snapshotName})` : ''}`;
});

const { copy, copied } = useCopy();

// Forward reveal so a diagnosis citation can unfold + scroll to this card.
const card = ref<{ reveal?: () => void } | null>(null);
defineExpose({ reveal: () => card.value?.reveal?.() });
</script>

<template>
  <component
    :is="cardComponent"
    v-if="!pending && !error && snapshot?.status === 'ok' && snapshot.html"
    ref="card"
    v-bind="cardBind"
    icon="i-lucide-file-code"
    title="DOM snapshot"
    help="dom-snapshot"
    :subtitle="subtitle"
  >
    <template v-if="storageKey" #folded>
      <span>Failure-time HTML extracted from the trace — {{ Math.round((snapshot.html.length ?? 0) / 1024) }} KB</span>
    </template>
    <template #actions>
      <UTooltip :text="copied ? 'Copied!' : 'Copy full HTML'">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
          @click="copy(snapshot.html)"
        />
      </UTooltip>
    </template>

    <div class="max-h-96 overflow-y-auto">
      <CodeBlock :code="excerpt" lang="xml" />
    </div>
    <p v-if="capped || snapshot.truncated" class="mt-2 text-xs text-gray-400 dark:text-gray-500">
      <template v-if="capped"
        >Showing the first {{ Math.round(DISPLAY_CAP / 1000) }}k characters — use Copy for the full document.</template
      >
      <template v-else>The snapshot was truncated to its size cap.</template>
    </p>
  </component>
</template>
