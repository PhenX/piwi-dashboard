<script setup lang="ts">
/**
 * Renders a failure's in-project call stack as a sequence of source snippets —
 * the line that actually threw (innermost, "Failed here") plus the callers above
 * it — so the interesting code isn't limited to the test line that triggered the
 * failure. Each frame shows its project-relative path:line and highlights the
 * marked failing line.
 */
import type { TestSourceFrame } from '~~/types/api';

defineProps<{
  frames: TestSourceFrame[];
  /** Piwi project id + name, threaded so the IDE opener can resolve a workspace root. */
  projectKey?: string | number | null;
  projectName?: string | null;
}>();

/** Split a line-numbered snippet into rows, flagging the `>`-marked failing line. */
function rows(snippet: string) {
  return snippet.split('\n').map((text) => ({ text, failing: text.startsWith('>') }));
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="(frame, i) in frames"
      :key="`${frame.file}:${frame.line}:${i}`"
      class="rounded-lg border border-default overflow-hidden"
    >
      <div class="flex items-center gap-2 px-3 py-1.5 bg-elevated/40 border-b border-default text-xs">
        <UIcon
          :name="i === 0 ? 'i-lucide-circle-x' : 'i-lucide-corner-left-up'"
          :class="i === 0 ? 'text-red-500' : 'text-gray-400'"
          class="size-3.5 shrink-0"
        />
        <OpenInIdeLink
          :file-path="frame.file"
          :line="frame.line"
          :project-key="projectKey"
          :project-name="projectName"
          class="min-w-0"
        />
        <UBadge :color="i === 0 ? 'error' : 'neutral'" variant="subtle" size="xs" class="ml-auto shrink-0">
          {{ i === 0 ? 'Failed here' : 'Caller' }}
        </UBadge>
      </div>
      <div class="overflow-x-auto text-xs font-mono leading-relaxed py-1">
        <div class="min-w-max">
          <div
            v-for="(row, j) in rows(frame.snippet)"
            :key="j"
            class="px-3 whitespace-pre"
            :class="
              row.failing
                ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 font-medium'
                : 'text-gray-600 dark:text-gray-400'
            "
          >
            {{ row.text }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
