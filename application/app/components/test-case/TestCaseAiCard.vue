<script setup lang="ts">
/**
 * Execution-scoped AI diagnosis for a single failing test-run case. When a provider
 * is set up it offers "Diagnose with AI", which runs a diagnosis scoped to just this
 * execution and renders it inline; a stored diagnosis is restored on load so it
 * survives a refresh. The evidence bundle itself is copied from the page's Export
 * menu, which works with no provider configured.
 */
import type { FailureDiagnosis } from '~~/server/database/schema';
import type { DiagnosisContextCoverage } from '~~/types/api';
import type { ContextSection } from '~/composables/useClusterDiagnosis';
import { extractCitedSectionIds } from '#shared/diagnosis-sections';
import { errorMessage } from '~/utils';

const props = defineProps<{
  testRunsCaseId: number;
}>();

const { aiStatus } = useAiStatus();
const toast = useToast();

const diagnosis = ref<FailureDiagnosis | null>(null);
const posting = ref(false);

const contextText = ref<string | null>(null);
const contextSections = ref<ContextSection[]>([]);
const tokenEstimate = ref(0);
const imageTokenEstimate = ref(0);
const coverage = ref<DiagnosisContextCoverage | null>(null);
const contextLoading = ref(false);

const showAiContext = ref(false);
const focusSection = ref<string | null>(null);
const showAdditionalContext = ref(false);
const additionalContext = ref('');

interface ContextJsonResponse {
  text: string;
  sections: ContextSection[];
  tokenEstimate: number;
  imageTokenEstimate?: number;
  coverage: DiagnosisContextCoverage;
}

async function refreshContext() {
  contextLoading.value = true;
  try {
    const res = await $fetch<ContextJsonResponse>(`/api/test-run-cases/${props.testRunsCaseId}/diagnosis-context`, {
      query: { format: 'json' },
    });
    contextText.value = res.text;
    contextSections.value = res.sections;
    tokenEstimate.value = res.tokenEstimate;
    imageTokenEstimate.value = res.imageTokenEstimate ?? 0;
    coverage.value = res.coverage;
  } catch {
    contextText.value = null;
    contextSections.value = [];
    tokenEstimate.value = 0;
    coverage.value = null;
  } finally {
    contextLoading.value = false;
  }
}

async function fetchStoredDiagnosis() {
  try {
    const res = await $fetch<{ diagnosis: FailureDiagnosis | null }>(
      `/api/test-run-cases/${props.testRunsCaseId}/diagnosis`,
    );
    diagnosis.value = res.diagnosis;
  } catch {
    /* ignore — nothing stored */
  }
}

onMounted(() => {
  fetchStoredDiagnosis();
  refreshContext();
});

/** Section ids the diagnosis actually cited — highlighted in the context modal. */
const citedSections = computed<string[]>(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const det = diagnosis.value?.details as any;
  if (!det) return [];
  const texts: string[] = [];
  if (Array.isArray(det.evidence)) texts.push(...det.evidence);
  if (Array.isArray(det.hypotheses)) {
    for (const h of det.hypotheses) if (Array.isArray(h?.evidence)) texts.push(...h.evidence);
  }
  return extractCitedSectionIds(texts);
});

function onViewSection(sectionId: string) {
  focusSection.value = sectionId;
  showAiContext.value = true;
}

function onPrefillContext(text: string) {
  additionalContext.value = additionalContext.value ? `${additionalContext.value}\n\n${text}` : text;
  showAdditionalContext.value = true;
}

async function diagnose(force = false) {
  posting.value = true;
  try {
    const url = force
      ? `/api/test-run-cases/${props.testRunsCaseId}/diagnose?force=true`
      : `/api/test-run-cases/${props.testRunsCaseId}/diagnose`;
    const body = additionalContext.value.trim() ? { additionalContext: additionalContext.value.trim() } : undefined;
    diagnosis.value = await $fetch<FailureDiagnosis>(url, { method: 'POST', body });
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 409) {
      toast.add({ title: 'Diagnosis already running', color: 'warning' });
      fetchStoredDiagnosis();
    } else if (status === 503) {
      toast.add({ title: 'AI diagnosis is not configured', color: 'warning' });
    } else {
      toast.add({ title: 'Diagnosis failed', description: errorMessage(err), color: 'error' });
    }
  } finally {
    posting.value = false;
  }
}

/** A 'running' row older than 5 min is a crashed/abandoned diagnosis — offer a restart. */
function isStale(d: FailureDiagnosis) {
  return d.status === 'running' && Date.now() - new Date(d.updatedAt).getTime() > 5 * 60 * 1000;
}

const showResult = computed(
  () => diagnosis.value && (diagnosis.value.status === 'completed' || diagnosis.value.status === 'failed'),
);
const showDiagnoseButton = computed(
  () =>
    !diagnosis.value ||
    diagnosis.value.status === 'failed' ||
    (diagnosis.value.status === 'running' && isStale(diagnosis.value)),
);
/** A fresh 'running' row: a diagnosis is genuinely in flight (this or another session). */
const showRunning = computed(
  () => diagnosis.value?.status === 'running' && !isStale(diagnosis.value) && !posting.value,
);
</script>

<template>
  <SectionCard icon="i-lucide-sparkles" icon-class="text-primary" title="AI diagnosis" help="case.ai">
    <div class="space-y-3">
      <p class="text-xs text-gray-400 inline-flex items-center gap-1">
        <UIcon name="i-lucide-triangle-alert" class="size-3 shrink-0" />
        AI-generated — verify before applying.
      </p>

      <!-- Coverage preview: what evidence would be sent -->
      <DiagnosisCoverageStrip
        v-if="aiStatus?.configured"
        :sections="contextSections"
        :not-applicable="coverage?.notApplicable"
        :token-estimate="tokenEstimate"
        :loading="contextLoading"
        @view-section="onViewSection"
        @open="showAiContext = true"
      />

      <template v-if="aiStatus?.configured">
        <!-- Additional context (collapsed by default) -->
        <div>
          <button
            class="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            @click="showAdditionalContext = !showAdditionalContext"
          >
            <UIcon
              :name="showAdditionalContext ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-3.5"
            />
            Additional context
            <span v-if="additionalContext.trim()" class="text-primary">(1)</span>
          </button>
          <UTextarea
            v-if="showAdditionalContext"
            v-model="additionalContext"
            placeholder="e.g. We deployed a new auth middleware yesterday…"
            :rows="3"
            class="w-full text-sm mt-1"
          />
        </div>

        <!-- A diagnosis is genuinely in flight (this or another session) -->
        <div
          v-if="showRunning"
          class="flex items-center justify-between gap-2 rounded-lg border border-default bg-elevated/40 p-2.5"
        >
          <span class="inline-flex items-center gap-2 text-sm text-gray-500">
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-primary shrink-0" />
            Diagnosis in progress…
          </span>
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="posting"
            @click="fetchStoredDiagnosis"
          >
            Refresh
          </UButton>
        </div>

        <!-- Diagnose / Re-diagnose (a stale 'running' row is treated as restartable) -->
        <div v-else class="flex items-center gap-2">
          <UButton
            v-if="showDiagnoseButton"
            icon="i-lucide-sparkles"
            size="sm"
            color="primary"
            variant="solid"
            :loading="posting"
            @click="diagnose(diagnosis?.status === 'running')"
          >
            {{ diagnosis?.status === 'running' ? 'Restart diagnosis' : 'Diagnose with AI' }}
          </UButton>
          <UButton
            v-else-if="diagnosis?.status === 'completed'"
            icon="i-lucide-refresh-cw"
            size="xs"
            color="primary"
            variant="soft"
            :loading="posting"
            @click="diagnose(true)"
          >
            Re-diagnose
          </UButton>
        </div>

        <!-- Result -->
        <DiagnosisResult
          v-if="showResult"
          :diagnosis="diagnosis"
          @view-section="onViewSection"
          @prefill-context="onPrefillContext"
        />
      </template>

      <!-- AI not configured -->
      <template v-else>
        <div class="rounded-lg border border-dashed border-default p-4 text-center text-gray-400">
          <p class="text-sm inline-flex items-center gap-1 justify-center">
            AI diagnosis is not configured <HelpHint topic="cluster.ai-setup" />
          </p>
          <p class="text-xs mt-2 max-w-xs mx-auto">
            Use <strong>Export → AI context</strong> in the header to grab the full evidence bundle for your own AI
            tool, or configure a provider.
          </p>
          <UButton to="/settings/ai" size="xs" color="neutral" variant="outline" class="mt-3">
            Configure in Settings
          </UButton>
        </div>
      </template>

      <!-- Context modal -->
      <DiagnosisContextModal
        :open="showAiContext"
        :sections="contextSections"
        :token-estimate="tokenEstimate"
        :image-token-estimate="imageTokenEstimate"
        :loading="contextLoading"
        :focus-section="focusSection"
        :cited-sections="citedSections"
        :not-applicable-sections="coverage?.notApplicable"
        @update:open="
          showAiContext = $event;
          if (!$event) focusSection = null;
        "
        @refresh="refreshContext"
      />

      <!-- MCP hand-off -->
      <div class="pt-1 text-center">
        <NuxtLink
          to="/mcp"
          class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-primary transition-colors"
        >
          <UIcon name="i-lucide-bot" class="size-3" />
          Query this failure from your AI agent via MCP
        </NuxtLink>
      </div>
    </div>
  </SectionCard>
</template>
