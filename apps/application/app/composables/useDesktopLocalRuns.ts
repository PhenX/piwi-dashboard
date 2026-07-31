/**
 * App-wide registry of local `playwright test` runs driven through the desktop
 * shell.
 *
 * The shell spawns the linked folder's own Playwright with the bundled Node
 * sidecar and streams output back as `piwi:local-run` events; each spawned step
 * carries a shell-assigned id so concurrent runs stay apart. Runs live here —
 * not in any component — so they survive navigation and dialog closes; the
 * runs tray and the run-locally button both render from this store. Stopping a
 * run is always an explicit action, never a side effect of closing UI.
 *
 * A run's plan can have several steps (one per Playwright project); they run
 * sequentially and the worst exit code wins. Output lines may arrive before
 * the invoke that started a step resolves with its id, so unattributed events
 * are buffered and replayed once the id is known.
 *
 * Options are remembered per project (localStorage) so the button's primary
 * click repeats the last configuration without a dialog.
 */
import { buildLocalRunPlan, type LocalRunMode, type LocalRunOptions, type LocalRunStep } from '~/utils/local-run-args';
import type { RetryCase, RetryMode } from '~/utils/retry-command';

export type LocalRunStatus = 'running' | 'passed' | 'failed' | 'stopped' | 'error';

/** Options as stored per project — every field resolved to a concrete value. */
export type SavedLocalRunOptions = Required<LocalRunOptions>;

export interface LocalRunLine {
  text: string;
  error: boolean;
}

export interface LocalRun {
  /** Store-unique key — not the shell's per-step run id. */
  key: number;
  projectId: string;
  projectLabel: string | null;
  /** The cases the run was built from — kept so the tray can re-run it. */
  cases: RetryCase[];
  options: SavedLocalRunOptions;
  steps: LocalRunStep[];
  stepIndex: number;
  status: LocalRunStatus;
  lines: LocalRunLine[];
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  /** Shell id of the step currently spawned, for stopping it. */
  shellId: number | null;
  stopRequested: boolean;
  /** Tests announced by Playwright's "Running N tests" lines, across steps. */
  progressTotal: number | null;
  /** Per-test result lines seen so far. */
  progressDone: number;
  /** The Piwi run this local process produced, once the reporter checked in. */
  piwiRunId: number | null;
  /** Latest Piwi run id for the project at spawn — anything newer is ours. */
  piwiRunBaseline: number | null;
}

/** Live label for a running run — test counts when Playwright announced them. */
export function localRunProgressLabel(run: LocalRun): string {
  if (run.progressTotal) return `Running ${run.progressDone}/${run.progressTotal}…`;
  return run.steps.length > 1 ? `Running ${run.stepIndex + 1}/${run.steps.length}…` : 'Running…';
}

export const DEFAULT_LOCAL_RUN_OPTIONS: SavedLocalRunOptions = {
  mode: 'file-line',
  runMode: 'normal',
  trace: false,
  repeatEach: 1,
};

export const LOCAL_RUN_MODE_ITEMS: { label: string; value: LocalRunMode; icon: string }[] = [
  { label: 'Headless', value: 'normal', icon: 'i-lucide-square-terminal' },
  { label: 'Headed', value: 'headed', icon: 'i-lucide-app-window' },
  { label: 'Debug (inspector)', value: 'debug', icon: 'i-lucide-bug' },
  { label: 'UI mode', value: 'ui', icon: 'i-lucide-layout-grid' },
];

export const RETRY_MODE_ITEMS: { label: string; value: RetryMode }[] = [
  { label: 'File:line', value: 'file-line' },
  { label: 'Title (grep)', value: 'grep' },
  { label: 'File only', value: 'file' },
];

interface LocalRunEventPayload {
  id: number;
  kind: 'stdout' | 'stderr' | 'error' | 'exit';
  line: string | null;
  code: number | null;
}

/** Output lines kept per run — a soak run can produce hundreds of thousands. */
const MAX_LINES = 2000;
/** Finished runs kept in the tray; running ones are never dropped. */
const MAX_FINISHED = 15;
const OPTIONS_STORAGE_KEY = 'piwi:desktop-local-run-options';

// Client-only plumbing shared by every composable instance. Runs are driven
// from event handlers after mount, so none of this exists on the server.
let nextKey = 1;
let unlisten: (() => void) | null = null;
let startingSteps = 0;
let pendingEvents: LocalRunEventPayload[] = [];
const runByShellId = new Map<number, LocalRun>();
const exitResolvers = new Map<number, (code: number | null) => void>();
let toastApi: ReturnType<typeof useToast> | null = null;
let routerApi: ReturnType<typeof useRouter> | null = null;
let optionsLoaded = false;

// Playwright's list reporter, as the shell captures it (plain, non-TTY): a
// "Running N tests using M workers" announcement per step, then one line per
// finished test starting with a result mark (✓/✘ or the ASCII fallbacks).
const PROGRESS_TOTAL_RE = /^Running (\d+) tests? using \d+ workers?$/;
const PROGRESS_RESULT_RE = /^\s{1,6}(?:✓|✘|✗|x|ok|-)\s+\d+\s/;

export function useDesktopLocalRuns() {
  const runs = useState<LocalRun[]>('desktop-local-runs', () => []);
  const trayOpen = useState<boolean>('desktop-local-runs-tray', () => false);
  const optionsByProject = useState<Record<string, SavedLocalRunOptions>>('desktop-local-run-options', () => ({}));
  if (import.meta.client) {
    toastApi = useToast();
    routerApi = useRouter();
  }

  const activeCount = computed(() => runs.value.filter((r) => r.status === 'running').length);

  function loadOptions() {
    if (optionsLoaded || !import.meta.client) return;
    optionsLoaded = true;
    try {
      const raw = localStorage.getItem(OPTIONS_STORAGE_KEY);
      if (raw) optionsByProject.value = JSON.parse(raw);
    } catch {
      // Corrupt or unavailable storage — defaults apply.
    }
  }

  function getProjectOptions(projectId: string | number): SavedLocalRunOptions {
    loadOptions();
    return { ...DEFAULT_LOCAL_RUN_OPTIONS, ...optionsByProject.value[String(projectId)] };
  }

  function saveProjectOptions(projectId: string | number, patch: LocalRunOptions) {
    loadOptions();
    const next = { ...getProjectOptions(projectId), ...patch };
    optionsByProject.value = { ...optionsByProject.value, [String(projectId)]: next };
    try {
      localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(optionsByProject.value));
    } catch {
      // Storage full or unavailable — options just won't persist.
    }
  }

  function pushLine(run: LocalRun, text: string, error: boolean) {
    run.lines.push({ text, error });
    if (run.lines.length > MAX_LINES) run.lines.splice(0, run.lines.length - MAX_LINES);
    if (error) return;
    const total = PROGRESS_TOTAL_RE.exec(text);
    if (total) {
      run.progressTotal = (run.progressTotal ?? 0) + Number(total[1]);
    } else if (PROGRESS_RESULT_RE.test(text)) {
      // Retried tests print extra result lines, so clamp to the announced total.
      run.progressDone = Math.min(run.progressDone + 1, run.progressTotal ?? run.progressDone + 1);
    }
  }

  function dispatch(run: LocalRun, payload: LocalRunEventPayload) {
    if (payload.kind === 'exit') {
      exitResolvers.get(payload.id)?.(payload.code);
      return;
    }
    pushLine(run, payload.line ?? '', payload.kind !== 'stdout');
  }

  async function ensureListener() {
    if (unlisten) return;
    const events = tauriEvent();
    if (!events) throw new Error('The desktop bridge is unavailable.');
    unlisten = await events.listen<LocalRunEventPayload>('piwi:local-run', ({ payload }) => {
      const run = runByShellId.get(payload.id);
      if (run) dispatch(run, payload);
      else if (startingSteps > 0) pendingEvents.push(payload);
    });
  }

  async function runStep(run: LocalRun, step: LocalRunStep): Promise<number | null> {
    const core = tauriCore();
    if (!core) throw new Error('The desktop bridge is unavailable.');
    startingSteps += 1;
    let shellId: number;
    try {
      shellId = await core.invoke<number>('desktop_run_local_tests', {
        projectId: run.projectId,
        args: step.args,
      });
    } catch (error) {
      startingSteps -= 1;
      throw error;
    }
    // Same tick as the invoke resolution: register the id, replay buffered
    // events for it, then release the buffer — no event can slip through.
    const exit = new Promise<number | null>((resolve) => exitResolvers.set(shellId, resolve));
    runByShellId.set(shellId, run);
    run.shellId = shellId;
    const mine = pendingEvents.filter((p) => p.id === shellId);
    pendingEvents = startingSteps > 1 ? pendingEvents.filter((p) => p.id !== shellId) : [];
    startingSteps -= 1;
    for (const payload of mine) dispatch(run, payload);
    const code = await exit;
    runByShellId.delete(shellId);
    exitResolvers.delete(shellId);
    run.shellId = null;
    return code;
  }

  async function drive(run: LocalRun) {
    try {
      await ensureListener();
      let worst: number | null = 0;
      for (const [index, step] of run.steps.entries()) {
        if (run.stopRequested) break;
        run.stepIndex = index;
        if (run.steps.length > 1) pushLine(run, `$ ${step.display}`, false);
        const code = await runStep(run, step);
        if (run.stopRequested) break;
        if (code !== 0) worst = code ?? 1;
      }
      if (run.stopRequested) {
        run.status = 'stopped';
      } else {
        run.exitCode = typeof worst === 'number' ? worst : 1;
        run.status = worst === 0 ? 'passed' : 'failed';
      }
    } catch (error) {
      pushLine(run, errorMessage(error), true);
      run.status = 'error';
    } finally {
      run.finishedAt = Date.now();
      notifyFinished(run);
      trimFinished();
    }
  }

  function notifyFinished(run: LocalRun) {
    if (run.status === 'stopped') return;
    const label = run.projectLabel || 'Local run';
    const tests = `${run.cases.length} test${run.cases.length === 1 ? '' : 's'}`;
    const seconds = Math.max(1, Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000));
    const viewOutput = {
      label: 'View output',
      color: 'neutral' as const,
      variant: 'outline' as const,
      onClick: () => {
        trayOpen.value = true;
      },
    };
    const openPiwiRun =
      run.piwiRunId == null
        ? []
        : [
            {
              label: `Open run #${run.piwiRunId}`,
              color: 'neutral' as const,
              variant: 'outline' as const,
              onClick: () => {
                void routerApi?.push(`/test-runs/${run.piwiRunId}`);
              },
            },
          ];
    if (run.status === 'passed') {
      toastApi?.add({
        title: 'Local run passed',
        description: `${label} — ${tests} in ${seconds}s`,
        icon: 'i-lucide-check',
        color: 'success',
        actions: [viewOutput, ...openPiwiRun],
      });
    } else if (run.status === 'failed') {
      toastApi?.add({
        title: 'Local run failed',
        description: `${label} — exit ${run.exitCode ?? 1} after ${seconds}s`,
        icon: 'i-lucide-x',
        color: 'error',
        actions: [viewOutput, ...openPiwiRun],
      });
    } else {
      toastApi?.add({
        title: 'Local run could not start',
        description: run.lines.findLast((l) => l.error)?.text,
        icon: 'i-lucide-triangle-alert',
        color: 'error',
        actions: [viewOutput],
      });
    }
  }

  function trimFinished() {
    const finished = runs.value.filter((r) => r.status !== 'running');
    if (finished.length <= MAX_FINISHED) return;
    const drop = new Set(finished.slice(MAX_FINISHED).map((r) => r.key));
    runs.value = runs.value.filter((r) => !drop.has(r.key));
  }

  /**
   * Build the plan from the given cases and spawn it. Options fall back to the
   * project's saved ones and the merged result is saved back, so the next
   * one-click run repeats this configuration. Returns the tracked run, or
   * `null` when there is nothing to spawn.
   */
  function startRun(input: {
    projectId: string | number;
    projectLabel?: string | null;
    cases: RetryCase[];
    options?: LocalRunOptions;
  }): LocalRun | null {
    if (!tauriCore() || input.cases.length === 0) return null;
    const options = { ...getProjectOptions(input.projectId), ...input.options };
    const steps = buildLocalRunPlan(input.cases, options);
    if (steps.length === 0) return null;
    saveProjectOptions(input.projectId, options);
    const run: LocalRun = {
      key: nextKey++,
      projectId: String(input.projectId),
      projectLabel: input.projectLabel ?? null,
      cases: input.cases.map((c) => ({ ...c })),
      options,
      steps,
      stepIndex: 0,
      status: 'running',
      lines: [],
      exitCode: null,
      startedAt: Date.now(),
      finishedAt: null,
      shellId: null,
      stopRequested: false,
      progressTotal: null,
      progressDone: 0,
      piwiRunId: null,
      piwiRunBaseline: null,
    };
    runs.value = [run, ...runs.value];
    // Mutations must go through the reactive proxy the array hands back, not
    // the plain object above — the tray and button render from it live.
    const tracked = runs.value[0]!;
    trayOpen.value = true;
    void captureBaseline(tracked);
    void drive(tracked);
    return tracked;
  }

  /**
   * Record the project's newest Piwi run id before our process can report:
   * any run the server announces later with a higher id is the one this local
   * process produced (the reporter finds the app via `~/.piwi/desktop.json`).
   */
  async function captureBaseline(run: LocalRun) {
    try {
      const latest = await $fetch<{ id: number } | null>(`/api/projects/${run.projectId}/latest-run`);
      run.piwiRunBaseline = latest?.id ?? 0;
    } catch {
      // Unknown baseline — this run just won't get a Piwi link.
    }
  }

  /**
   * Match local processes to the Piwi runs they produced. Driven by the shared
   * SSE stream (the tray subscribes), so the link appears as soon as the
   * reporter checks in.
   */
  async function correlatePiwiRuns() {
    const cutoff = Date.now() - 2 * 60_000;
    for (const run of runs.value) {
      if (run.piwiRunId != null || run.piwiRunBaseline == null) continue;
      if (run.status !== 'running' && (run.finishedAt ?? 0) < cutoff) continue;
      try {
        const latest = await $fetch<{ id: number } | null>(`/api/projects/${run.projectId}/latest-run`);
        if (latest && latest.id > run.piwiRunBaseline) run.piwiRunId = latest.id;
      } catch {
        // Server briefly unavailable — the next stream event retries.
      }
    }
  }

  function rerun(run: LocalRun): LocalRun | null {
    return startRun({
      projectId: run.projectId,
      projectLabel: run.projectLabel,
      cases: run.cases,
      options: run.options,
    });
  }

  async function stopRun(run: LocalRun) {
    if (run.status !== 'running') return;
    run.stopRequested = true;
    const core = tauriCore();
    const shellId = run.shellId;
    if (core && shellId != null) {
      try {
        await core.invoke('desktop_stop_local_tests', { runId: shellId });
      } catch {
        // The process already exited between the check and the kill.
      }
      // Unblock the awaited step even if no exit event follows the kill.
      exitResolvers.get(shellId)?.(null);
    }
  }

  function clearFinished() {
    runs.value = runs.value.filter((r) => r.status === 'running');
  }

  /** Newest run for a project — what the button reflects. */
  function latestForProject(projectId: string | number | null | undefined): LocalRun | undefined {
    if (projectId == null) return undefined;
    const id = String(projectId);
    return runs.value.find((r) => r.projectId === id);
  }

  return {
    runs,
    trayOpen,
    activeCount,
    startRun,
    rerun,
    stopRun,
    clearFinished,
    latestForProject,
    getProjectOptions,
    saveProjectOptions,
    correlatePiwiRuns,
  };
}
