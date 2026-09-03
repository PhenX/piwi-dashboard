<script setup lang="ts">
/**
 * The fix plan for a cluster, rendered as the first card of the cluster page's
 * left column: the diagnosis and its validated patch, the concrete locator edits,
 * the failing tests, the owner, and the command that verifies the work.
 *
 * It reads the same `/fix-plan` endpoint the `get_fix_plan` MCP tool returns, so
 * a person and an agent see one plan. Every section degrades independently — a
 * cluster with only failing tests still shows the verify command.
 */
import type { FixPlan } from '#shared/fix-plan.types';
import type { PatchValidation } from '#shared/patch';
import { fixPlanToMarkdown } from '#shared/fix-plan-markdown';

const props = defineProps<{
  plan: FixPlan;
  projectKey?: string | number | null;
  projectName?: string | null;
  /** CI re-run availability, threaded from the page so the verify block can offer it. */
  rerunInfo?: { available: boolean; reason: string | null } | null;
  rerunning?: boolean;
}>();

const emit = defineEmits<{ rerun: [] }>();

const { copy, copied } = useCopy();
const { copy: copyMarkdown, copied: markdownCopied } = useCopy();

const diagnosis = computed(() => props.plan.diagnosis);
const hasDiagnosis = computed(
  () => !!diagnosis.value && !!(diagnosis.value.summary || diagnosis.value.rootCause || diagnosis.value.patch),
);

/** Nothing to act on beyond the failing tests — fold the card and say so. */
const isThin = computed(() => !hasDiagnosis.value && props.plan.edits.length === 0 && !props.plan.ownership.owner);

function copyAsMarkdown() {
  const url = typeof window !== 'undefined' ? window.location.href : undefined;
  copyMarkdown(fixPlanToMarkdown(props.plan, { url }), { toast: 'Fix plan copied as Markdown' });
}

const patchBadge = computed<{ color: 'success' | 'warning' | 'error' | 'neutral'; icon: string; label: string } | null>(
  () => {
    const v = diagnosis.value?.patchValidation as PatchValidation | null | undefined;
    if (!v) return null;
    switch (v.status) {
      case 'applies':
        return { color: 'success', icon: 'i-lucide-badge-check', label: 'Applies cleanly' };
      case 'applies-with-offset':
        return { color: 'warning', icon: 'i-lucide-badge-check', label: 'Applies with offset' };
      case 'stale-file':
        return { color: 'error', icon: 'i-lucide-badge-alert', label: 'Does not apply' };
      case 'invalid':
        return { color: 'error', icon: 'i-lucide-badge-alert', label: 'Invalid diff' };
      default:
        return { color: 'neutral', icon: 'i-lucide-badge-help', label: 'Unverified' };
    }
  },
);

function copyGitApply(patch: string) {
  copy(`git apply <<'EOF'\n${patch}\nEOF`, { toast: 'git apply command copied' });
}

function downloadPatch(patch: string) {
  const body = patch.endsWith('\n') ? patch : patch + '\n';
  const blob = new Blob([body], { type: 'text/x-patch' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `piwi-fix-plan-${props.plan.cluster.id}.patch`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

// Forward the collapsible card's reveal() so a deep link (#fix-plan) can unfold
// and scroll to this card.
const cardRef = ref<{ reveal: () => void } | null>(null);
defineExpose({ reveal: () => cardRef.value?.reveal() });
</script>

<template>
  <CollapsibleSectionCard
    ref="cardRef"
    storage-key="cluster-fix-plan"
    icon="i-lucide-wrench"
    icon-class="text-primary"
    title="Fix plan"
    help="cluster.fix-plan"
    :default-folded="isThin"
  >
    <template #folded>
      <template v-if="isThin">
        {{ plan.failingTests.length }} failing {{ plan.failingTests.length === 1 ? 'test' : 'tests' }} · no diagnosis or
        locator edits yet — verify command only
      </template>
      <template v-else>
        {{ diagnosis?.summary || 'Diagnosis, edits and the command that verifies the fix' }}
      </template>
    </template>

    <template #actions>
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        :icon="markdownCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
        title="Copy the whole plan as Markdown for a ticket or an agent"
        @click="copyAsMarkdown"
      >
        Copy as Markdown
      </UButton>
    </template>

    <div class="space-y-4">
      <!-- Diagnosis + patch -->
      <div v-if="hasDiagnosis" class="space-y-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <UBadge v-if="diagnosis?.category" color="neutral" variant="subtle" size="sm">{{
            diagnosis.category
          }}</UBadge>
          <UBadge v-if="diagnosis?.confidence" color="neutral" variant="outline" size="sm">
            {{ diagnosis.confidence }} confidence
          </UBadge>
        </div>
        <p v-if="diagnosis?.summary" class="text-sm font-medium">{{ diagnosis.summary }}</p>
        <p v-if="diagnosis?.rootCause" class="text-sm text-gray-600 dark:text-gray-400">{{ diagnosis.rootCause }}</p>

        <div v-if="diagnosis?.patch">
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-gray-500 font-mono">patch</span>
              <UBadge v-if="patchBadge" :color="patchBadge.color" variant="subtle" size="sm" :icon="patchBadge.icon">
                {{ patchBadge.label }}
              </UBadge>
            </div>
            <div class="flex items-center gap-1">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-download"
                title="Download .patch file"
                @click="downloadPatch(diagnosis!.patch!)"
              />
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-terminal"
                title="Copy git apply command"
                @click="copyGitApply(diagnosis!.patch!)"
              />
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                title="Copy patch"
                @click="copy(diagnosis!.patch!, { toast: 'Patch copied' })"
              />
            </div>
          </div>
          <MarkdownPreview :text="'```diff\n' + diagnosis.patch + '\n```'" />
        </div>
      </div>

      <!-- Locator edits -->
      <div v-if="plan.edits.length" class="space-y-2">
        <p class="text-xs font-medium uppercase tracking-wide text-gray-500">
          Suggested locator edits ({{ plan.edits.length }})
        </p>
        <div
          v-for="edit in plan.edits"
          :key="edit.executionId + (edit.filePath || '')"
          class="rounded-lg border border-default bg-elevated/30 p-2.5 space-y-1.5"
        >
          <div class="flex items-center justify-between gap-2">
            <OpenInIdeLink
              :file-path="edit.filePath"
              :line="edit.line"
              :project-key="projectKey"
              :project-name="projectName"
              class="text-xs"
            />
            <UBadge v-if="edit.score != null" color="neutral" variant="soft" size="sm" title="Locator stability score">
              {{ edit.score }}/100
            </UBadge>
          </div>
          <p v-if="edit.currentLine" class="font-mono text-xs text-gray-500 truncate" :title="edit.currentLine">
            {{ edit.currentLine.trim() }}
          </p>
          <div v-if="edit.failingLocator || edit.suggestedLocator" class="flex flex-col gap-1 text-xs">
            <div v-if="edit.failingLocator" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-x" class="size-3 shrink-0 text-rose-500" />
              <LocatorCode :locator="edit.failingLocator" truncate />
            </div>
            <div v-if="edit.suggestedLocator" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-arrow-right" class="size-3 shrink-0 text-emerald-500" />
              <LocatorCode :locator="edit.suggestedLocator" truncate />
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-clipboard"
                title="Copy suggested locator"
                @click="copy(edit.suggestedLocator, { toast: 'Locator copied' })"
              />
            </div>
          </div>
          <div v-if="edit.edit?.unifiedDiff">
            <div class="flex items-center justify-between mb-0.5">
              <span class="text-xs text-gray-500 font-mono">diff</span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-clipboard"
                title="Copy patch"
                @click="copy(edit.edit!.unifiedDiff!, { toast: 'Patch copied' })"
              />
            </div>
            <DiffPatch :patch="edit.edit.unifiedDiff" />
          </div>
        </div>
      </div>

      <!-- Failing tests -->
      <div v-if="plan.failingTests.length" class="space-y-1.5">
        <p class="text-xs font-medium uppercase tracking-wide text-gray-500">
          Failing tests ({{ plan.failingTests.length }})
        </p>
        <ul class="space-y-1">
          <li
            v-for="test in plan.failingTests"
            :key="test.executionId"
            class="flex items-center justify-between gap-2 text-sm"
          >
            <NuxtLink
              :to="`/test-run-cases/${test.executionId}`"
              class="min-w-0 flex-1 truncate text-primary hover:underline"
              :title="test.title"
            >
              {{ test.title }}
            </NuxtLink>
            <OpenInIdeLink
              :file-path="test.filePath"
              :project-key="projectKey"
              :project-name="projectName"
              class="text-xs shrink-0"
            />
          </li>
        </ul>
      </div>

      <!-- Owner -->
      <div v-if="plan.ownership.owner" class="flex items-center gap-1.5 text-sm">
        <UIcon name="i-lucide-user" class="size-3.5 shrink-0 text-gray-400" />
        <span class="font-medium">{{ plan.ownership.owner }}</span>
        <span v-if="plan.ownership.source" class="text-xs text-gray-400">({{ plan.ownership.source }})</span>
      </div>

      <!-- Verify -->
      <div class="space-y-1.5">
        <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Verify</p>
        <CodeBlock :code="plan.verify.command" lang="bash" />
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ plan.verify.expectation }}</p>
        <UTooltip
          v-if="rerunInfo"
          :text="
            rerunInfo.available ? 'Re-run the affected tests in CI' : (rerunInfo.reason ?? 'CI re-run is unavailable')
          "
        >
          <UButton
            size="xs"
            variant="outline"
            color="neutral"
            icon="i-lucide-refresh-cw"
            :disabled="!rerunInfo.available"
            :loading="rerunning"
            @click="emit('rerun')"
          >
            Re-run in CI
          </UButton>
        </UTooltip>
      </div>

      <!-- MCP hint -->
      <p class="flex items-center gap-1 text-xs text-gray-400 pt-1 border-t border-default">
        <UIcon name="i-lucide-bot" class="size-3 shrink-0" />
        <code class="font-mono">get_fix_plan</code> returns this plan to your AI agent via the
        <NuxtLink to="/mcp" class="text-primary hover:underline">MCP server</NuxtLink>.
      </p>
    </div>
  </CollapsibleSectionCard>
</template>
