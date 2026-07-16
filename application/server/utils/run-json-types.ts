import type { BrowserConfig } from '#shared/types';
import type { ServerLogEntry } from '~~/types/api';

/**
 * View-types for the JSON columns on `test_runs` / `test_runs_cases`, covering
 * the fields the server reads. The columns are stored as untyped JSON (`mode:
 * 'json'`), so these provide a typed lens instead of scattered `as any` casts.
 */

export interface TestStepInfo {
  title: string;
  duration?: number;
  category?: string;
  /** Error message when the step failed (undefined when the step passed). */
  error?: { message?: string };
  /** True when the step carried an error — the signal for inline failure markers. */
  failed?: boolean;
  /** Source pointer `file:line:col` (not a code snippet); present on runs from a recent reporter. */
  location?: string;
  /** Absolute start time in ms; present on runs from a recent reporter. */
  startTime?: number;
}

export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp?: number;
  location?: string | null;
}

export interface NetworkRequestEntry {
  method: string;
  url: string;
  status: number;
  duration?: number;
  resourceType?: string;
  contentType?: string;
  startTime?: number;
  serverLogs?: ServerLogEntry[];
}

export interface WebVitals {
  navigation?: { domContentLoaded?: number | null; loadComplete?: number | null } | null;
  paint?: { firstPaint?: number | null; firstContentfulPaint?: number | null } | null;
  vitals?: { lcp?: number | null; cls?: number | null; inp?: number | null } | null;
}

/** SCM block of `test_runs.metadata`. */
export interface RunScmMetadata {
  commit?: string | null;
  branch?: string | null;
  remoteUrl?: string | null;
}

/** `test_runs.metadata` JSON — the fields the server reads. */
export interface RunMetadata {
  scm?: RunScmMetadata | null;
  ci?: { provider?: string | null } | null;
  htmlReport?: { projects?: Array<{ use?: { browserName?: string | null } | null }> } | null;
}

export type { BrowserConfig, ServerLogEntry };
