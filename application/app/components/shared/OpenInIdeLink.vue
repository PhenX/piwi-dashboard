<script setup lang="ts">
/**
 * Renders a source path (or a `file:line:col` location) as selectable text with
 * a revealed "open in IDE" affordance: the icon runs the configured default
 * (Auto by default), and a caret opens a chooser to pick a specific method or
 * copy the path. All launching/preferences live in `useOpenInIde`; this is a
 * thin, client-only trigger safe to drop in anywhere a path is shown today.
 */
import { parseLocation } from '~/utils/ide-links';

const props = withDefaults(
  defineProps<{
    /** Repo-relative source path. */
    filePath?: string;
    line?: number | null;
    column?: number | null;
    /** Convenience: a `file:line:col` string, parsed when `filePath` is absent. */
    location?: string | null;
    /** Piwi project id — selects the per-project workspace-root/name override. */
    projectKey?: string | number | null;
    /** Piwi project name — default IDE project name for the jetbrains:// URL. */
    projectName?: string | null;
    /** Render the label in a monospace font (default true). */
    mono?: boolean;
  }>(),
  { mono: true, line: null, column: null },
);

const { openInIde, openInVscode, openViaJetbrainsUrl, openViaJetbrainsHttp, resolveAbsPath, openSettings } =
  useOpenInIde();
const { copy } = useCopy();

const parsed = computed(() => {
  if (props.filePath) return { filePath: props.filePath, line: props.line ?? null, column: props.column ?? null };
  if (props.location) return parseLocation(props.location);
  return { filePath: '', line: null, column: null };
});

const resolvedPath = computed(() => parsed.value.filePath);
const resolvedLine = computed(() => parsed.value.line);
const label = computed(() => (resolvedLine.value ? `${resolvedPath.value}:${resolvedLine.value}` : resolvedPath.value));
const absPath = computed(() => resolveAbsPath(resolvedPath.value, props.projectKey));

const target = computed(() => ({
  filePath: resolvedPath.value,
  line: resolvedLine.value,
  column: parsed.value.column,
  projectKey: props.projectKey ?? null,
  projectName: props.projectName ?? null,
}));

const open = ref(false);

function run(action: () => void) {
  open.value = false;
  action();
}
</script>

<template>
  <span class="group/ide inline-flex items-center gap-1 min-w-0 max-w-full align-middle">
    <span :class="[mono ? 'font-mono' : '', 'truncate']" :title="label">
      <slot>{{ label }}</slot>
    </span>

    <span
      v-if="resolvedPath"
      class="inline-flex items-center shrink-0 opacity-100 sm:opacity-0 sm:group-hover/ide:opacity-100 focus-within:opacity-100 transition-opacity"
    >
      <UButton
        icon="i-lucide-external-link"
        size="xs"
        variant="ghost"
        color="neutral"
        :aria-label="`Open ${label} in IDE`"
        title="Open in IDE"
        @click="run(() => openInIde(target))"
      />
      <UPopover v-model:open="open">
        <UButton
          icon="i-lucide-chevron-down"
          size="xs"
          variant="ghost"
          color="neutral"
          aria-label="Choose how to open in IDE"
          title="Choose how to open"
        />
        <template #content>
          <div class="w-56 p-1 space-y-0.5">
            <p class="text-xs font-medium text-muted px-2 pt-1 pb-1">Open in IDE</p>

            <UButton
              block
              size="sm"
              color="neutral"
              variant="ghost"
              class="justify-start"
              icon="i-lucide-wand-sparkles"
              @click="run(() => openInIde({ ...target, method: 'auto' }))"
            >
              Auto (try all)
            </UButton>
            <UButton
              block
              size="sm"
              color="neutral"
              variant="ghost"
              class="justify-start"
              icon="i-lucide-code"
              @click="run(() => openInVscode(target))"
            >
              Open in VS Code
            </UButton>
            <UButton
              block
              size="sm"
              color="neutral"
              variant="ghost"
              class="justify-start"
              icon="i-lucide-square-code"
              @click="run(() => openViaJetbrainsUrl(target))"
            >
              JetBrains (URL)
            </UButton>
            <UButton
              block
              size="sm"
              color="neutral"
              variant="ghost"
              class="justify-start"
              icon="i-lucide-server"
              @click="run(() => openViaJetbrainsHttp(target))"
            >
              JetBrains (local server)
            </UButton>

            <USeparator class="my-1" />

            <UButton
              block
              size="sm"
              color="neutral"
              variant="ghost"
              class="justify-start"
              icon="i-lucide-clipboard"
              @click="run(() => copy(resolvedPath, { toast: 'Path copied' }))"
            >
              Copy path
            </UButton>
            <UButton
              v-if="absPath"
              block
              size="sm"
              color="neutral"
              variant="ghost"
              class="justify-start"
              icon="i-lucide-clipboard-check"
              @click="run(() => copy(absPath, { toast: 'Absolute path copied' }))"
            >
              Copy absolute path
            </UButton>

            <USeparator class="my-1" />

            <UButton
              block
              size="sm"
              color="neutral"
              variant="ghost"
              class="justify-start"
              icon="i-lucide-settings"
              @click="
                run(() =>
                  openSettings({
                    projectKey: target.projectKey ? String(target.projectKey) : null,
                    projectName: target.projectName,
                  }),
                )
              "
            >
              Configure…
            </UButton>
          </div>
        </template>
      </UPopover>
    </span>
  </span>
</template>
