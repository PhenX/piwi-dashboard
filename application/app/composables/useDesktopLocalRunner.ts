/**
 * Drive a local `playwright test` run through the desktop shell.
 *
 * The shell spawns the linked folder's own Playwright with the bundled Node
 * sidecar and streams output back as `piwi:local-run` events. A plan can have
 * several steps (one per Playwright project); they run sequentially and the
 * worst exit code wins. Output lines may arrive before the invoke that started
 * the run resolves with its id, so unattributed events are buffered and
 * replayed once the id is known.
 */
import type { LocalRunStep } from '~/utils/local-run-args';

export type LocalRunnerStatus = 'idle' | 'running' | 'passed' | 'failed' | 'stopped' | 'error';

export interface LocalRunnerLine {
  text: string;
  error: boolean;
}

interface LocalRunEventPayload {
  id: number;
  kind: 'stdout' | 'stderr' | 'error' | 'exit';
  line: string | null;
  code: number | null;
}

/** Output lines kept in memory — a soak run can produce hundreds of thousands. */
const MAX_LINES = 2000;

export function useDesktopLocalRunner() {
  const status = ref<LocalRunnerStatus>('idle');
  const lines = ref<LocalRunnerLine[]>([]);
  const exitCode = ref<number | null>(null);
  const stepIndex = ref(0);
  const stepCount = ref(0);

  const running = computed(() => status.value === 'running');

  let currentRunId: number | null = null;
  let starting = false;
  let stopped = false;
  let pending: LocalRunEventPayload[] = [];
  let unlisten: (() => void) | null = null;
  let resolveExit: ((code: number | null) => void) | null = null;

  function pushLine(text: string, error: boolean) {
    lines.value.push({ text, error });
    if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES);
  }

  function handleEvent(payload: LocalRunEventPayload) {
    if (payload.kind === 'exit') {
      resolveExit?.(payload.code);
      return;
    }
    pushLine(payload.line ?? '', payload.kind !== 'stdout');
  }

  async function ensureListener() {
    if (unlisten) return;
    const events = tauriEvent();
    if (!events) throw new Error('The desktop bridge is unavailable.');
    unlisten = await events.listen<LocalRunEventPayload>('piwi:local-run', ({ payload }) => {
      if (payload.id === currentRunId) {
        handleEvent(payload);
      } else if (starting) {
        pending.push(payload);
      }
    });
  }

  async function runStep(projectId: string | number, step: LocalRunStep): Promise<number | null> {
    const core = tauriCore();
    if (!core) throw new Error('The desktop bridge is unavailable.');
    const exit = new Promise<number | null>((resolve) => {
      resolveExit = resolve;
    });
    starting = true;
    pending = [];
    try {
      currentRunId = await core.invoke<number>('desktop_run_local_tests', {
        projectId: String(projectId),
        args: step.args,
      });
    } finally {
      starting = false;
    }
    for (const event of pending) {
      if (event.id === currentRunId) handleEvent(event);
    }
    pending = [];
    const code = await exit;
    currentRunId = null;
    resolveExit = null;
    return code;
  }

  async function start(projectId: string | number, steps: LocalRunStep[]): Promise<void> {
    if (running.value || steps.length === 0) return;
    stopped = false;
    lines.value = [];
    exitCode.value = null;
    stepCount.value = steps.length;
    stepIndex.value = 0;
    status.value = 'running';
    try {
      await ensureListener();
      let worst: number | null = 0;
      for (const [index, step] of steps.entries()) {
        if (stopped) break;
        stepIndex.value = index;
        if (steps.length > 1) pushLine(`$ ${step.display}`, false);
        const code = await runStep(projectId, step);
        if (stopped) break;
        if (code !== 0) worst = code ?? 1;
      }
      if (stopped) {
        status.value = 'stopped';
      } else {
        exitCode.value = typeof worst === 'number' ? worst : 1;
        status.value = worst === 0 ? 'passed' : 'failed';
      }
    } catch (error) {
      pushLine(errorMessage(error), true);
      status.value = 'error';
    }
  }

  async function stop() {
    if (!running.value) return;
    stopped = true;
    const core = tauriCore();
    const id = currentRunId;
    if (core && id != null) {
      try {
        await core.invoke('desktop_stop_local_tests', { runId: id });
      } catch {
        // The process already exited between the check and the kill.
      }
    }
    // Unblock the awaited step even if no exit event follows the kill.
    resolveExit?.(null);
    status.value = 'stopped';
  }

  onScopeDispose(() => {
    if (running.value) void stop();
    unlisten?.();
    unlisten = null;
  });

  return { status, running, lines, exitCode, stepIndex, stepCount, start, stop };
}
