<script setup lang="ts">
import { describeCluster } from '#shared/describe-cluster';
import type { FailureClusterDetail } from '~~/types/api';
import { renderAnsi } from '~/utils';
import { stripAnsi } from '~/utils/text-format';
import { buildRetryCommand } from '~/utils/retry-command';

const route = useRoute();
const clusterId = parseInt(String(route.params.id));

// Provide shared diagnosis/investigation state (consumed by ClusterInvestigation
// and ClusterDiagnosis). Must run before the top-level await below so provide()
// and lifecycle hooks register against the active setup instance. Keep the store
// so the page can read coverage directly (a component can't inject its own provide).
const clusterDiagnosis = provideClusterDiagnosis(clusterId);

const { data: cluster, refresh } = await useFetch<FailureClusterDetail>(`/api/failure-clusters/${clusterId}`);

useHead(
  computed(() => ({
    title: `${cluster.value ? describeCluster({ ...cluster.value, filePath: cluster.value.affectedTestCases?.[0]?.filePath ?? null }) : 'Failure cluster'} — Piwi Dashboard`,
  })),
);

// Triage
const triageStatus = ref(cluster.value?.status ?? 'open');
const triageNote = ref(cluster.value?.triageNote ?? '');
const triageSaving = ref(false);

watch(
  () => cluster.value?.status,
  (v) => {
    if (v) triageStatus.value = v;
  },
);
watch(
  () => cluster.value?.triageNote,
  (v) => {
    triageNote.value = v ?? '';
  },
);

const triageChanged = computed(
  () =>
    triageStatus.value !== (cluster.value?.status ?? 'open') ||
    triageNote.value.trim() !== (cluster.value?.triageNote ?? ''),
);

async function saveTriage() {
  triageSaving.value = true;
  try {
    await $fetch(`/api/failure-clusters/${clusterId}/status`, {
      method: 'PATCH',
      body: { status: triageStatus.value, triageNote: triageNote.value.trim() || null },
    });
    refresh();
  } finally {
    triageSaving.value = false;
  }
}

// Extract cases modal
const extractModalOpen = ref(false);

function onExtracted() {
  extractModalOpen.value = false;
  refresh();
}

const { copyRich, copied: clusterCopied } = useCopyRich();

function copyCluster() {
  const c = cluster.value;
  if (!c) return;
  const url = window.location.href;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const meta = [
    c.errorType,
    `${c.occurrences} occurrence${c.occurrences === 1 ? '' : 's'}`,
    `${c.affectedTests} test${c.affectedTests === 1 ? '' : 's'} affected`,
    c.status !== 'open' ? c.status : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const aiSummary =
    c.diagnosis?.status === 'completed' && c.diagnosis.summary
      ? `AI diagnosis (${c.diagnosis.category ?? 'unknown'}, ${c.diagnosis.confidence ?? '?'} confidence): ${c.diagnosis.summary}`
      : null;

  const name = describeCluster({ ...c, filePath: c.affectedTestCases?.[0]?.filePath ?? null });
  const plain = [
    `❌ Failure cluster: ${name}`,
    ...(name !== c.signature ? [`Signature: ${c.signature}`] : []),
    meta,
    '',
    ...(c.sampleError ? ['Sample error:', stripAnsi(c.sampleError), ''] : []),
    ...(aiSummary ? [aiSummary, ''] : []),
    `Cluster: ${url}`,
  ].join('\n');

  const html = [
    `<p><strong>❌ Failure cluster</strong>: ${esc(name)}</p>`,
    name !== c.signature ? `<p><code>${esc(c.signature)}</code></p>` : '',
    `<p><em>${esc(meta)}</em></p>`,
    c.sampleError ? `<p><strong>Sample error:</strong></p><pre>${renderAnsi(c.sampleError)}</pre>` : '',
    aiSummary
      ? `<p><strong>AI diagnosis</strong> (${esc(c.diagnosis?.category ?? 'unknown')}, ${esc(c.diagnosis?.confidence ?? '?')} confidence):<br>${esc(c.diagnosis!.summary!)}</p>`
      : '',
    `<p>🔗 <a href="${url}">View failure cluster</a></p>`,
  ].join('');

  copyRich(plain, html, { toast: 'Failure cluster copied' });
}

// Left-column section peeks (shown while the section is folded)
const errorPeek = computed(() => {
  const raw = cluster.value?.sampleError;
  if (!raw) return '';
  return (
    stripAnsi(raw)
      .split('\n')
      .find((l) => l.trim()) ?? ''
  );
});

const { scmStatus } = useScmStatusSummary(clusterDiagnosis.coverage);

// Retry command for the test-evidence header (built from all affected cases).
const affectedRetryCases = computed(() =>
  (cluster.value?.affectedTestCases ?? []).map((tc) => ({
    filePath: tc.filePath,
    title: tc.title,
    line: null,
    projectName: null,
  })),
);
const retryCommand = computed(() => buildRetryCommand(affectedRetryCases.value));
const { copy: copyRetry, copied: retryCopied } = useCopy();

// Reveal-on-citation: a diagnosis evidence citation (right column) can unfold and
// scroll to the matching left-column section. Refs point at the foldable cards.
const errorSection = ref<{ reveal: () => void } | null>(null);
const evidenceSection = ref<{ reveal: () => void } | null>(null);
const scmSection = ref<{ reveal: () => void } | null>(null);
const envDiffSection = ref<{ reveal: () => void } | null>(null);
const visualDiffSection = ref<{ reveal: () => void } | null>(null);
const domSnapshotSection = ref<{ reveal: () => void } | null>(null);

const sectionToCard: Record<string, () => { reveal: () => void } | null> = {
  sampleError: () => errorSection.value,
  executionError: () => errorSection.value,
  environmentDiff: () => envDiffSection.value,
  visualDiff: () => visualDiffSection.value,
  domSnapshot: () => domSnapshotSection.value,
  scmInvestigation: () => scmSection.value,
  selectedCommits: () => scmSection.value,
  topSuspectedCommit: () => scmSection.value,
  failingAction: () => scmSection.value,
  affectedTests: () => evidenceSection.value,
  testSource: () => evidenceSection.value,
  sourceFiles: () => evidenceSection.value,
  steps: () => evidenceSection.value,
  failingSteps: () => evidenceSection.value,
  console: () => evidenceSection.value,
  networkRequests: () => evidenceSection.value,
  serverTraces: () => evidenceSection.value,
  ariaSnapshot: () => evidenceSection.value,
  screenshots: () => evidenceSection.value,
  tracePointers: () => evidenceSection.value,
  artifacts: () => evidenceSection.value,
};

provide(clusterSectionLocatorKey, {
  canLocate: (id: string) => id in sectionToCard,
  open: (id: string) => sectionToCard[id]?.()?.reveal(),
});

// Breadcrumbs
const breadcrumbItems = computed(() => [
  { label: 'Home', icon: 'i-lucide-house', to: '/' },
  { label: 'Projects', to: '/projects' },
  ...(cluster.value?.project
    ? [
        {
          label: cluster.value.project.label || cluster.value.project.name || 'Project',
          to: `/projects/${cluster.value.project.id}?tab=failure-clusters`,
        },
      ]
    : [{ label: 'Project' }]),
  { label: `Failure cluster #${clusterId}` },
]);
</script>

<template>
  <UDashboardPanel id="failure-cluster-detail">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav :items="breadcrumbItems" />
        </template>
        <template #right>
          <ShareLinksModal v-if="cluster" :endpoint="`/api/failure-clusters/${cluster.id}/share-links`" />
          <ExportMenu
            v-if="cluster"
            :endpoint="`/api/failure-clusters/${cluster.id}/export`"
            :base-name="`piwi-cluster-${cluster.id}`"
          />
          <UTooltip v-if="cluster" :text="clusterCopied ? 'Copied!' : 'Copy failure cluster'">
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              :icon="clusterCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
              @click="copyCluster"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Below xl the whole panel scrolls as one document; at xl+ the two columns scroll independently. -->
      <div v-if="cluster" class="flex flex-col h-full min-h-0 max-xl:overflow-y-auto xl:overflow-hidden">
        <!-- Summary -->
        <div class="border-b border-default shrink-0">
          <ClusterSummary
            :cluster="cluster"
            :triage-status="triageStatus"
            :triage-note="triageNote"
            :triage-saving="triageSaving"
            :triage-changed="triageChanged"
            @update:triage-status="triageStatus = $event"
            @update:triage-note="triageNote = $event"
            @save-triage="saveTriage"
          />
        </div>

        <!-- Body: two columns — left is wider (investigation heavy) -->
        <div class="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 p-1 xl:flex-1 xl:min-h-0 xl:overflow-hidden">
          <!-- Left: error + test evidence + SCM investigation. Sections fold to a
               single header with a peek so the whole failure reads at a glance. -->
          <div class="space-y-4 xl:overflow-y-auto">
            <!-- Error message -->
            <CollapsibleSectionCard
              v-if="cluster.sampleError"
              ref="errorSection"
              storage-key="cluster-error"
              icon="i-lucide-circle-x"
              icon-class="text-red-500"
              title="Error message"
            >
              <template #folded>
                <span class="font-mono text-xs">{{ errorPeek }}</span>
              </template>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div
                class="text-xs font-mono overflow-x-auto whitespace-pre-wrap"
                v-html="renderAnsi(cluster.sampleError)"
              />
            </CollapsibleSectionCard>

            <!-- Locator healing: alternative suggestions for the failing locator -->
            <LocatorHealingPanel
              v-if="cluster.affectedTestCases?.length && cluster.affectedTestCases[0]?.recentTestRunsCaseId"
              ref="locatorSection"
              storage-key="cluster-locators"
              :run-id="cluster.lastSeenRunId"
              :test-runs-case-id="cluster.affectedTestCases[0].recentTestRunsCaseId"
              :affected-count="cluster.affectedTestCases.length"
            />

            <!-- Environment drift since the last pass of the representative case -->
            <EnvironmentDiffCard
              v-if="cluster.affectedTestCases?.length && cluster.affectedTestCases[0]?.recentTestRunsCaseId"
              ref="envDiffSection"
              storage-key="cluster-env-diff"
              :run-id="cluster.lastSeenRunId"
              :test-runs-case-id="cluster.affectedTestCases[0].recentTestRunsCaseId"
            />

            <!-- Visual drift: failing screenshot pixel-diffed against the last pass -->
            <VisualDiffCard
              v-if="cluster.affectedTestCases?.length && cluster.affectedTestCases[0]?.recentTestRunsCaseId"
              ref="visualDiffSection"
              storage-key="cluster-visual-diff"
              :run-id="cluster.lastSeenRunId"
              :test-runs-case-id="cluster.affectedTestCases[0].recentTestRunsCaseId"
            />

            <!-- Failure-time HTML extracted from the uploaded trace -->
            <DomSnapshotCard
              v-if="cluster.affectedTestCases?.length && cluster.affectedTestCases[0]?.recentTestRunsCaseId"
              ref="domSnapshotSection"
              storage-key="cluster-dom-snapshot"
              :run-id="cluster.lastSeenRunId"
              :test-runs-case-id="cluster.affectedTestCases[0].recentTestRunsCaseId"
            />

            <!-- Test evidence: source, screenshots, traces, steps, aria, signals -->
            <CollapsibleSectionCard
              v-if="cluster.affectedTestCases?.length"
              ref="evidenceSection"
              storage-key="cluster-evidence"
              icon="i-lucide-flask-conical"
              title="Test evidence"
              help="cluster.evidence"
            >
              <template #folded>
                {{ cluster.affectedTests }} {{ cluster.affectedTests === 1 ? 'test' : 'tests' }} ·
                {{ cluster.occurrences }} occurrence{{ cluster.occurrences === 1 ? '' : 's' }} ·
                <OpenInIdeLink
                  v-if="cluster.affectedTestCases[0]?.filePath"
                  :file-path="cluster.affectedTestCases[0].filePath"
                  :project-key="cluster.project?.id"
                  :project-name="cluster.project?.name"
                  class="text-xs"
                />
              </template>
              <template #actions>
                <UBadge color="neutral" variant="subtle" size="sm">
                  {{ cluster.affectedTestCases.length }}
                  {{ cluster.affectedTestCases.length === 1 ? 'test' : 'tests' }}
                </UBadge>
                <UButton
                  size="xs"
                  variant="outline"
                  color="neutral"
                  :icon="retryCopied ? 'i-lucide-check' : 'i-lucide-play'"
                  :title="retryCopied ? 'Copied!' : copyPreview(retryCommand)"
                  @click="copyRetry(retryCommand, { toast: 'Retry command copied' })"
                >
                  Copy retry command
                </UButton>
                <DesktopRunLocallyButton
                  :project-id="cluster.project?.id"
                  :project-label="cluster.project?.name"
                  :cases="affectedRetryCases"
                  label="Run affected locally"
                  :preset-options="{ mode: 'grep' }"
                />
                <UTooltip text="Unlink incorrectly clustered test cases from this group">
                  <UButton
                    size="xs"
                    color="warning"
                    variant="outline"
                    icon="i-lucide-arrow-up-from-line"
                    @click="extractModalOpen = true"
                  >
                    Extract
                  </UButton>
                </UTooltip>
              </template>
              <ClusterTestEvidence
                :affected-test-cases="cluster.affectedTestCases"
                :project-key="cluster.project?.id"
                :project-name="cluster.project?.name"
              />
            </CollapsibleSectionCard>

            <!-- SCM investigation: baseline picker + commit diff -->
            <CollapsibleSectionCard
              ref="scmSection"
              storage-key="cluster-scm"
              icon="i-lucide-git-compare-arrows"
              title="What changed"
              help="cluster.scm"
            >
              <template #folded>
                <span class="inline-flex items-center gap-1.5">
                  <UIcon :name="scmStatus.icon" class="size-3.5 shrink-0" :class="scmStatus.color" />
                  <span :class="scmStatus.color">{{ scmStatus.text }}</span>
                </span>
              </template>
              <ClusterInvestigation />
            </CollapsibleSectionCard>
          </div>

          <!-- Right: diagnosis -->
          <div class="xl:overflow-y-auto">
            <DiagnosisPanel
              :cluster-id="clusterId"
              :last-seen-run-id="cluster?.lastSeenRunId"
              :affected-test-cases="cluster?.affectedTestCases ?? []"
            />
          </div>
        </div>
      </div>

      <div v-else class="flex items-center justify-center h-64 text-gray-500">Cluster not found.</div>
    </template>
  </UDashboardPanel>

  <ClusterExtractCasesModal
    v-if="cluster"
    :open="extractModalOpen"
    :cluster-id="clusterId"
    :affected-test-cases="cluster.affectedTestCases ?? []"
    :project-key="cluster.project?.id"
    :project-name="cluster.project?.name"
    @update:open="extractModalOpen = $event"
    @extracted="onExtracted"
  />
</template>
