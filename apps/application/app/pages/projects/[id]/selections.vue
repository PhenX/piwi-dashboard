<script setup lang="ts">
/**
 * The project's test selections — named, data-driven subsets of the suite,
 * resolved on demand from run history. Built-ins (failed, quarantine-free) sit
 * alongside saved ones. The builder writes a declarative definition and previews
 * live what it resolves to, with the exact `piwi run` / `playwright test` command.
 */
import type { ProjectDetails } from '~~/types/api';
import {
  SELECTION_KEY_PATTERN,
  validateSelectionDefinition,
  type Selection,
  type SelectionDefinition,
} from '#shared/selection';

interface Resolution {
  key: string | null;
  version: number | null;
  tests: Array<{ testCaseId: number; filePath: string; title: string; line: number | null }>;
  estimate: { count: number; totalDurationMs: number | null };
  warnings: Array<{ code: string; message: string }>;
  materialization: { format: string; args: string[]; command: string };
}

const route = useRoute();
const projectId = route.params.id as string;
const toast = useToast();

const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`);
const { data: list, refresh, status } = await useFetch<{ items: Selection[] }>(`/api/projects/${projectId}/selections`);

useHead(
  computed(() => ({
    title: `Selections — ${project.value?.label || project.value?.name || 'Project'} — Piwi Dashboard`,
  })),
);

const selections = computed(() => list.value?.items ?? []);

// ── Definition templates (double as documentation of the format) ──────────────
const TEMPLATES: Array<{ label: string; definition: SelectionDefinition }> = [
  { label: 'Smoke by tag', definition: { include: [{ tags: ['smoke'] }] } },
  { label: 'Critical & stable', definition: { include: [{ priority: ['critical', 'high'], minPassRate: 0.9 }] } },
  { label: 'Exclude quarantine', definition: { exclude: [{ quarantined: true }] } },
  { label: 'Recently broken', definition: { include: [{ failedInLastRuns: 5 }] } },
  { label: 'Best 5 minutes', definition: { budget: { maxTotalDurationMs: 300000, rankBy: 'failureLikelihood' } } },
];

// ── Create / edit modal ───────────────────────────────────────────────────────
const showForm = ref(false);
const saving = ref(false);
const editingKey = ref<string | null>(null);
const form = reactive({
  key: '',
  name: '',
  description: '',
  definitionText: '{\n  "include": [{ "tags": ["smoke"] }]\n}',
});

const parsed = computed<{ definition?: SelectionDefinition; error?: string }>(() => {
  let value: unknown;
  try {
    value = JSON.parse(form.definitionText);
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}` };
  }
  const check = validateSelectionDefinition(value);
  if (!check.valid) return { error: check.errors.join('; ') };
  return { definition: value as SelectionDefinition };
});

const keyError = computed<string | undefined>(() => {
  if (!form.key) return 'A key is required';
  if (!SELECTION_KEY_PATTERN.test(form.key)) return 'Lowercase letters, digits and hyphens only';
  return undefined;
});

function openCreate() {
  editingKey.value = null;
  form.key = '';
  form.name = '';
  form.description = '';
  form.definitionText = '{\n  "include": [{ "tags": ["smoke"] }]\n}';
  preview.value = null;
  showForm.value = true;
}

function openEdit(selection: Selection) {
  editingKey.value = selection.key;
  form.key = selection.key;
  form.name = selection.name;
  form.description = selection.description ?? '';
  form.definitionText = JSON.stringify(selection.definition, null, 2);
  preview.value = null;
  showForm.value = true;
  runPreview();
}

function applyTemplate(definition: SelectionDefinition) {
  form.definitionText = JSON.stringify(definition, null, 2);
  runPreview();
}

async function save() {
  if (keyError.value || parsed.value.error || !form.name.trim()) return;
  saving.value = true;
  try {
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      definition: parsed.value.definition,
    };
    if (editingKey.value) {
      await $fetch(`/api/projects/${projectId}/selections/${encodeURIComponent(editingKey.value)}`, {
        method: 'PATCH',
        body,
      });
    } else {
      await $fetch(`/api/projects/${projectId}/selections`, { method: 'POST', body: { key: form.key, ...body } });
    }
    toast.add({ title: editingKey.value ? 'Selection updated' : 'Selection created', color: 'success' });
    showForm.value = false;
    await refresh();
  } catch (e) {
    toast.add({
      title: 'Could not save',
      description: (e as { data?: { message?: string } })?.data?.message,
      color: 'error',
    });
  } finally {
    saving.value = false;
  }
}

async function remove(selection: Selection) {
  // eslint-disable-next-line no-alert
  if (!confirm(`Delete selection "${selection.key}"?`)) return;
  try {
    await $fetch(`/api/projects/${projectId}/selections/${encodeURIComponent(selection.key)}`, { method: 'DELETE' });
    toast.add({ title: 'Selection deleted', color: 'success' });
    await refresh();
  } catch (e) {
    toast.add({
      title: 'Could not delete',
      description: (e as { data?: { message?: string } })?.data?.message,
      color: 'error',
    });
  }
}

// ── Live preview (debounced) ──────────────────────────────────────────────────
const preview = ref<Resolution | null>(null);
const previewing = ref(false);
let previewTimer: ReturnType<typeof setTimeout> | undefined;

function runPreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    if (parsed.value.error || !parsed.value.definition) {
      preview.value = null;
      return;
    }
    previewing.value = true;
    try {
      preview.value = await $fetch<Resolution>(`/api/projects/${projectId}/selections/preview`, {
        method: 'POST',
        body: { definition: parsed.value.definition, format: 'args' },
      });
    } catch {
      preview.value = null;
    } finally {
      previewing.value = false;
    }
  }, 400);
}

watch(() => form.definitionText, runPreview);

// ── Resolve modal (per selection) ─────────────────────────────────────────────
const showResolve = ref(false);
const resolving = ref(false);
const resolved = ref<Resolution | null>(null);
const resolvedKey = ref('');

async function openResolve(selection: Selection) {
  resolvedKey.value = selection.key;
  resolved.value = null;
  showResolve.value = true;
  resolving.value = true;
  try {
    resolved.value = await $fetch<Resolution>(
      `/api/projects/${projectId}/selections/${encodeURIComponent(selection.key)}/resolve?format=args`,
    );
  } catch (e) {
    toast.add({
      title: 'Could not resolve',
      description: (e as { data?: { message?: string } })?.data?.message,
      color: 'error',
    });
    showResolve.value = false;
  } finally {
    resolving.value = false;
  }
}

function runCommand(key: string): string {
  return `npx @piwitests/reporter run ${key}`;
}

// ── Suggestions ───────────────────────────────────────────────────────────────
interface TagSuggestion {
  testCaseId: number;
  title: string;
  filePath: string;
  kind: 'slow' | 'feature';
  tag: string;
  confidence: number;
  evidence: string[];
}
interface Suggestions {
  tags: TagSuggestion[];
  smoke: {
    budgetMs: number;
    totalRoutes: number;
    coveredRoutes: number;
    testCaseIds: number[];
    picks: Array<{
      testCaseId: number;
      title: string;
      newRoutes: number;
      cumulativeRoutes: number;
      cumulativeDurationMs: number;
    }>;
  } | null;
}

const suggestions = ref<Suggestions | null>(null);
const analyzing = ref(false);

async function analyze() {
  analyzing.value = true;
  try {
    suggestions.value = await $fetch<Suggestions>(`/api/projects/${projectId}/selections/suggestions`);
  } catch (e) {
    toast.add({
      title: 'Could not analyze',
      description: (e as { data?: { message?: string } })?.data?.message,
      color: 'error',
    });
  } finally {
    analyzing.value = false;
  }
}

/** Seed the create form with a mined smoke suite as an exact-id selection. */
function saveSmoke(testCaseIds: number[]) {
  editingKey.value = null;
  form.key = 'smoke';
  form.name = 'Smoke suite';
  form.description = 'Mined for route coverage under a time budget.';
  form.definitionText = JSON.stringify({ include: [{ ids: testCaseIds }] }, null, 2);
  showForm.value = true;
  runPreview();
}
</script>

<template>
  <UDashboardPanel id="project-selections">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Selections' },
            ]"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-4">
        <SectionCard
          title="Test selections"
          icon="i-lucide-list-filter"
          :count="selections.length || null"
          subtitle="Named, data-driven subsets of the suite resolved from run history. Run one with `npx @piwitests/reporter run <key>`."
        >
          <template #actions>
            <UButton label="New selection" icon="i-lucide-plus" size="sm" @click="openCreate" />
          </template>

          <LoadingState v-if="status === 'pending'" />
          <EmptyState
            v-else-if="selections.length === 0"
            icon="i-lucide-list-filter"
            text="No selections yet — create one, or run a built-in with piwi run failed."
          />
          <div v-else class="divide-y divide-gray-200 dark:divide-gray-800">
            <div
              v-for="selection in selections"
              :key="selection.key"
              class="py-3 flex items-start justify-between gap-3"
            >
              <div class="min-w-0 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono text-sm font-medium">{{ selection.key }}</span>
                  <UBadge v-if="selection.builtin" color="neutral" variant="subtle" size="sm">built-in</UBadge>
                  <span class="text-sm text-gray-600 dark:text-gray-300">{{ selection.name }}</span>
                </div>
                <div v-if="selection.description" class="text-xs text-gray-500 dark:text-gray-400">
                  {{ selection.description }}
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <UButton
                  label="Command"
                  icon="i-lucide-terminal"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  @click="openResolve(selection)"
                />
                <UButton
                  v-if="!selection.builtin"
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :aria-label="`Edit ${selection.key}`"
                  @click="openEdit(selection)"
                />
                <UButton
                  v-if="!selection.builtin"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="sm"
                  :aria-label="`Delete ${selection.key}`"
                  @click="remove(selection)"
                />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Suggestions"
          icon="i-lucide-sparkles"
          subtitle="Proposed from observed history — slow outliers, feature tags from route families, and a mined smoke suite. Suggest-only; nothing is applied."
        >
          <template #actions>
            <UButton label="Analyze" icon="i-lucide-wand-2" size="sm" :loading="analyzing" @click="analyze" />
          </template>

          <EmptyState
            v-if="!suggestions && !analyzing"
            icon="i-lucide-sparkles"
            text="Analyze the project's history to propose tags and a smoke suite."
          />
          <LoadingState v-else-if="analyzing && !suggestions" />
          <div v-else-if="suggestions" class="space-y-4">
            <!-- Mined smoke suite -->
            <div
              v-if="suggestions.smoke && suggestions.smoke.picks.length"
              class="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Mined smoke suite</span>
                <UButton
                  label="Save as selection"
                  icon="i-lucide-save"
                  size="xs"
                  variant="subtle"
                  @click="saveSmoke(suggestions.smoke.testCaseIds)"
                />
              </div>
              <p class="text-xs text-gray-500">
                {{ suggestions.smoke.picks.length }} tests cover
                <strong>{{ suggestions.smoke.coveredRoutes }}</strong> of {{ suggestions.smoke.totalRoutes }} routes in
                ~{{ formatDuration(suggestions.smoke.picks.at(-1)?.cumulativeDurationMs ?? 0) }} — each pick buys fewer
                new routes than the last.
              </p>
              <div class="flex flex-wrap gap-1">
                <UBadge
                  v-for="pick in suggestions.smoke.picks"
                  :key="pick.testCaseId"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  :title="`+${pick.newRoutes} new routes → ${pick.cumulativeRoutes} total`"
                >
                  {{ pick.title }} <span class="opacity-60">+{{ pick.newRoutes }}</span>
                </UBadge>
              </div>
            </div>

            <!-- Tag suggestions -->
            <div v-if="suggestions.tags.length" class="divide-y divide-gray-200 dark:divide-gray-800">
              <div
                v-for="tag in suggestions.tags"
                :key="`${tag.kind}-${tag.testCaseId}`"
                class="py-2 flex items-start justify-between gap-3"
              >
                <div class="min-w-0 space-y-0.5">
                  <div class="flex items-center gap-2">
                    <UBadge :color="tag.kind === 'slow' ? 'warning' : 'primary'" variant="subtle" size="sm"
                      >@{{ tag.tag }}</UBadge
                    >
                    <NuxtLink
                      :to="`/test-cases/${tag.testCaseId}`"
                      class="text-sm text-primary hover:underline truncate"
                    >
                      {{ tag.title }}
                    </NuxtLink>
                  </div>
                  <p class="text-xs text-gray-500">{{ tag.evidence[0] }}</p>
                </div>
              </div>
            </div>
            <EmptyState
              v-if="!suggestions.tags.length && !(suggestions.smoke && suggestions.smoke.picks.length)"
              icon="i-lucide-check"
              text="No suggestions — not enough route/duration history yet, or nothing stands out."
            />
          </div>
        </SectionCard>
      </div>
    </template>
  </UDashboardPanel>

  <ClientOnly>
    <!-- Create / edit -->
    <UModal
      v-model:open="showForm"
      :title="editingKey ? `Edit ${editingKey}` : 'New selection'"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Key" :error="editingKey ? undefined : keyError" required>
              <UInput v-model="form.key" :disabled="!!editingKey" placeholder="smoke" class="w-full font-mono" />
            </UFormField>
            <UFormField label="Name" required>
              <UInput v-model="form.name" placeholder="Smoke tests" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Description">
            <UInput
              v-model="form.description"
              placeholder="Fast breadth check over the app's entry points"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Definition">
            <div class="flex flex-wrap gap-1 mb-2">
              <UButton
                v-for="tpl in TEMPLATES"
                :key="tpl.label"
                :label="tpl.label"
                color="neutral"
                variant="subtle"
                size="xs"
                @click="applyTemplate(tpl.definition)"
              />
            </div>
            <UTextarea v-model="form.definitionText" :rows="10" class="w-full font-mono text-xs" />
          </UFormField>
          <UAlert
            v-if="parsed.error"
            color="error"
            variant="subtle"
            :title="parsed.error"
            icon="i-lucide-triangle-alert"
          />

          <!-- Live preview -->
          <div class="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="font-medium">Live preview</span>
              <span v-if="previewing" class="text-xs text-gray-500">resolving…</span>
            </div>
            <template v-if="preview">
              <div class="flex items-center gap-4 text-sm">
                <span
                  ><strong>{{ preview.estimate.count }}</strong>
                  {{ preview.estimate.count === 1 ? 'test' : 'tests' }}</span
                >
                <span v-if="preview.estimate.totalDurationMs != null" class="text-gray-500">
                  ~{{ formatDuration(preview.estimate.totalDurationMs) }}
                </span>
              </div>
              <UAlert
                v-for="w in preview.warnings"
                :key="w.code"
                color="warning"
                variant="subtle"
                :title="w.message"
                icon="i-lucide-triangle-alert"
                :ui="{ title: 'text-xs' }"
              />
              <CodeBlock v-if="preview.materialization.command" :code="preview.materialization.command" lang="bash" />
            </template>
            <p v-else-if="!parsed.error" class="text-xs text-gray-500">
              Edit the definition to preview what it resolves to.
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="showForm = false" />
          <UButton
            :label="editingKey ? 'Save' : 'Create'"
            :loading="saving"
            :disabled="!!parsed.error || !form.name.trim() || (!editingKey && !!keyError)"
            @click="save"
          />
        </div>
      </template>
    </UModal>

    <!-- Resolve -->
    <UModal v-model:open="showResolve" :title="`Run ${resolvedKey}`" :ui="{ content: 'max-w-3xl' }">
      <template #body>
        <LoadingState v-if="resolving" />
        <div v-else-if="resolved" class="space-y-3">
          <div class="flex items-center gap-4 text-sm">
            <span
              ><strong>{{ resolved.estimate.count }}</strong>
              {{ resolved.estimate.count === 1 ? 'test' : 'tests' }}</span
            >
            <span v-if="resolved.estimate.totalDurationMs != null" class="text-gray-500">
              ~{{ formatDuration(resolved.estimate.totalDurationMs) }}
            </span>
          </div>
          <UAlert
            v-for="w in resolved.warnings"
            :key="w.code"
            color="warning"
            variant="subtle"
            :title="w.message"
            icon="i-lucide-triangle-alert"
            :ui="{ title: 'text-xs' }"
          />
          <div>
            <p class="text-xs text-gray-500 mb-1">Run it with the reporter CLI</p>
            <CodeBlock :code="runCommand(resolvedKey)" lang="bash" />
          </div>
          <div v-if="resolved.materialization.command">
            <p class="text-xs text-gray-500 mb-1">Or drive Playwright directly</p>
            <CodeBlock :code="resolved.materialization.command" lang="bash" />
          </div>
          <EmptyState
            v-if="resolved.estimate.count === 0"
            icon="i-lucide-search-x"
            text="This selection currently matches no tests."
          />
        </div>
      </template>
    </UModal>
  </ClientOnly>
</template>
