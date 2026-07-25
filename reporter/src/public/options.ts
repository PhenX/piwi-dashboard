export type { PlaywrightTestConfig } from '@playwright/test';

/**
 * Playwright shard info — mirrors `config.shard` shape.
 *
 * Internal shape: it is NOT re-exported from the package entry point, but it
 * lives here next to the configuration types because it describes the same
 * `config.shard` surface the options come from. May move to `types/wire.ts`.
 */
export interface ShardInfo {
  current: number;
  total: number;
}

/**
 * Options for configuring the Piwi Dashboard reporter.
 *
 * Piwi options only — the Playwright config belongs in `defineConfig` (i.e. in
 * `wrapConfig`'s first argument). These go in `wrapConfig`'s second argument or
 * in the reporter entry's options (`['@piwitests/reporter', { … }]`).
 */
export interface PiwiDashboardOptions {
  /** Explicitly enable or disable the reporter. Defaults to `true` when `serverUrl` is set. Set to `false` to disable even if `serverUrl` is provided. */
  enabled?: boolean;
  /** URL of the Piwi Dashboard server */
  serverUrl?: string;
  /** Name of the project to report results under. Defaults to `'default-project'`. */
  projectName?: string;
  /** Optional description of the project */
  projectDescription?: string;
  /** Upload trace files to the dashboard. Defaults to `true`. */
  uploadTraces?: boolean;
  /** Upload the Playwright HTML report. Defaults to `true`. */
  uploadReport?: boolean;
  /** Upload each test's trace and attachments as soon as the test finishes (streaming mode only). Defaults to `true`. */
  liveFileUploads?: boolean;
  /** Auto-collect git commit, branch, author. Defaults to `true`. */
  collectScmInfo?: boolean;
  /** Auto-collect CI environment info. Defaults to `true`. */
  collectCiInfo?: boolean;
  /** Collect step timings, network requests and web vitals. Defaults to `true`. */
  collectPerformanceMetrics?: boolean;
  /**
   * Capture per-action locator snapshots that power failure-time healing
   * suggestions. Adds a small per-action cost (one DOM read, sometimes an ARIA
   * snapshot) in the test worker. Defaults to `true`; automatically disabled
   * when `collectPerformanceMetrics` is `false` (the reporter discards the data
   * in that case anyway). Can also be forced off with `PIWI_CAPTURE_LOCATORS=false`.
   */
  captureLocators?: boolean;
  /**
   * Capture the page's state at test end (URL, history state, localStorage/
   * sessionStorage key names + value lengths, cookie names + flags). Values of
   * storage entries and cookies are never captured. Defaults to `true`;
   * automatically disabled when `collectPerformanceMetrics` is `false`. Can
   * also be forced off with `PIWI_CAPTURE_PAGE_STATE=false`.
   */
  capturePageState?: boolean;
  /**
   * Capture server-side spans for each API/document request the test makes,
   * read from the `X-Piwi-Trace` response header emitted by a Piwi
   * instrumentation plugin (e.g. `@piwitests/instrumentation`). The spans show
   * up next to the network request in the dashboard and feed AI diagnosis. Free
   * when no instrumentation is present (the header is simply absent). Defaults
   * to `true`; automatically disabled when `collectPerformanceMetrics` is
   * `false`. Can also be forced off with `PIWI_CAPTURE_SERVER_TRACES=false`.
   */
  captureServerTraces?: boolean;
  /**
   * Open Piwi's own failure-time overlay on the failing page — for inspecting
   * the page and picking a locator for any element (click an element → confirm
   * a ranked replacement locator). This is Piwi's own in-page overlay, not
   * Playwright's native inspector, so a confirmed pick flows back into the
   * dashboard. `pickLocatorOnFailure` opens the same overlay targeted at the
   * broken locator; this opens it for the whole page. Local debugging aid: only
   * takes effect in a headed browser (`headless: false` / `--headed`), never
   * under CI, and only on a test's final attempt when retries are configured.
   * The run waits until the overlay is resolved. Defaults to `false`. Can also
   * be enabled with `PIWI_INSPECT_ON_FAIL=true`.
   */
  inspectOnFailure?: boolean;
  /**
   * Open Piwi's locator picker on the failing page when a locator action
   * fails: click the element the locator should have matched, confirm one of
   * the ranked replacement locators generated for it, and the choice is
   * recorded — folded into the run's locator snapshots (so the dashboard's
   * healing panel shows it) and attached as `piwi-user-pick` with a report
   * annotation. Same gate as `inspectOnFailure`: headed browser only, never
   * under CI, final attempt only. Defaults to `false`. Can also be enabled
   * with `PIWI_PICK_LOCATOR_ON_FAIL=true`.
   */
  pickLocatorOnFailure?: boolean;
  /** Enable live streaming of results (falls back to batch if unsupported). Defaults to `true`. */
  streaming?: boolean;
  /** Number of test results to batch before sending during streaming. Defaults to `5`. */
  streamingBatchSize?: number;
  /** Max delay (ms) before flushing pending events during streaming. Defaults to `2000`. */
  streamingBatchDelay?: number;
  /** Username for dashboard login (use `apiKey` instead when possible) */
  username?: string | null;
  /** Password for dashboard login (used with `username`) */
  password?: string | null;
  /** API key for authentication (preferred over `username`/`password` for CI) */
  apiKey?: string | null;
  /** Additional report types to upload. Each entry can specify `type`, optional `dir`, and optional `label`. */
  reports?: Array<{ type: string; dir?: string; label?: string }>;
  /** Stable label that ties shards together (e.g. CI run ID). Auto-detected from CI env; override if needed. */
  runLabel?: string;
  /** Deployment environment for this run, e.g. `"production"`, `"staging"`, `"integration"` */
  environment?: string;
  /** Optional display label for the test run (e.g. "v2.3.1 release") */
  label?: string;
  /** Related issue reference, e.g. `"JIRA-123"` */
  relatedIssue?: string;
  /** CI job information */
  ciInfo?: string;
  /** Tags to categorize the test run */
  tags?: string[];
  /** Additional custom metadata as key-value pairs */
  customData?: Record<string, unknown>;
  /**
   * Write a JSON file with the submitted run's dashboard URL, id, project id and
   * status after the run lands, so a CI pipeline can consume it (e.g. feed the
   * run URL into a custom email step). Any CI can read the file. GitHub Actions
   * step outputs / job summary and GitLab dotenv reports are emitted
   * automatically when running under those systems, regardless of this option.
   * Can also be set with `PIWI_OUTPUT_FILE`.
   */
  outputFile?: string;
  /** Enable verbose logging for debugging. Defaults to `false`. */
  verbose?: boolean;
}
