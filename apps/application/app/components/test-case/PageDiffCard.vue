<script setup lang="ts">
/**
 * Structural page diff between a failing execution and the same test's last
 * green ARIA sample. Self-contained: fetches the diff for a test-run case, then
 * renders a compact hunk list — added, removed, renamed, changed and moved
 * nodes, unchanged subtrees collapsed, the failing locator's node highlighted.
 * When no diff can be produced it shows the three-state evidence empty copy.
 */
import type { PageDiff } from '~~/types/api';
import type { PageDiffHunkType } from '#shared/page-diff';
import { formatPageDiffSummary } from '#shared/page-diff';
import type { EvidenceState } from '#shared/evidence-state';
import SectionCard from '../shared/SectionCard.vue';

const props = defineProps<{
  runId: number;
  testRunsCaseId: number;
}>();

const {
  data: diff,
  pending,
  error,
} = useFetch<PageDiff>(() => `/api/test-run-cases/${props.testRunsCaseId}/page-diff`, { lazy: true });

// The page/tab reads `available` to show the Screenshot · Page diff toggle for
// exactly the condition under which a diff renders.
const emit = defineEmits<{ available: [value: boolean] }>();
const available = computed(() => !pending.value && !error.value && diff.value?.status === 'ok');
watch(available, (value) => emit('available', value), { immediate: true });

const summaryText = computed(() => (diff.value?.summary ? formatPageDiffSummary(diff.value.summary) : ''));
const hunks = computed(() => diff.value?.hunks ?? []);

const baselineLine = computed(() => {
  const b = diff.value?.baseline;
  if (!b) return '';
  const commit = b.commit ? ` on ${b.commit.slice(0, 7)}` : '';
  const when = b.at ? `, ${formatRelativeTime(new Date(b.at))}` : '';
  return `vs last green — run #${b.runId}${commit}${when}`;
});

// Per-hunk-type glyph, tone and accessible label.
const HUNK_META: Record<PageDiffHunkType, { symbol: string; classes: string; label: string }> = {
  added: { symbol: '+', classes: 'text-green-700 dark:text-green-400', label: 'Added' },
  removed: { symbol: '−', classes: 'text-red-700 dark:text-red-400', label: 'Removed' },
  renamed: { symbol: '~', classes: 'text-amber-700 dark:text-amber-400', label: 'Renamed' },
  changed: { symbol: '~', classes: 'text-amber-700 dark:text-amber-400', label: 'Changed' },
  moved: { symbol: '~', classes: 'text-sky-700 dark:text-sky-400', label: 'Moved' },
};

function nodeLabel(role: string, name: string | null): string {
  return name ? `${role} "${name}"` : role;
}

// The empty copy for the three typed reasons a diff can't be produced.
const emptyState = computed<EvidenceState | null>(() => {
  switch (diff.value?.status) {
    case 'no-failure-snapshot':
      return {
        state: 'not-captured',
        title: 'Page diff',
        description: 'The failing page was not captured for this run — add the capture fixtures.',
        to: '/setup',
        toLabel: 'Open setup',
      };
    case 'no-green-sample':
      return {
        state: 'nothing-happened',
        title: 'Page diff',
        description: 'No green sample yet — a baseline appears after the next passing run of this test.',
      };
    case 'not-applicable':
    case 'not-found':
      return {
        state: 'not-applicable',
        title: 'Page diff',
        description: 'A page diff needs a failing ARIA snapshot to compare — not applicable here.',
      };
    default:
      return null;
  }
});
</script>

<template>
  <SectionCard icon="i-lucide-file-diff" title="Page diff" help="case.page-diff">
    <template v-if="available && diff?.baseline" #subtitle>
      <span
        >{{ baselineLine }}<template v-if="diff.baselineNote"> · {{ diff.baselineNote }}</template></span
      >
    </template>
    <template v-if="available" #actions>
      <UBadge color="neutral" variant="subtle" size="sm" class="font-mono tabular-nums">{{ summaryText }}</UBadge>
    </template>

    <LoadingState v-if="pending" text="Comparing against the last green page…" />

    <template v-else-if="available">
      <!-- No structural change is positive evidence — state it explicitly. -->
      <UAlert
        v-if="hunks.length === 0"
        color="success"
        icon="i-lucide-check-circle"
        variant="subtle"
        description="The page structure is identical to the last passing run — a structural change is unlikely to explain this failure."
      />

      <div v-else class="max-h-96 overflow-y-auto rounded border border-default divide-y divide-default">
        <div
          v-for="(hunk, i) in hunks"
          :key="i"
          class="flex items-start gap-2 px-3 py-2 text-sm"
          :class="hunk.matchesLocator ? 'bg-primary/5' : ''"
        >
          <span
            class="font-mono font-semibold shrink-0 select-none"
            :class="HUNK_META[hunk.type].classes"
            :aria-label="HUNK_META[hunk.type].label"
            >{{ HUNK_META[hunk.type].symbol }}</span
          >
          <div class="min-w-0 flex-1">
            <!-- Path breadcrumb to the node -->
            <p v-if="hunk.path.length" class="text-[11px] text-muted truncate">
              {{ hunk.path.join(' › ') }}
            </p>
            <p class="font-mono break-words">
              <template v-if="hunk.type === 'renamed'">
                {{ hunk.role }} <span class="text-red-700 dark:text-red-400">"{{ hunk.oldName }}"</span>
                <span aria-hidden="true"> → </span>
                <span class="text-green-700 dark:text-green-400">"{{ hunk.name }}"</span>
              </template>
              <template v-else>{{ nodeLabel(hunk.role, hunk.name) }}</template>
              <span v-if="hunk.subtreeSize" class="text-[11px] text-muted"> (+{{ hunk.subtreeSize }} nested)</span>
            </p>
            <!-- Attribute changes for changed / renamed nodes -->
            <p v-if="hunk.attributeChanges?.length" class="mt-0.5 flex flex-wrap gap-1 text-[11px] font-mono">
              <span
                v-for="attr in hunk.attributeChanges"
                :key="attr.key"
                class="rounded bg-elevated px-1.5 py-0.5 text-muted"
              >
                {{ attr.key }}: {{ attr.before === null ? '—' : attr.before === true ? 'on' : attr.before }} →
                {{ attr.after === null ? '—' : attr.after === true ? 'on' : attr.after }}
              </span>
            </p>
            <p v-if="hunk.matchesLocator" class="mt-0.5 text-[11px] font-medium text-primary">
              The failing locator points here
            </p>
          </div>
        </div>
      </div>
    </template>

    <EvidenceEmptyState v-else-if="emptyState" :state="emptyState" doc="/evidence" compact />
  </SectionCard>
</template>
