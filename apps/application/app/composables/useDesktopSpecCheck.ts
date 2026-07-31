/**
 * Ask the desktop shell which of a run's spec files the linked folder actually
 * contains. A project linked to the wrong checkout is the likeliest reason a
 * local run dies immediately, and Playwright reports it as a module-resolution
 * stack trace — this check turns that into a warning before anything spawns.
 */
import type { RetryCase } from '~/utils/retry-command';

export function useDesktopSpecCheck(
  projectId: MaybeRefOrGetter<string | number | null | undefined>,
  cases: MaybeRefOrGetter<RetryCase[]>,
) {
  const specFiles = computed(() => [
    ...new Set(
      toValue(cases)
        .map((c) => c.filePath)
        .filter(Boolean),
    ),
  ]);
  const missingSpecs = ref<string[]>([]);

  /** Every spec absent points at the folder rather than at any one test. */
  const wrongFolder = computed(
    () => specFiles.value.length > 0 && missingSpecs.value.length === specFiles.value.length,
  );

  async function checkSpecs(linkedFolderExists: boolean) {
    const core = tauriCore();
    const id = toValue(projectId);
    missingSpecs.value = [];
    if (!core || !linkedFolderExists || id == null || specFiles.value.length === 0) return;
    try {
      const result = await core.invoke<{ folder: string; missing: string[] }>('desktop_check_local_specs', {
        projectId: String(id),
        files: specFiles.value,
      });
      missingSpecs.value = result?.missing ?? [];
    } catch {
      // An older shell without the command — the run itself still reports.
    }
  }

  return { specFiles, missingSpecs, wrongFolder, checkSpecs };
}
