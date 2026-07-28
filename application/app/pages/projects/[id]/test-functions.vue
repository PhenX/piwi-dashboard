<script setup lang="ts">
/**
 * The project's test function catalog — page-object methods/helpers that a
 * recorded browser-extension session is matched against so a raw locator
 * span can collapse into a call to the project's own code. See
 * `packages/core/src/function-match.ts` for the matching algorithm and
 * `extension/AGENTS.md` for how the extension consumes this list.
 */
import type { ProjectDetails, TestFunctionsResponse, TestFunctionInfo, TestFunctionStepAction } from '~~/types/api';

const route = useRoute();
const projectId = route.params.id as string;
const toast = useToast();

const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`);
const {
  data: catalog,
  refresh,
  status,
} = await useFetch<TestFunctionsResponse>(`/api/projects/${projectId}/test-functions`);

useHead(
  computed(() => ({
    title: `Test functions — ${project.value?.label || project.value?.name || 'Project'} — Piwi Dashboard`,
  })),
);

const entries = computed(() => catalog.value?.testFunctions ?? []);

const KIND_ITEMS = [
  { label: 'Page-object method', value: 'page-object-method' },
  { label: 'Helper function', value: 'helper' },
  { label: 'Fixture', value: 'fixture' },
];
const PARAM_TYPE_ITEMS = [
  { label: 'string', value: 'string' },
  { label: 'number', value: 'number' },
  { label: 'boolean', value: 'boolean' },
];
const ACTION_ITEMS: Array<{ label: string; value: TestFunctionStepAction }> = [
  { label: 'goto', value: 'goto' },
  { label: 'click', value: 'click' },
  { label: 'fill', value: 'fill' },
  { label: 'check', value: 'check' },
  { label: 'uncheck', value: 'uncheck' },
  { label: 'selectOption', value: 'selectOption' },
  { label: 'press', value: 'press' },
  { label: 'assertVisible', value: 'assertVisible' },
];
const PARAM_SOURCE_ITEMS = [
  { label: 'element text', value: 'text' },
  { label: 'field value', value: 'value' },
  { label: 'test id', value: 'testId' },
];

const showModal = ref(false);
const saving = ref(false);

function emptyForm() {
  return {
    name: '',
    kind: 'page-object-method' as 'page-object-method' | 'helper' | 'fixture',
    module: '',
    receiver: '',
    importName: '',
    urlPattern: '',
    params: [] as Array<{ name: string; type: 'string' | 'number' | 'boolean' }>,
    steps: [{ action: 'click' as TestFunctionStepAction, role: '', name: '', testId: '' }],
    paramSources: [] as Array<{ param: string; stepIndex: number; from: 'text' | 'value' | 'testId' }>,
  };
}

const form = ref(emptyForm());

function openAdd() {
  form.value = emptyForm();
  showModal.value = true;
}

function addParam() {
  form.value.params.push({ name: '', type: 'string' });
}
function removeParam(index: number) {
  form.value.params.splice(index, 1);
}

function addStep() {
  form.value.steps.push({ action: 'click', role: '', name: '', testId: '' });
}
function removeStep(index: number) {
  if (form.value.steps.length <= 1) return;
  form.value.steps.splice(index, 1);
}

function addParamSource() {
  form.value.paramSources.push({ param: '', stepIndex: 0, from: 'value' });
}
function removeParamSource(index: number) {
  form.value.paramSources.splice(index, 1);
}

async function save() {
  if (!form.value.name.trim()) {
    toast.add({ title: 'Name is required', color: 'error' });
    return;
  }
  if (!form.value.module.trim()) {
    toast.add({ title: 'Module is required', color: 'error' });
    return;
  }

  saving.value = true;
  const body = {
    name: form.value.name.trim(),
    kind: form.value.kind,
    module: form.value.module.trim(),
    receiver: form.value.kind === 'page-object-method' ? form.value.receiver.trim() || null : null,
    importName: form.value.kind === 'page-object-method' ? form.value.importName.trim() || null : null,
    urlPattern: form.value.urlPattern.trim() || null,
    params: form.value.params.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), type: p.type })),
    steps: form.value.steps.map((s) => ({
      action: s.action,
      target: {
        role: s.role.trim() || null,
        name: s.name.trim() || null,
        testId: s.testId.trim() || null,
      },
    })),
    paramSources: form.value.paramSources.filter((s) => s.param.trim()),
  };

  try {
    await $fetch(`/api/projects/${projectId}/test-functions`, { method: 'POST', body });
    toast.add({ title: 'Function added', color: 'success' });
    showModal.value = false;
    await refresh();
  } catch (error: unknown) {
    toast.add({ title: 'Failed to add function', description: errorMessage(error), color: 'error' });
  } finally {
    saving.value = false;
  }
}

async function remove(entry: TestFunctionInfo) {
  try {
    await $fetch(`/api/test-functions/${entry.id}`, { method: 'DELETE' });
    toast.add({ title: 'Function removed', color: 'success' });
    await refresh();
  } catch (error: unknown) {
    toast.add({ title: 'Failed to remove function', description: errorMessage(error), color: 'error' });
  }
}

function describeSteps(entry: TestFunctionInfo): string {
  return entry.entry.steps
    .map((s) => `${s.action}(${s.target.role ?? s.target.testId ?? s.target.name ?? '?'})`)
    .join(' → ');
}
</script>

<template>
  <UDashboardPanel id="project-test-functions">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Test functions' },
            ]"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-4">
        <SectionCard
          title="Test function catalog"
          icon="i-lucide-function-square"
          :count="entries.length || null"
          subtitle="Page-object methods and helpers the Piwi Picker extension matches a recording against, to generate calls to your own code instead of raw locator lines."
        >
          <template #actions>
            <UButton label="Add function" icon="i-lucide-plus" size="sm" @click="openAdd" />
          </template>

          <LoadingState v-if="status === 'pending'" />
          <EmptyState
            v-else-if="entries.length === 0"
            icon="i-lucide-function-square"
            text="No functions registered yet — add one, or extract one from a recording in the extension."
          />
          <div v-else class="divide-y divide-gray-200 dark:divide-gray-800">
            <div v-for="entry in entries" :key="entry.id" class="py-3 flex items-start justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono text-sm font-medium">{{ entry.name }}</span>
                  <UBadge color="neutral" variant="subtle" size="sm">{{ entry.kind }}</UBadge>
                  <UBadge v-if="entry.source !== 'manual'" color="primary" variant="subtle" size="sm">
                    {{ entry.source }}
                  </UBadge>
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                  {{ entry.module }}<span v-if="entry.receiver">#{{ entry.receiver }}</span>
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ describeSteps(entry) }}</div>
                <div v-if="entry.urlPattern" class="text-xs text-gray-500 dark:text-gray-400">
                  on <code>{{ entry.urlPattern }}</code>
                </div>
              </div>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                :aria-label="`Remove ${entry.name}`"
                @click="remove(entry)"
              />
            </div>
          </div>
        </SectionCard>
      </div>
    </template>
  </UDashboardPanel>

  <ClientOnly>
    <UModal v-model:open="showModal" title="Add test function" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <div class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField label="Name" name="name" required help="Becomes the called method/function name.">
              <UInput v-model="form.name" placeholder="e.g. addToCart" class="w-full" />
            </UFormField>
            <UFormField label="Kind" name="kind">
              <USelect v-model="form.kind" :items="KIND_ITEMS" class="w-full" />
            </UFormField>
          </div>

          <UFormField label="Module" name="module" required help="Import specifier, e.g. ./pages/CartPage">
            <UInput v-model="form.module" placeholder="./pages/CartPage" class="w-full" />
          </UFormField>

          <div v-if="form.kind === 'page-object-method'" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField label="Receiver" name="receiver" help="Instance variable name, e.g. cartPage">
              <UInput v-model="form.receiver" placeholder="cartPage" class="w-full" />
            </UFormField>
            <UFormField label="Class to import" name="importName" help="e.g. CartPage">
              <UInput v-model="form.importName" placeholder="CartPage" class="w-full" />
            </UFormField>
          </div>

          <UFormField
            label="URL pattern"
            name="urlPattern"
            help="Optional glob, e.g. **/cart — leave empty to match any page."
          >
            <UInput v-model="form.urlPattern" placeholder="**/cart" class="w-full" />
          </UFormField>

          <UFormField label="Parameters">
            <div class="space-y-2">
              <div v-for="(param, i) in form.params" :key="i" class="flex items-center gap-2">
                <UInput v-model="param.name" placeholder="param name" class="flex-1" />
                <USelect v-model="param.type" :items="PARAM_TYPE_ITEMS" class="w-32" />
                <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" @click="removeParam(i)" />
              </div>
              <UButton
                label="Add parameter"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                size="sm"
                @click="addParam"
              />
            </div>
          </UFormField>

          <UFormField
            label="DOM pattern"
            required
            help="The ordered steps this function drives — matched against a recording."
          >
            <div class="space-y-2">
              <div v-for="(step, i) in form.steps" :key="i" class="flex items-center gap-2 flex-wrap">
                <span class="text-xs text-gray-500 w-4">{{ i + 1 }}.</span>
                <USelect v-model="step.action" :items="ACTION_ITEMS" class="w-36" />
                <UInput v-model="step.role" placeholder="role (e.g. button)" class="flex-1 min-w-24" />
                <UInput v-model="step.name" placeholder="accessible name" class="flex-1 min-w-24" />
                <UInput v-model="step.testId" placeholder="test id" class="flex-1 min-w-24" />
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :disabled="form.steps.length <= 1"
                  @click="removeStep(i)"
                />
              </div>
              <UButton
                label="Add step"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                size="sm"
                @click="addStep"
              />
            </div>
          </UFormField>

          <UFormField
            v-if="form.params.length > 0"
            label="Parameter sources"
            help="Where each argument's value comes from, at match time."
          >
            <div class="space-y-2">
              <div v-for="(src, i) in form.paramSources" :key="i" class="flex items-center gap-2">
                <USelect
                  v-model="src.param"
                  :items="form.params.filter((p) => p.name.trim()).map((p) => ({ label: p.name, value: p.name }))"
                  placeholder="parameter"
                  class="flex-1"
                />
                <USelect
                  v-model="src.stepIndex"
                  :items="form.steps.map((_, idx) => ({ label: `step ${idx + 1}`, value: idx }))"
                  class="w-28"
                />
                <USelect v-model="src.from" :items="PARAM_SOURCE_ITEMS" class="w-36" />
                <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" @click="removeParamSource(i)" />
              </div>
              <UButton
                label="Add source"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                size="sm"
                @click="addParamSource"
              />
            </div>
          </UFormField>
        </div>
      </template>

      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="showModal = false" />
        <UButton label="Add function" icon="i-lucide-check" :loading="saving" @click="save" />
      </template>
    </UModal>
  </ClientOnly>
</template>
