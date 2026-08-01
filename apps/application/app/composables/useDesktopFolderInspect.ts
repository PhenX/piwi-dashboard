/**
 * Read-only inspection of a folder on this machine (desktop shell only): the
 * Piwi project name it would report under and whether Playwright and the
 * `@piwitests/reporter` package are set up. Backs "new project from a folder"
 * and the setup status shown next to a project's linked folder. Every helper
 * feature-detects the IPC bridge and resolves `null` in a plain browser.
 */

export interface DesktopFolderInspection {
  path: string;
  exists: boolean;
  packageName: string | null;
  /** Name the folder would report under: config `projectName` → package name → folder name. */
  suggestedName: string | null;
  /** File name of the Playwright config found at the folder root. */
  playwrightConfig: string | null;
  playwrightInstalled: boolean;
  reporterInstalled: boolean;
  /** The Playwright config references `@piwitests/reporter`. */
  reporterConfigured: boolean;
  /** `projectName` parsed out of the Playwright config, when set as a literal. */
  configuredProjectName: string | null;
}

/** Open the native folder picker. `null` on cancel or without the bridge. */
export async function pickDesktopFolder(): Promise<string | null> {
  const core = tauriCore();
  if (!core) return null;
  return await core.invoke<string | null>('desktop_pick_folder');
}

/** Inspect an absolute folder path; `null` without the bridge or on failure. */
export async function inspectDesktopFolder(path: string): Promise<DesktopFolderInspection | null> {
  const core = tauriCore();
  if (!core || !path) return null;
  try {
    return await core.invoke<DesktopFolderInspection>('desktop_inspect_folder', { path });
  } catch {
    return null;
  }
}

/** A folder is ready when Playwright and the reporter are installed and wired up. */
export function isFolderPiwiReady(inspection: DesktopFolderInspection | null): boolean {
  return (
    !!inspection &&
    inspection.exists &&
    inspection.playwrightConfig != null &&
    inspection.playwrightInstalled &&
    inspection.reporterInstalled &&
    inspection.reporterConfigured
  );
}
