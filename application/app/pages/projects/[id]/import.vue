<script setup lang="ts">
/**
 * Import historical Playwright blob reports into this project, one archive per
 * request. Everything that can be decided without spending an upload — the size
 * limit, archives the project already has — is decided before any bytes move.
 */
import type { ProjectDetails } from '~~/types/api';

const route = useRoute();
const projectId = route.params.id as string;

const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`);

useHead(
  computed(() => ({
    title: `Import runs — ${project.value?.label || project.value?.name || 'Project'} — Piwi Dashboard`,
  })),
);

/**
 * The demo runs entirely in the browser against a fixed seed — no server to
 * receive an upload, no storage to put a trace in. The affordance is hidden on
 * the project page, so this only catches a deep link.
 */
const isDemoMode = useRuntimeConfig().public.demoMode;

const projectName = computed(() => project.value?.name);
const {
  entries,
  maxBytes,
  limitError,
  importing,
  canHash,
  readyCount,
  importedCount,
  busy,
  batch,
  loadLimit,
  addFiles,
  startImport,
  remove,
  clearFinished,
} = useBlobReportImport(projectName);

onMounted(() => {
  if (!isDemoMode) loadLimit();
});

const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

function onPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) addFiles([...input.files]);
  // Reset so re-picking the same file fires `change` again.
  input.value = '';
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  const dropped = [...(event.dataTransfer?.files ?? [])];
  if (dropped.length) addFiles(dropped);
}

const finishedCount = computed(() => entries.value.filter((e) => ['imported', 'duplicate'].includes(e.state)).length);
</script>

<template>
  <UDashboardPanel id="project-import">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Import runs' },
            ]"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="isDemoMode" class="p-4">
        <SectionCard title="Import past runs" icon="i-lucide-import">
          <EmptyState
            icon="i-lucide-cloud-off"
            text="Importing is not available in the demo — it runs entirely in your browser, with no server to upload archives to and a fixed set of sample data."
          >
            <UButton
              label="Read how importing works"
              icon="i-lucide-book-open"
              variant="outline"
              size="sm"
              to="https://piwitests.github.io/importing-runs"
              target="_blank"
            />
          </EmptyState>
        </SectionCard>
      </div>

      <div v-else class="p-4 space-y-4">
        <SectionCard
          title="Import past runs"
          icon="i-lucide-import"
          help="project.import"
          subtitle="Backfill runs recorded before you started using Piwi, from Playwright's own blob reports."
        >
          <div class="space-y-4">
            <div class="text-sm text-gray-600 dark:text-gray-400 space-y-2">
              <p>
                Run your suite with the blob reporter and upload the archives it writes to
                <code>blob-report/</code>:
              </p>
              <CodeBlock code="npx playwright test --reporter=blob" language="bash" />
              <p>
                Each archive imports as one completed run, with its traces, screenshots and videos. Importing the same
                archive twice does nothing, so an interrupted batch is safe to repeat.
              </p>
            </div>

            <UAlert
              color="neutral"
              variant="subtle"
              icon="i-lucide-info"
              title="What imported runs carry"
              description="Failures still cluster, and traces, screenshots and videos open exactly as they do for reported runs. Web vitals, page state and locator healing come from Piwi's own capture fixtures, so historical runs have none — they start once the reporter is in place."
              :ui="{ description: 'text-xs' }"
            />

            <UAlert
              v-if="limitError"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              :description="limitError"
            />

            <UAlert
              v-else-if="!canHash"
              color="warning"
              variant="subtle"
              icon="i-lucide-shield-off"
              description="This page is not served over HTTPS, so the browser will not compute file digests. Archives you have already imported can only be recognised after they upload, not before."
              :ui="{ description: 'text-xs' }"
            />
          </div>
        </SectionCard>

        <SectionCard title="Archives" icon="i-lucide-files" :count="entries.length || null">
          <template #actions>
            <div class="flex items-center gap-2">
              <span v-if="importing" class="text-xs text-gray-500 tabular-nums">
                {{ batch.done }} of {{ batch.total }} done
              </span>
              <UButton
                v-if="finishedCount > 0 && !importing"
                label="Clear finished"
                icon="i-lucide-eraser"
                color="neutral"
                variant="ghost"
                size="sm"
                :disabled="importing"
                @click="clearFinished()"
              />
              <UButton
                :label="readyCount > 0 ? `Import ${readyCount} archive${readyCount === 1 ? '' : 's'}` : 'Import'"
                icon="i-lucide-upload"
                size="sm"
                :loading="importing"
                :disabled="readyCount === 0 || busy"
                @click="startImport()"
              />
            </div>
          </template>

          <div class="space-y-4">
            <div
              class="rounded-lg border-2 border-dashed p-6 text-center transition-colors"
              :class="dragging ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700'"
              @dragover.prevent="dragging = true"
              @dragleave.prevent="dragging = false"
              @drop.prevent="onDrop"
            >
              <UIcon name="i-lucide-file-archive" class="size-7 text-gray-400 mb-2" />
              <p class="text-sm text-gray-600 dark:text-gray-400">Drop <code>report-*.zip</code> files here, or</p>
              <UButton
                label="Choose files"
                icon="i-lucide-folder-open"
                variant="outline"
                size="sm"
                class="mt-2"
                :disabled="importing"
                @click="fileInput?.click()"
              />
              <p v-if="maxBytes" class="text-xs text-gray-500 mt-3">
                Up to {{ formatBytes(maxBytes) }} per archive. Larger ones are rejected here, before uploading.
              </p>
              <input ref="fileInput" type="file" accept=".zip" multiple class="hidden" @change="onPicked" />
            </div>

            <EmptyState v-if="entries.length === 0" icon="i-lucide-inbox" text="No archives selected yet." />

            <div
              v-else
              class="divide-y divide-gray-100 dark:divide-gray-800 border rounded-lg border-gray-200 dark:border-gray-800"
            >
              <ImportFileRow
                v-for="entry in entries"
                :key="entry.id"
                :entry="entry"
                :removable="!importing && entry.state !== 'uploading'"
                @remove="remove"
              />
            </div>

            <div v-if="importedCount > 0" class="flex justify-end">
              <UButton
                :label="`Open ${project?.label || project?.name || 'project'}`"
                icon="i-lucide-arrow-right"
                trailing
                variant="ghost"
                size="sm"
                :to="`/projects/${projectId}`"
              />
            </div>
          </div>
        </SectionCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
