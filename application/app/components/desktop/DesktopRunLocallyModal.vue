<script setup lang="ts">
/**
 * Desktop shell only: run the given test cases locally, in the folder linked to
 * the project. The shell executes the folder's own Playwright with the bundled
 * Node sidecar and streams output back here; results land in the dashboard
 * through the project's regular Piwi reporter (which discovers the running app
 * via `~/.piwi/desktop.json`).
 */
import type { RetryCase, RetryMode } from '~/utils/retry-command';
import { buildLocalRunPlan, type LocalRunMode } from '~/utils/local-run-args';

const props = defineProps<{
  /** Piwi project id owning the linked folder. */
  projectId: string | number;
  projectLabel?: string | null;
  /** The failing cases to retry. */
  cases: RetryCase[];
}>();

const open = defineModel<boolean>('open', { default: false });

const { link, busy, pickAndLink } = useDesktopProjectLink(() => props.projectId);
const { status, running, lines, exitCode, stepIndex, stepCount, start, stop } = useDesktopLocalRunner();

const mode = ref<RetryMode>('file-line');
const runMode = ref<LocalRunMode>('normal');
const trace = ref(false);
const repeatEach = ref(1);

const modeItems = [
  { label: 'File:line', value: 'file-line' },
  { label: 'Title (grep)', value: 'grep' },
  { label: 'File only', value: 'file' },
];
const runModeItems = [
  { label: 'Headless', value: 'normal' },
  { label: 'Headed', value: 'headed' },
  { label: 'Debug (inspector)', value: 'debug' },
  { label: 'UI mode', value: 'ui' },
];

const linked = computed(() => !!link.value?.exists);
const plan = computed(() =>
  buildLocalRunPlan(props.cases, {
    mode: mode.value,
    runMode: runMode.value,
    trace: trace.value,
    repeatEach: repeatEach.value,
  }),
);
const preview = computed(() => plan.value.map((s) => s.display).join('\n'));

const statusBadge = computed(() => {
  switch (status.value) {
    case 'running':
      return {
        label: stepCount.value > 1 ? `Running ${stepIndex.value + 1}/${stepCount.value}…` : 'Running…',
        color: 'info' as const,
      };
    case 'passed':
      return { label: 'Passed', color: 'success' as const };
    case 'failed':
      return { label: exitCode.value != null ? `Failed (exit ${exitCode.value})` : 'Failed', color: 'error' as const };
    case 'stopped':
      return { label: 'Stopped', color: 'neutral' as const };
    case 'error':
      return { label: 'Could not run', color: 'error' as const };
    default:
      return null;
  }
});

async function run() {
  await start(props.projectId, plan.value);
}

// Closing the modal mid-run stops the process — nothing keeps running unseen.
watch(open, (value) => {
  if (!value && running.value) void stop();
});

const outputEl = ref<HTMLElement | null>(null);
watch(
  () => lines.value.length,
  async () => {
    await nextTick();
    outputEl.value?.scrollTo({ top: outputEl.value.scrollHeight });
  },
);
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-2xl' }">
    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <UIcon name="i-lucide-monitor-play" class="size-5 text-primary shrink-0" />
        <h2 class="text-base font-semibold truncate">Run tests locally</h2>
        <UBadge color="neutral" variant="subtle" size="sm"
          >{{ cases.length }} test{{ cases.length === 1 ? '' : 's' }}</UBadge
        >
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <div v-if="!linked" class="space-y-3">
          <p class="text-sm text-muted">
            Link {{ projectLabel || 'this project' }} to its local checkout — the folder that contains these tests. Piwi
            runs that folder's own Playwright with the app's bundled Node, so nothing else needs to be installed.
          </p>
          <UAlert
            v-if="link && !link.exists"
            color="warning"
            variant="soft"
            icon="i-lucide-folder-x"
            title="The linked folder no longer exists"
            :description="link.path"
          />
          <UButton icon="i-lucide-folder-plus" :loading="busy" @click="pickAndLink">Choose folder…</UButton>
        </div>

        <template v-else>
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0 text-sm">
              <UIcon name="i-lucide-folder-check" class="size-4 text-success shrink-0" />
              <code class="text-xs break-all">{{ link?.path }}</code>
            </div>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-folder-search"
              :loading="busy"
              :disabled="running"
              @click="pickAndLink"
            >
              Change
            </UButton>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Select tests by" name="mode">
              <USelect v-model="mode" :items="modeItems" :disabled="running" class="w-full" />
            </UFormField>
            <UFormField label="Browser" name="runMode">
              <USelect v-model="runMode" :items="runModeItems" :disabled="running" class="w-full" />
            </UFormField>
            <UFormField
              label="Repeat each"
              name="repeatEach"
              description="Run every test N times — flake reproduction."
            >
              <UInput v-model.number="repeatEach" type="number" min="1" max="1000" :disabled="running" class="w-full" />
            </UFormField>
            <UFormField label="Trace" name="trace" description="Force trace recording (--trace=on).">
              <USwitch v-model="trace" :disabled="running" />
            </UFormField>
          </div>

          <div class="space-y-1">
            <div class="text-xs text-muted">Runs in the linked folder</div>
            <CodeBlock :code="preview" lang="sh" />
          </div>

          <p class="text-xs text-muted">
            Results are reported by the folder's own Playwright config — with the Piwi reporter set up, the new run
            appears in this app automatically.
          </p>

          <div v-if="status !== 'idle'" class="space-y-2">
            <div ref="outputEl" class="h-64 overflow-y-auto rounded-md bg-zinc-950 p-3">
              <p
                v-for="(line, i) in lines"
                :key="i"
                class="font-mono text-xs whitespace-pre-wrap"
                :class="line.error ? 'text-red-400' : 'text-zinc-300'"
              >
                {{ line.text || ' ' }}
              </p>
            </div>
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full gap-3">
        <UBadge v-if="statusBadge" :color="statusBadge.color" variant="subtle">{{ statusBadge.label }}</UBadge>
        <span v-else />
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">Close</UButton>
          <UButton v-if="running" color="error" icon="i-lucide-square" @click="stop()">Stop</UButton>
          <UButton v-else icon="i-lucide-play" :disabled="!linked || plan.length === 0 || busy" @click="run()">
            {{ status === 'idle' ? 'Run' : 'Run again' }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
