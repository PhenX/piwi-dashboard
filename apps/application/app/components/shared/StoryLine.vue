<script setup lang="ts">
/**
 * "Most likely" — the one explanation of a failure on the first screen. It leads
 * with the story sentence (the chained clues), or the top clue alone when no
 * combination matched, or the cluster's diagnosis summary when one completed. A
 * strength (or confidence) chip grades it, a count says how many clues agree, and
 * a `more ▸` disclosure reveals every clue with its citations. The word "clue"
 * appears only inside that disclosure.
 */
import type { FailureClue, FailureClueStrength, FailureStory } from '#shared/failure-clues';
import { DIAGNOSIS_SECTION_SHORT } from '#shared/diagnosis-sections';
import { useClusterSectionLocator } from '~/composables/useClusterSectionLocator';

const props = defineProps<{
  story: FailureStory | null;
  clues: FailureClue[];
  /** The moment of failure in ms relative to the timeline origin — anchors `t-N s`. */
  failureAt?: number | null;
  /** When the cluster has a completed diagnosis, it leads the line. */
  diagnosis?: { summary: string; confidence?: string | null } | null;
}>();

const locator = useClusterSectionLocator();

const STRENGTH: Record<FailureClueStrength, { label: string; color: 'error' | 'warning' | 'neutral' }> = {
  strong: { label: 'Strong', color: 'error' },
  medium: { label: 'Medium', color: 'warning' },
  weak: { label: 'Weak', color: 'neutral' },
};

const confidenceColor = (c?: string | null): 'success' | 'warning' | 'neutral' =>
  c === 'high' ? 'success' : c === 'medium' ? 'warning' : 'neutral';

const topClue = computed(() => props.clues[0] ?? null);

// The sentence: the diagnosis leads when it completed, else the story, else the
// top clue in its own words.
const sentence = computed(() => {
  if (props.diagnosis) return props.diagnosis.summary;
  if (props.story) return props.story.sentence;
  const c = topClue.value;
  return c ? `${c.title} — ${c.detail}` : '';
});

// The chip that grades the explanation.
const chip = computed<{ label: string; color: 'error' | 'warning' | 'neutral' | 'success' } | null>(() => {
  if (props.diagnosis) {
    const c = props.diagnosis.confidence;
    return { label: c ? `Diagnosed · ${c} confidence` : 'Diagnosed', color: confidenceColor(c) };
  }
  const strength = props.story?.strength ?? topClue.value?.strength ?? null;
  return strength ? STRENGTH[strength] : null;
});

// How many clues agree with the explanation.
const agreeCount = computed(() => {
  if (props.story) return props.story.clueIds.length;
  return props.clues.length;
});
const agreeLabel = computed(() => {
  const n = agreeCount.value;
  if (n <= 0) return null;
  if (props.diagnosis) return `supported by ${n} clue${n === 1 ? '' : 's'}`;
  return `${n} clue${n === 1 ? '' : 's'} agree${n === 1 ? 's' : ''}`;
});

// The top clue's citations show inline only when the line is a bare top clue (no
// story, no diagnosis) — otherwise every clue's citations live in the disclosure.
const inlineCitations = computed(() =>
  !props.diagnosis && !props.story && topClue.value ? topClue.value.citations : [],
);

const open = ref(false);
const hasDisclosure = computed(() => props.clues.length > 0);

function citationLabel(section: string): string {
  return DIAGNOSIS_SECTION_SHORT[section] ?? section;
}
</script>

<template>
  <div v-if="sentence" class="text-sm space-y-1.5">
    <p class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span class="shrink-0 font-medium text-muted">Most likely:</span>
      <span class="min-w-0 text-toned">{{ sentence }}</span>
    </p>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <UBadge v-if="chip" :color="chip.color" variant="subtle" size="sm">{{ chip.label }}</UBadge>
      <span v-if="agreeLabel" class="text-xs text-muted">{{ agreeLabel }}</span>

      <!-- inline citations, only for a bare top clue -->
      <template v-for="(cite, i) in inlineCitations" :key="`inline-${i}`">
        <UButton
          v-if="locator.canLocate(cite.section)"
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-lucide-arrow-down-to-line"
          :label="citationLabel(cite.section)"
          :title="`Show the ${citationLabel(cite.section)} evidence`"
          @click="locator.open(cite.section)"
        />
        <UBadge v-else size="sm" variant="soft" color="neutral">{{ citationLabel(cite.section) }}</UBadge>
      </template>

      <UButton
        v-if="hasDisclosure"
        size="xs"
        variant="link"
        color="neutral"
        class="px-0"
        :trailing-icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        :aria-expanded="open"
        @click="open = !open"
      >
        {{ open ? 'less' : 'more' }}
      </UButton>
    </div>

    <CluesCard v-if="open && hasDisclosure" :clues="clues" :failure-at="failureAt" title="All clues" />
  </div>
</template>
