<script setup lang="ts">
/**
 * Ranked alternative locators for a failing locator. Fetches healing data for a
 * test-run case and renders the ranked list, top recommendation, and source
 * note. Used on both the cluster detail page and the test-case detail page.
 */

import { recommendLocatorFix } from '#shared/locator-healing';
import type { RankedLocator, LocatorFixRecommendation, LocatorHealingResult } from '#shared/locator-healing.types';
import type { TraceInfo } from '~~/types/api';
import SectionCard from './SectionCard.vue';
import CollapsibleSectionCard from './CollapsibleSectionCard.vue';
import SnapshotLocatorPicker from './SnapshotLocatorPicker.vue';

const props = defineProps<{
  runId: number;
  testRunsCaseId: number;
  /** When set, the panel folds to a header with a peek (persisted per user). */
  storageKey?: string;
  /**
   * Number of tests this failure affects (cluster context). When > 1, the panel
   * notes that one fix covers them all — a cluster is one masked-locator root
   * cause, so the recommended locator applies across the group.
   */
  affectedCount?: number;
}>();

// Fold on the cluster page (storageKey set); stay a plain card on the test-case page.
const cardComponent = computed(() => (props.storageKey ? CollapsibleSectionCard : SectionCard));
const cardBind = computed(() => (props.storageKey ? { storageKey: props.storageKey } : {}));

const {
  data: healing,
  pending,
  error,
} = useFetch<LocatorHealingResult>(
  () => `/api/test-runs/${props.runId}/cases/${props.testRunsCaseId}/locator-healing`,
  { lazy: true },
);

const hasData = computed(
  () =>
    !!healing.value &&
    healing.value.source !== 'none' &&
    !!(
      healing.value.fromElementMatch?.length ||
      healing.value.fromPriorSuccess?.length ||
      healing.value.fromAriaSnapshot?.length
    ),
);

const alternatives = computed<RankedLocator[]>(() => {
  if (!healing.value) return [];
  return healing.value.fromElementMatch ?? healing.value.fromPriorSuccess ?? healing.value.fromAriaSnapshot ?? [];
});

// A locator a human confirmed with the failure-time picker — surfaced as a
// prominent callout at the top so it never hides in the ranked list.
const userPick = computed<RankedLocator | null>(() => alternatives.value.find((a) => a.pickedByUser) ?? null);

// The single recommended fix — convention-preserving where possible. Computed
// server-side; fall back to the shared picker for payloads that lack it —
// EXCEPT when the server deliberately withheld it because every stored
// alternative looks stale (recomputing here would resurrect a broken pick).
const recommendation = computed<LocatorFixRecommendation | null>(() => {
  if (healing.value?.recommendation) return healing.value.recommendation;
  if (healing.value?.priorNameMayBeStale) return null;
  if (!alternatives.value.length) return null;
  return recommendLocatorFix(healing.value?.failingLocator?.method, alternatives.value);
});

// Failing-page candidates shown alongside a stale stored list — the server
// populates fromAriaSnapshot next to fromPriorSuccess only in that case.
const supplement = computed<RankedLocator[]>(() =>
  healing.value?.priorNameMayBeStale && healing.value.fromPriorSuccess?.length
    ? (healing.value.fromAriaSnapshot ?? [])
    : [],
);

const recommendationNote = computed(() => {
  const r = recommendation.value;
  if (!r?.recommended) return '';
  if (r.recommended.pickedByUser) return 'Confirmed with the locator picker on the failing page';
  if (r.preservesConvention) return 'Keeps your original locator style — minimal, idiomatic edit';
  if (r.suggestAddTestId) return 'Most stable available, but still fragile';
  return 'Most stable available — a sturdier style than the original';
});

const sourceNote = computed(() => {
  const stale = healing.value?.priorNameMayBeStale;
  const note = (() => {
    switch (healing.value?.source) {
      case 'prior-run':
        return stale
          ? 'Pre-captured from the last passing run — the element looks changed since'
          : 'Pre-captured from the last passing run — highest confidence';
      case 'element-match':
        return 'The element looks renamed or moved — these are fresh locators for its current identity on the failing page';
      case 'fingerprint':
        return 'Matched by locator signature (line numbers shifted)';
      case 'cross-test':
        return 'Captured by another test in this project that uses the same locator';
      case 'aria-snapshot':
        return 'Generated from the failure-time ARIA snapshot — limited, no HTML attributes';
      default:
        return '';
    }
  })();
  // Stored snapshots age — surface when the data was last captured.
  const captured = healing.value?.capturedAt;
  return captured ? `${note} · captured ${formatRelativeTime(captured)}` : note;
});

// Subtitle color: green for pre-captured (high confidence), primary for a
// fresh current-page match, amber for the limited ARIA-only fallback — and for
// a stored list whose element looks changed since capture.
const sourceClass = computed(() => {
  if (healing.value?.priorNameMayBeStale) return 'text-warning-600 dark:text-warning-400';
  switch (healing.value?.source) {
    case 'prior-run':
    case 'fingerprint':
    case 'cross-test':
      return 'text-success-600 dark:text-success-400';
    case 'element-match':
      return 'text-primary-600 dark:text-primary-400';
    default:
      return 'text-warning-600 dark:text-warning-400';
  }
});

const failingLocatorText = computed(() => {
  const f = healing.value?.failingLocator;
  return f ? `${f.method}(${JSON.stringify(f.args)})` : '';
});

// The execution's failure trace, when one was uploaded — its recorded page
// snapshots power the trace viewer's own "Pick locator" tool, so a locator
// can be picked visually even for CI failures nobody watched live.
const config = useRuntimeConfig();
const { data: traces } = useFetch<TraceInfo[]>(() => `/api/test-run-cases/${props.testRunsCaseId}/traces`, {
  lazy: true,
});
const pickTraceUrl = computed(() => {
  const trace = traces.value?.[0];
  if (!trace) return null;
  // Demo mode serves its committed sample trace as a static asset (the
  // viewer's service worker bypasses the demo API SW).
  const isDemoStaticAsset = !!config.public.demoMode && trace.filePath.startsWith('demo/');
  return getTraceViewerUrl(trace.filePath, config.app?.baseURL, isDemoStaticAsset);
});

// Interactive DOM snapshot picker
const pickerOpen = ref(false);

async function refreshHealing() {
  await refreshNuxtData(`/api/test-runs/${props.runId}/cases/${props.testRunsCaseId}/locator-healing`);
}

const { copy } = useCopy();
// Track which row was last copied so only that button shows the check icon —
// useCopy's `copied` is a single shared ref and would flip every button at once.
const copiedKey = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
function copyText(text: string, key: string, toast: string) {
  copy(text, { toast });
  copiedKey.value = key;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedKey.value = null;
  }, 2000);
}
function copyLocator(text: string, key: string) {
  copyText(text, key, 'Locator copied');
}
onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});

// ── Suggested edit: rewrite the failing test line with the recommended fix ───

const recommended = computed(() => recommendation.value?.recommended ?? null);

// One recommendation heals every test in the cluster (same masked-locator root
// cause) — surface the leverage when the panel is shown in cluster context.
const appliesToNote = computed(() =>
  props.affectedCount && props.affectedCount > 1 && recommended.value
    ? `Same break affects ${props.affectedCount} tests in this cluster — one fix`
    : '',
);

// Plain-words provenance for the recommendation, echoed in the hero block so it
// reads even when the source subtitle is folded away (cluster page).
const recommendationSourceLabel = computed(() => {
  if (recommended.value?.pickedByUser) return 'your confirmed pick';
  switch (healing.value?.source) {
    case 'prior-run':
      return 'from the last passing run';
    case 'fingerprint':
      return 'from a prior run (line shifted)';
    case 'cross-test':
      return 'from another test in this project';
    case 'element-match':
      return 'from the current failing page';
    case 'aria-snapshot':
      return 'from the ARIA snapshot';
    default:
      return '';
  }
});

// The one-line diff (old source line → line with the failing call rewritten),
// when the captured source line and a confident replacement are both available.
const suggestedEdit = computed(() => {
  const line = healing.value?.sourceLine;
  const rec = recommended.value;
  if (!line || !rec) return null;
  const edit = buildLocatorEdit(line.text, healing.value?.failingLocator?.method, rec.locator);
  return edit ? { edit, patch: locatorEditPatch(edit, healing.value?.location ?? null) } : null;
});

// Fallback when there's no source line to rewrite but the recommendation keeps
// the method family — show just the changed args (name 'Old' → 'New').
const argChanges = computed(() => {
  if (suggestedEdit.value) return [];
  const f = healing.value?.failingLocator;
  const rec = recommended.value;
  if (!f || !rec || rec.method !== f.method) return [];
  return diffLocatorArgs(f.args, rec.args);
});

function copyFixPrompt() {
  const rec = recommended.value;
  if (!rec || !healing.value) return;
  copyText(
    buildLocatorFixPrompt({
      location: healing.value.location ?? null,
      sourceLine: healing.value.sourceLine ?? null,
      failing: failingLocatorText.value,
      recommended: rec.locator,
    }),
    'fix-prompt',
    'Fix prompt copied',
  );
}

// ── Collapse the long tail of alternatives ───────────────────────────────────
const ALT_PREVIEW = 3;
const showAllAlternatives = ref(false);
const visibleAlternatives = computed<RankedLocator[]>(() =>
  showAllAlternatives.value ? alternatives.value : alternatives.value.slice(0, ALT_PREVIEW),
);
</script>

<template>
  <component
    :is="cardComponent"
    v-if="!pending && !error && hasData"
    v-bind="cardBind"
    icon="i-lucide-bandage"
    title="Alternative locators"
    :count="alternatives.length"
    help="locator-healing"
  >
    <template v-if="storageKey" #folded>
      <code v-if="recommendation?.recommended" class="text-xs font-mono">
        {{ recommendation.recommended.locator }}
      </code>
      <span v-else>{{ alternatives.length }} alternative{{ alternatives.length === 1 ? '' : 's' }}</span>
    </template>
    <template #subtitle>
      <span :class="sourceClass">
        {{ sourceNote }}
      </span>
    </template>
    <template v-if="pickTraceUrl || healing?.failingLocator" #actions>
      <div class="flex items-center gap-1">
        <UButton
          v-if="healing?.failingLocator"
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-mouse-pointer"
          title="Open the failure-time DOM snapshot and click the element to pick a locator"
          @click="pickerOpen = true"
        >
          Pick from snapshot
        </UButton>
        <UButton
          v-if="pickTraceUrl"
          :to="pickTraceUrl"
          target="_blank"
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-crosshair"
          title="Open the failure trace in the trace viewer — its Pick locator tool works on the recorded page snapshots"
        >
          Pick from trace
        </UButton>
      </div>
    </template>

    <!-- Closed loop: the recommended locator now passes at this call site -->
    <UAlert
      v-if="healing?.healedInRunId"
      class="mb-3"
      color="success"
      icon="i-lucide-circle-check"
      variant="subtle"
      title="Locator healed"
    >
      <template #description>
        The recommended locator now passes at this call site &mdash;
        <NuxtLink :to="`/test-runs/${healing.healedInRunId}`" class="underline font-medium">
          see run #{{ healing.healedInRunId }}</NuxtLink
        >.
      </template>
    </UAlert>

    <!-- Human-confirmed pick — prominent callout at the very top -->
    <div v-if="userPick" class="rounded-lg border border-primary/50 bg-primary/10 p-3 mb-3 flex items-center gap-3">
      <UIcon name="i-lucide-user-check" class="size-5 text-primary shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-xs font-medium text-primary flex items-center gap-1.5">
          Your pick
          <UBadge size="sm" color="primary" variant="subtle">confirmed on the failing page</UBadge>
        </p>
        <code class="text-sm font-mono block truncate mt-0.5">{{ userPick.locator }}</code>
      </div>
      <UButton
        size="sm"
        color="primary"
        variant="solid"
        :trailing-icon="copiedKey === 'user-pick' ? 'i-lucide-check' : 'i-lucide-copy'"
        @click="copyLocator(userPick.locator, 'user-pick')"
      >
        Copy
      </UButton>
    </div>

    <!-- Failing locator -->
    <div
      v-if="healing?.failingLocator"
      class="flex items-center gap-2 bg-elevated rounded p-2 mb-3 border border-red-200 dark:border-red-800"
    >
      <UIcon name="i-lucide-x-circle" class="size-4 text-red-500 shrink-0" />
      <code class="text-xs font-mono text-red-600 dark:text-red-400 flex-1 truncate">{{ failingLocatorText }}</code>
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        :icon="copiedKey === 'failing' ? 'i-lucide-check' : 'i-lucide-copy'"
        :title="copiedKey === 'failing' ? 'Copied!' : 'Copy'"
        @click="copyLocator(failingLocatorText, 'failing')"
      />
    </div>

    <!-- The stored accessible name is gone from the failing page — name-based
         alternatives below probably broke together with the failing locator -->
    <UAlert
      v-if="healing?.priorNameMayBeStale"
      class="mb-3"
      color="warning"
      icon="i-lucide-alert-triangle"
      variant="subtle"
      title="The element's name looks changed"
      description="The captured accessible name no longer appears on the failing page, so name-based alternatives (and the failing locator itself) probably no longer match. Prefer the structural options, or the failing-page candidates below."
    />

    <!-- Recommended fix — the hero action, above the full menu. Keeps the
         original locator style where it's stable enough, and offers the exact
         one-line edit for the failing test. -->
    <div v-if="recommended" class="rounded-lg border border-primary/40 bg-primary/5 p-3 mb-3 space-y-2">
      <div class="flex items-center gap-2 min-w-0">
        <UIcon name="i-lucide-star" class="size-4 text-primary shrink-0" />
        <p class="text-xs font-medium text-primary shrink-0">Recommended fix</p>
        <span v-if="recommendationSourceLabel" class="text-[11px] text-gray-500 truncate min-w-0">
          · {{ recommendationSourceLabel }}
        </span>
        <span class="flex-1" />
        <UBadge size="xs" color="primary" variant="subtle" class="font-mono tabular-nums shrink-0">
          {{ recommended.score }}
        </UBadge>
      </div>

      <!-- Ready-to-apply one-line edit, when the failing source line is known -->
      <div v-if="suggestedEdit" class="rounded border border-default overflow-hidden bg-default">
        <DiffPatch :patch="suggestedEdit.patch" />
      </div>
      <template v-else>
        <code class="text-sm font-mono block truncate">{{ recommended.locator }}</code>
        <!-- Only the changed args, when the fix keeps the method family -->
        <p v-if="argChanges.length" class="text-xs flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <template v-for="(c, i) in argChanges" :key="i">
            <span class="font-mono text-gray-500">{{ c.key }}:</span>
            <span v-if="c.from" class="font-mono text-red-500 line-through">{{ c.from }}</span>
            <span v-else class="text-gray-400">—</span>
            <UIcon name="i-lucide-arrow-right" class="size-3 text-gray-400" />
            <span v-if="c.to" class="font-mono text-green-600 dark:text-green-400">{{ c.to }}</span>
            <span v-else class="text-gray-400">removed</span>
          </template>
        </p>
      </template>

      <p v-if="recommendationNote" class="text-xs text-gray-500">{{ recommendationNote }}</p>
      <p v-if="appliesToNote" class="text-xs text-primary/90 flex items-center gap-1">
        <UIcon name="i-lucide-layers" class="size-3 shrink-0" />{{ appliesToNote }}
      </p>

      <div class="flex items-center gap-2">
        <UButton
          size="xs"
          color="primary"
          variant="solid"
          :trailing-icon="copiedKey === 'top' ? 'i-lucide-check' : 'i-lucide-copy'"
          @click="copyLocator(recommended.locator, 'top')"
        >
          Copy locator
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          :icon="copiedKey === 'fix-prompt' ? 'i-lucide-check' : 'i-lucide-sparkles'"
          title="Copy an instruction an AI coding agent can apply directly to the test"
          @click="copyFixPrompt"
        >
          Copy fix prompt
        </UButton>
      </div>
    </div>

    <!-- Sturdier option — surfaced when the recommended fix keeps the original (less stable) style -->
    <div
      v-if="recommendation?.hasDurableAlternative && recommendation.durable"
      class="rounded-lg border border-default bg-elevated p-3 mb-3 flex items-center gap-3"
    >
      <UIcon name="i-lucide-shield-check" class="size-5 text-success shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-xs font-medium text-success-600 dark:text-success-400">
          Most stable option (score: {{ recommendation.durable.score }})
        </p>
        <code class="text-sm font-mono block truncate mt-0.5">{{ recommendation.durable.locator }}</code>
        <p class="text-xs text-gray-500 mt-0.5">Sturdier, but changes the locator style</p>
      </div>
      <UButton
        size="sm"
        color="neutral"
        variant="outline"
        :trailing-icon="copiedKey === 'durable' ? 'i-lucide-check' : 'i-lucide-copy'"
        @click="copyLocator(recommendation.durable.locator, 'durable')"
      >
        Copy
      </UButton>
    </div>

    <!-- Ranked alternatives — the full menu, collapsed to the top few -->
    <div class="space-y-2">
      <p class="text-xs font-medium text-gray-500">All alternatives</p>
      <LocatorAlternativeRow
        v-for="(alt, i) in visibleAlternatives"
        :key="i"
        :alt="alt"
        :copied="copiedKey === `alt-${i}`"
        @copy="copyLocator(alt.locator, `alt-${i}`)"
      />
      <UButton
        v-if="alternatives.length > ALT_PREVIEW"
        size="xs"
        variant="ghost"
        color="neutral"
        block
        :icon="showAllAlternatives ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="showAllAlternatives = !showAllAlternatives"
      >
        {{ showAllAlternatives ? 'Show fewer' : `Show all ${alternatives.length} alternatives` }}
      </UButton>
    </div>

    <!-- Failing-page candidates (stale stored list only) -->
    <div v-if="supplement.length" class="mt-3">
      <p class="text-xs font-medium text-gray-500 mb-2">From the failing page</p>
      <div class="space-y-2">
        <LocatorAlternativeRow
          v-for="(alt, i) in supplement"
          :key="i"
          :alt="alt"
          note="candidate from the failure-time ARIA snapshot"
          :copied="copiedKey === `supp-${i}`"
          @copy="copyLocator(alt.locator, `supp-${i}`)"
        />
      </div>
    </div>

    <!-- Nothing stable enough — recommend adding a data-testid to the app -->
    <UAlert
      v-if="recommendation?.suggestAddTestId"
      class="mt-3"
      color="warning"
      icon="i-lucide-info"
      variant="subtle"
      title="All alternatives are fragile"
      description="Every captured locator scores below 50. Add a stable data-testid attribute to this element in the app for a durable fix."
    />

    <!-- ARIA-snapshot fallback hint -->
    <UAlert v-if="healing?.source === 'aria-snapshot'" class="mt-3" color="info" icon="i-lucide-info" variant="subtle">
      <template #description>
        No HTML attributes were available.
        <DocLink to="capture-fixtures" no-icon class="text-primary hover:underline"
          >Enable Piwi fixture capture</DocLink
        >
        for full alternatives including data-testid and CSS selectors.
      </template>
    </UAlert>
  </component>

  <!-- No data -->
  <component
    :is="cardComponent"
    v-else-if="!pending && !error && !hasData"
    v-bind="cardBind"
    icon="i-lucide-bandage"
    title="Alternative locators"
    subtitle="No alternatives available"
    help="locator-healing"
  >
    <template v-if="storageKey" #folded>
      <span>No alternatives available</span>
    </template>
    <template v-if="pickTraceUrl || healing?.failingLocator" #actions>
      <div class="flex items-center gap-1">
        <UButton
          v-if="healing?.failingLocator"
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-mouse-pointer"
          title="Open the failure-time DOM snapshot and click the element to pick a locator"
          @click="pickerOpen = true"
        >
          Pick from snapshot
        </UButton>
        <UButton
          v-if="pickTraceUrl"
          :to="pickTraceUrl"
          target="_blank"
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-crosshair"
          title="Open the failure trace in the trace viewer — its Pick locator tool works on the recorded page snapshots"
        >
          Pick from trace
        </UButton>
      </div>
    </template>
    <UAlert color="neutral" icon="i-lucide-info" variant="subtle">
      <template #description>
        No pre-captured alternatives — this locator has never passed in a previous run.
        <DocLink to="capture-fixtures" no-icon class="text-primary hover:underline"
          >Enable Piwi dashboard fixtures</DocLink
        >
        to capture element attributes at test time, or use “Pick from snapshot” above to choose a locator by hand on the
        failure-time page.
      </template>
    </UAlert>
  </component>

  <!-- Interactive DOM snapshot picker modal -->
  <SnapshotLocatorPicker
    v-if="healing?.failingLocator"
    v-model:open="pickerOpen"
    :run-id="runId"
    :test-runs-case-id="testRunsCaseId"
    :failing-locator="healing.failingLocator"
    :healing="healing"
    @confirmed="refreshHealing"
    @close="pickerOpen = false"
  />
</template>
