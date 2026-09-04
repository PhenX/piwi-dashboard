<script setup lang="ts">
/**
 * The Reproduce section of the Fix card: a copy-paste recipe that reproduces the
 * failure locally (checkout, pinned install, browser, exact test command) and,
 * when the regression window is known, a generated `git bisect` that finds the
 * breaking commit. Both are shown in Linux/macOS and Windows forms; a missing
 * bisect window degrades to a one-line muted note with the reason.
 */
import { reproScript, type ReproRecipe, type BisectResult } from '#shared/reproduce';

const props = defineProps<{
  reproduce: ReproRecipe;
  bisect: BisectResult;
}>();

const recipeBash = computed(() => reproScript(props.reproduce, 'bash'));
const recipePowershell = computed(() => reproScript(props.reproduce, 'powershell'));
</script>

<template>
  <div class="space-y-3" data-shot="fix-reproduce-body">
    <div class="space-y-1.5">
      <p class="text-xs text-muted">
        Reproduce the failure on your machine — check out the failing commit, install the run's Playwright version and
        browser, then run exactly the failing test.
      </p>
      <PlatformCodeBlock :bash="recipeBash" :powershell="recipePowershell" storage-key="piwi-repro-shell" />
      <div v-if="reproduce.env.length" class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span v-for="e in reproduce.env" :key="e.label">
          <span class="font-medium">{{ e.label }}:</span> <span class="font-mono">{{ e.value }}</span>
        </span>
      </div>
      <p v-for="note in reproduce.notes" :key="note" class="text-xs text-dimmed">{{ note }}</p>
    </div>

    <div class="space-y-1.5">
      <div class="flex items-center gap-1.5">
        <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0 text-muted" />
        <h4 class="text-xs font-medium uppercase tracking-wide text-muted">Find the breaking commit</h4>
      </div>
      <template v-if="bisect.available">
        <PlatformCodeBlock :bash="bisect.bash" :powershell="bisect.powershell" storage-key="piwi-repro-shell" />
        <p class="text-xs text-muted">{{ bisect.explanation }}</p>
      </template>
      <p v-else class="text-xs text-dimmed">{{ bisect.reason }}</p>
    </div>
  </div>
</template>
