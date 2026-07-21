/**
 * Shared types for API responses and requests
 * These types are used by both the server API and the app frontend
 */

import type { Role, FilterDetails, TestSourceFrame } from '#shared/types';
export type { TestSourceFrame };

// ============================================================================
// Metadata types
// ============================================================================

/**
 * SCM (source control) metadata attached to a test run
 */
export interface TestRunScmMetadata {
  commit?: string | null;
  branch?: string | null;
  author?: string | null;
  commitMessage?: string | null;
}

/**
 * CI metadata attached to a test run
 */
export interface TestRunCiMetadata {
  provider?: string | null;
  buildNumber?: string | null;
  buildUrl?: string | null;
  jobName?: string | null;
  workflow?: string | null;
}

/**
 * Metadata attached to a test run
 */
export interface TestRunMetadata {
  scm?: TestRunScmMetadata;
  ci?: TestRunCiMetadata;
  projectDescription?: string | null;
  relatedIssue?: string | null;
  tags?: string[];
  customData?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================================================
// Report types (API responses)
// ============================================================================

/**
 * Report attached to a test run
 */
export interface ReportInfo {
  id: number;
  type: string;
  label: string;
  path: string;
  size?: number | null;
}

// ============================================================================
// Tag types (API responses)
// ============================================================================

/**
 * Tag used to label projects
 */
export interface TagInfo {
  id: number;
  text: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tags response from API
 */
export interface TagsResponse {
  tags: TagInfo[];
}

// ============================================================================
// Marker types (project timeline markers / events)
// ============================================================================

/**
 * A dated timeline marker for a project (deploy, config change, incident, ...).
 */
export interface MarkerInfo {
  id: number;
  projectId: number;
  occurredAt: string | Date;
  label: string;
  description: string | null;
  category: string;
  environment: string | null;
  source: string; // 'manual' | 'auto'
  runId: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/**
 * Markers response from API
 */
export interface MarkersResponse {
  markers: MarkerInfo[];
}

// ============================================================================
// Period and Range types (used for filtering and date range selection)
// ============================================================================

export type Period = '1d' | '7d' | '30d' | '90d' | '1y' | 'daily' | 'weekly' | 'monthly';

export interface Range {
  start: Date;
  end: Date;
}

// ============================================================================
// Project types (API responses)
// ============================================================================

/**
 * Slim project entry for sidebar navigation - returned by GET /api/projects/menu
 */
export interface ProjectMenuItem {
  id: number;
  name: string;
  label: string | null;
}

/**
 * Project with statistics - returned by GET /api/projects
 */
export interface ProjectWithStats {
  id: number;
  name: string;
  label?: string | null;
  description?: string | null;
  tags?: TagInfo[];
  createdAt: Date;
  updatedAt: Date;
  // Statistics added by API
  latestRun?: {
    id: number;
    status: string;
    startTime: string | Date;
    duration?: number | null;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    didNotRunTests: number;
    flakyTests: number;
    totalTests: number;
    reports?: ReportInfo[];
    avgTestDuration?: number | null;
    p90TestDuration?: number | null;
    metadata: TestRunMetadata;
  } | null;
  totalRuns: number;
  totalTestCases: number;
}

/**
 * A single run entry in a project overview (slim, for trend bars)
 */
export interface ProjectOverviewRun {
  id: number;
  status: string;
  passedTests: number;
  failedTests: number;
  flakyTests: number;
  totalTests: number;
  startTime: string | Date;
  environment?: string | null;
}

/**
 * Per-project overview with trend data - returned by GET /api/projects/overview
 */
export interface ProjectOverview {
  id: number;
  name: string;
  label: string | null;
  tags: TagInfo[];
  totalFullRuns: number;
  latestFullRun: {
    id: number;
    status: string;
    startTime: string | Date;
    duration: number | null;
    passedTests: number;
    failedTests: number;
    flakyTests: number;
    totalTests: number;
  } | null;
  recentRuns: ProjectOverviewRun[];
  tendency: 'passing' | 'flaky' | 'failing' | 'unknown';
}

/**
 * Project with test runs - returned by GET /api/projects/[id]
 */
export interface ProjectWithTestRuns {
  id: number;
  name: string;
  label?: string | null;
  description?: string | null;
  color?: string | null;
  tags?: TagInfo[];
  createdAt: Date;
  updatedAt: Date;
  testRuns: TestRunSummary[];
}

/**
 * Project details for editing - used in edit forms
 */
export interface ProjectDetails {
  id: number;
  name: string;
  label?: string | null;
  description?: string | null;
  diagnosisInstructions?: string | null;
  hasScmToken: boolean;
  color?: string | null;
  tags?: TagInfo[];
}

// ============================================================================
// Test Run types (API responses)
// ============================================================================

/**
 * Test run summary (without test cases)
 */
export interface TestRunSummary {
  id: number;
  projectId: number;
  status: string;
  startTime: string | Date;
  duration?: number | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests: number;
  flakyTests: number;
  avgTestDuration?: number | null;
  p90TestDuration?: number | null;
  reports?: ReportInfo[];
  browsers?: string[];
  environment?: string | null;
  label?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any | null;
  isFullRun?: boolean;
  filterDetails?: FilterDetails | null;
  createdAt: Date;
}

/**
 * Test run with full details - returned by GET /api/test-runs/[id]
 */
export interface TestRunDetails {
  id: number;
  projectId: number;
  status: string;
  startTime: string | Date;
  duration?: number | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests: number;
  flakyTests: number;
  avgTestDuration?: number | null;
  p90TestDuration?: number | null;
  shardTotal?: number | null;
  shardsFinished?: number;
  isFullRun?: boolean;
  filterDetails?: FilterDetails | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any | null;
  setupSteps?: SetupStepEvent[] | null;
  environment?: string | null;
  label?: string | null;
  playwrightVersion?: string | null;
  reporterVersion?: string | null;
  createdAt: Date;
  project?: {
    id: number;
    name: string;
    label?: string | null;
    latestRunId?: number | null;
    latestRunStatus?: string | null;
  };
  reports?: ReportInfo[];
  testCases?: TestCaseResult[];
  suites?: SuiteInfo[];
  storageStats?: {
    totalFiles: number;
    totalSize: number;
    reportSizes: Array<{ label: string; size: number }>;
    testCaseFilesSize: number;
    testCaseFilesCount: number;
  };
  links?: EntityLinkInfo[];
  /** Effective allowlist of glob patterns classifying waits as wasted time. */
  wastedWaitPatterns?: string[];
  /** Nearest timeline marker at or before this run's start (matching env or global), if any. */
  precedingMarker?: MarkerInfo | null;
}

/**
 * Lightweight test run summary for comparison pages — omits heavy JSON blobs
 * returned by GET /api/test-runs/[id]/summary
 */
export interface TestRunForCompare {
  id: number;
  status: string;
  totalTests: number;
  testCases: Array<{
    title: string;
    status: string;
    duration?: number | null;
    location?: string;
  }>;
}

/**
 * Test run for charts and visualization
 */
export interface TestRunForChart {
  id: number;
  projectId?: number;
  projectName?: string;
  projectLabel?: string | null;
  status: string;
  startTime: string | Date;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests: number;
  flakyTests: number;
  totalTests: number;
  duration?: number | null;
  avgTestDuration?: number | null;
  p90TestDuration?: number | null;
  isFullRun?: boolean;
  environment?: string | null;
}

// ============================================================================
// Performance types
// ============================================================================

/**
 * A single step recorded during test execution
 */
export interface PerformanceStep {
  title: string;
  duration: number;
  category: string;
  /** Error message when the step failed (undefined when the step passed). */
  error?: { message?: string };
  /** True when the step failed. */
  failed?: boolean;
  /** Source pointer `file:line:col` (not a code snippet); present on runs from a recent reporter. */
  location?: string;
  /** Absolute start time in ms; present on runs from a recent reporter. Enables per-step timing. */
  startTime?: number;
}

/**
 * A hook/fixture step event with absolute timing, used by WorkersTimeline
 * to render segments alongside the test case bar.
 */
export interface TestStepEvent {
  title: string;
  category: 'hook' | 'fixture' | 'test.step' | 'expect' | 'wait';
  startedAt: number;
  duration: number;
  status: string;
  location?: string | null;
}

/**
 * A suite-level setup step (beforeAll/afterAll) attached to a test run. Unlike
 * per-test step events it is not tied to a test case, so the reporter records
 * which worker it ran on.
 */
export interface SetupStepEvent extends TestStepEvent {
  workerIndex?: number | null;
}

export interface ServerLogEntry {
  timestamp: number;
  level: string;
  category: string;
  message: string;
  stack?: string;
}

/**
 * A server-side span captured for a request via the `X-Piwi-Trace` header (from
 * a Piwi instrumentation plugin). Mirrors the reporter/plugin `PiwiServerSpan`
 * shape; the root span carries `traceId` and `attrs.http.*`.
 */
export interface ServerSpanEntry {
  id: string;
  parentId?: string;
  name: string;
  kind?: string;
  startMs: number;
  durMs: number;
  status?: string;
  traceId?: string;
  attrs?: Record<string, string | number | boolean>;
}

/**
 * A single network request recorded during test execution (via dashboard fixture)
 */
export interface NetworkRequest {
  method: string;
  url: string;
  status: number;
  duration: number;
  resourceType: string;
  contentType?: string | null;
  startTime?: number;
  serverLogs?: ServerLogEntry[];
  serverTraces?: ServerSpanEntry[];
}

/** One frame of the trace-derived full call stack (innermost first). */
export interface TraceStackFrame {
  /** Display path — project-relative when derivable, shortened otherwise. */
  file: string;
  /** Original absolute path from the runner machine, when it differs from `file`. */
  absFile?: string;
  line: number;
  column?: number;
  functionName?: string;
  inProject: boolean;
  /** Window of the embedded source around `line`; null when the trace carries no source for this file. */
  source?: { startLine: number; lines: string[]; totalLines: number } | null;
}

/** `GET /api/test-runs/:id/cases/:caseId/trace-stacks` */
export interface TraceCallStackResponse {
  status: 'ok' | 'no-trace' | 'no-stacks';
  frames?: TraceStackFrame[];
  /** False when the trace was recorded without embedded sources — frames render header-only. */
  hasSources?: boolean;
  /** The action whose stack is shown (normally the failing action). */
  apiName?: string;
  errorMessage?: string;
}

/** One request from the trace's HAR-like network stream (headers masked server-side). */
export interface TraceNetworkEntry {
  index: number;
  method: string;
  url: string;
  /** HTTP status; <= 0 means the request failed or was aborted before a response. */
  status: number;
  statusText?: string;
  failureText?: string;
  resourceType?: string;
  mimeType?: string;
  requestHeaders: Array<{ name: string; value: string }>;
  responseHeaders: Array<{ name: string; value: string }>;
  requestBodySize?: number;
  responseBodySize?: number;
  transferSize?: number;
  /** Milliseconds relative to the first request in the trace. */
  start: number;
  duration: number;
  timings?: { dns?: number; connect?: number; ssl?: number; send?: number; wait?: number; receive?: number };
  /** True when the request overlaps the failing action's time window. */
  duringFailure: boolean;
  failed: boolean;
  /** Content-addressed name of the stored response body, fetchable via the trace-network-body endpoint. */
  bodySha1?: string | null;
  bodyPreviewable?: boolean;
  /** Masked, capped request post data. */
  requestPostData?: string | null;
}

/** `GET /api/test-runs/:id/cases/:caseId/trace-network` */
export interface TraceNetworkResponse {
  status: 'ok' | 'no-trace' | 'empty';
  requests?: TraceNetworkEntry[];
  /** Total waterfall span in ms (relative timeline). */
  timelineDuration?: number;
  /** Failing action's window on the same relative timeline, for shading. */
  failingWindow?: { start: number; end: number } | null;
  truncated?: boolean;
  totalBeforeCap?: number;
}

/** `GET /api/test-runs/:id/cases/:caseId/trace-network-body?sha1=` */
export interface TraceBodyResponse {
  status: 'ok' | 'not-found' | 'too-large' | 'unsupported';
  kind?: 'json' | 'text' | 'image';
  /** Masked, capped textual body (kind json/text). */
  content?: string;
  /** Inline image payload (kind image). */
  dataUri?: string;
  mimeType?: string;
  size?: number;
  truncated?: boolean;
}

/**
 * Browser performance / web vitals recorded via dashboard fixture
 */
export interface WebVitals {
  navigation?: {
    url: string;
    ttfb: number;
    domInteractive: number;
    domContentLoaded: number;
    loadComplete: number;
    transferSize?: number;
    encodedBodySize?: number;
    decodedBodySize?: number;
  } | null;
  paint?: {
    firstPaint?: number;
    firstContentfulPaint?: number;
  } | null;
  /** Core Web Vitals (Chromium-only; null per metric when unavailable). */
  vitals?: {
    lcp?: number | null;
    cls?: number | null;
    inp?: number | null;
  } | null;
}

/**
 * Page state captured at test end by the reporter fixtures. Storage values and
 * cookie values are never captured — key names, lengths and flags only.
 */
export interface PageState {
  url: string;
  hash: string | null;
  /** `history.state` as JSON, capped and token-masked. */
  historyState: string | null;
  localStorage: Array<{ key: string; length: number }>;
  sessionStorage: Array<{ key: string; length: number }>;
  cookies: Array<{
    name: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: string;
    expires?: number;
  }>;
}

/**
 * A single console message captured during test execution (via dashboard fixture)
 */
export interface ConsoleEntry {
  type: string;
  text: string;
  timestamp: number;
  location?: string | null;
}

/**
 * Grouped endpoint summary returned by GET /api/test-runs/[id]/network-requests
 */
export interface EndpointSummary {
  method: string;
  route: string;
  count: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  p90Duration: number;
  errorRate: number;
  testCases: string[];
}

// ============================================================================
// Test Case types (API responses)
// ============================================================================

/**
 * Suite (describe block) info — returned as a flat list alongside test cases,
 * one entry per unique describe path across all files in the run.
 */
export interface SuiteInfo {
  filePath: string;
  suitePath: string[];
  mode: string;
  annotations: Array<{ type: string; description?: string }>;
}

/**
 * Test case result (for a specific test run)
 */
export interface TestCaseResult {
  id: number;
  title: string;
  filePath?: string;
  suitePath?: string[];
  testAnnotations?: Array<{ type: string; description?: string }> | null;
  status: string;
  duration?: number | null;
  location?: string;
  error?: string | null;
  testSource?: string | null;
  testSourceFrames?: TestSourceFrame[] | null;
  failureClusterId?: number | null;
  retries?: number | null;
  steps?: PerformanceStep[] | null;
  stepEvents?: TestStepEvent[] | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  wastedTimeMs?: number | null;
  networkRequests?: NetworkRequest[] | null;
  webVitals?: WebVitals | null;
  consoleLogs?: ConsoleEntry[] | null;
  ariaSnapshot?: string | null;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number;
  browser?: {
    projectName?: string;
    browserName?: string | null;
    channel?: string | null;
    viewport?: { width: number; height: number } | null;
  } | null;
  links?: EntityLinkInfo[];
  isNewRegression?: boolean | null;
  isNewFlaky?: boolean | null;
}

/**
 * One affected test case inside a failure group — part of GET /api/test-runs/[id]/failure-groups
 */
export interface FailureGroupCase {
  testRunsCaseId: number;
  testCaseId: number;
  title: string;
  filePath: string;
  retries: number;
  workerIndex: number | null;
  passedOnRetry: boolean;
}

/**
 * Failure group summary for a test run — returned by GET /api/test-runs/[id]/failure-groups
 */
export interface FailureGroup {
  clusterId: number;
  signature: string;
  title: string | null;
  errorType: string | null;
  selector: string | null;
  status: string;
  triageNote: string | null;
  caseCount: number;
  isNew: boolean;
  firstSeenRunId: number;
  firstSeenAt: string | null;
  occurrences: number;
  flaky: boolean;
  workerCorrelated: boolean;
  cases: FailureGroupCase[];
  diagnosis: DiagnosisCompact | null;
  /**
   * Present when this group's representative failure has a healable locator —
   * the panel on the cluster page can apply it. `healed` when the recommended
   * locator already passes at that call site in a later run.
   */
  locatorHealing?: { recommended: string; source: string; healed: boolean } | null;
}

/**
 * Full failure cluster — returned by GET /api/failure-clusters/[id]
 */
export interface FailureClusterDetail {
  id: number;
  projectId: number;
  fingerprint: string;
  signature: string;
  title: string | null;
  errorType: string | null;
  selector: string | null;
  sampleError: string | null;
  status: string;
  triageNote: string | null;
  firstSeenRunId: number;
  lastSeenRunId: number;
  firstSeenAt: string | Date | null;
  occurrences: number;
  affectedTests: number;
  lastSeenRunStatus: string | null;
  lastSeenAt: string | Date | null;
  diagnosis: DiagnosisCompact | null;
  project: { id: number; name: string; label: string | null } | null;
  affectedTestCases: Array<{
    testCaseId: number;
    title: string;
    filePath: string;
    runCount: number;
    recentTestRunsCaseId: number;
  }>;
}

/**
 * Failure cluster summary for a project page — returned by GET /api/projects/[id]/failure-clusters
 */
export interface ProjectFailureCluster {
  id: number;
  fingerprint: string;
  signature: string;
  title: string | null;
  errorType: string | null;
  selector: string | null;
  sampleError: string | null;
  status: string;
  triageNote: string | null;
  firstSeenRunId: number;
  lastSeenRunId: number;
  occurrences: number;
  affectedTests: number;
  lastSeenRunStatus: string | null;
  lastSeenAt: string | Date | null;
  diagnosis: DiagnosisCompact | null;
}

/**
 * Test case with statistics - one item of GET /api/projects/[id]/test-cases.
 * `failedRuns` includes timed-out runs; `status` is the derived category the
 * status filter operates on (flaky wins over the last run's status, timeouts
 * count as failed, `never-run` when the case has no executions). `passRate`
 * is over executed runs only (0..1), null when nothing executed.
 */
export interface TestCaseWithStats {
  id: number;
  filePath: string;
  suitePath: string;
  title: string;
  status: string;
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  skippedRuns: number;
  didNotRunRuns: number;
  flakyRuns: number;
  recentFlakyRuns?: number;
  passRate: number | null;
  avgDuration: number | null;
  lastRun: number | null;
  lastStatus: string | null;
}

/**
 * Paginated envelope returned by GET /api/projects/[id]/test-cases
 */
export interface TestCasesPage {
  items: TestCaseWithStats[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// Authentication types
// ============================================================================

/**
 * Authenticated user
 */
export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  name?: string | null;
  avatarUrl?: string | null;
}

/**
 * Authentication state
 */
export interface AuthState {
  authenticated: boolean;
  user: AuthUser | null;
}

/**
 * User details (for user management)
 */
export interface UserDetails {
  id: number;
  username: string;
  role: Role;
  name?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  oauthProvider?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Users response from API
 */
export interface UsersResponse {
  users: UserDetails[];
  authEnabled: boolean;
}

// ============================================================================
// API key types
// ============================================================================

/**
 * API key summary (key hash/plaintext is never returned after creation)
 */
export interface ApiKeySummary {
  id: number;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
}

/**
 * Response from GET /api/users/[id]/api-keys
 */
export interface ApiKeysResponse {
  apiKeys: ApiKeySummary[];
}

/**
 * Response from POST /api/users/[id]/api-keys – key is shown ONCE
 */
export interface CreateApiKeyResponse {
  key: string;
  prefix: string;
  name: string;
}

// ============================================================================
// Project assignment types
// ============================================================================

/**
 * User's project assignments (GET /api/users/[id]/projects)
 */
export interface UserProjectAssignments {
  global: boolean;
  projectIds: number[];
}

/**
 * Project member entry (GET /api/projects/[id]/members)
 */
export interface ProjectMemberEntry {
  id: number;
  username: string;
  name: string | null;
  role: string;
  global: boolean;
}

/**
 * Project members response
 */
export interface ProjectMembersResponse {
  users: ProjectMemberEntry[];
}

// ============================================================================
// Admin types
// ============================================================================

/**
 * Storage statistics returned by GET /api/admin/stats
 */
export interface AdminStats {
  totalProjects: number;
  totalRuns: number;
  totalTestCases: number;
  totalRunsCases: number;
  totalFiles: number;
  totalFileSize: number;
  storageSizeOnDisk: number | null;
}

// ============================================================================
// Performance API response types
// ============================================================================

/**
 * Performance trend data point - returned by GET /api/projects/[id]/performance
 */
export interface PerformanceTrendPoint {
  id: number;
  startTime: string | Date;
  duration?: number | null;
  avgTestDuration?: number | null;
  p90TestDuration?: number | null;
  status: string;
  totalTests: number;
  commit?: string | null;
  branch?: string | null;
  isFullRun?: boolean;
}

/**
 * Test case history point - returned by GET /api/test-cases/[id]/history
 */
export interface TestCaseHistoryPoint {
  id: number;
  runId: number;
  status: string;
  duration: number | null;
  error: string | null;
  retries: number | null;
  startTime: string | Date;
  runStatus: string;
}

/**
 * Trace file attached to a test case result
 */
export interface TraceInfo {
  id: number;
  filePath: string;
  createdAt: Date;
  size?: number | null;
}

/**
 * Attachment file (screenshot, video, custom) attached to a test case result
 */
export interface AttachmentInfo {
  id: number;
  name: string | null;
  contentType: string | null;
  path: string;
  size: number | null;
}

// ============================================================================
// Regression context types (Pillar 2)
// ============================================================================

/**
 * Commit range between last passing run and this run
 */
export interface RegressionContextCommitRange {
  fromSha: string;
  toSha: string;
  fromShort: string;
  toShort: string;
  repositoryUrl: string | null;
  compareUrl: string | null;
  gitCommand: string;
}

/**
 * A single field that changed between the last passing run and this run
 */
export interface RegressionContextMetaDiff {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
}

/**
 * Regression context for a test run — returned by GET /api/test-runs/[id]/regression-context.
 * hasGreen: false means no prior passing run exists for this project.
 */
export interface RegressionContext {
  hasGreen: boolean;
  lastGreenRunId?: number;
  lastGreenRunAt?: string | Date | null;
  lastGreenCommit?: string | null;
  lastGreenBranch?: string | null;
  currentCommit?: string | null;
  currentBranch?: string | null;
  commitRange?: RegressionContextCommitRange | null;
  metadataDiff?: RegressionContextMetaDiff[];
  newFailures?: number;
}

/**
 * Slow test entry - returned by GET /api/projects/[id]/slow-tests
 */
export interface SlowTest {
  id: number;
  title: string;
  filePath: string;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  runCount: number;
  trend: 'faster' | 'slower' | 'stable';
  latestDuration: number;
}

// ============================================================================
// AI Diagnosis types (Pillar 4)
// ============================================================================

/**
 * Compact diagnosis summary — inlined in failure-groups and failure-clusters responses
 */
export interface DiagnosisCompact {
  status: string;
  category: string | null;
  confidence: string | null;
  summary: string | null;
}

/**
 * One rendered evidence section of the AI diagnosis context (a lens over what
 * will be sent to the model). Shared by the context modal, the cluster diagnosis
 * store and the demo context builder.
 */
export interface ContextSection {
  id: string;
  title: string;
  chars: number;
  truncated: boolean;
  markdown: string;
  items?: number;
}

/**
 * SCM coverage metadata returned alongside the diagnosis context preview.
 * null means the regression context block was never reached (DB error or no lastSeenRun).
 */
export interface DiagnosisContextCoverage {
  scm: {
    hasLastGreen: boolean;
    hasCommitRange: boolean;
    /** Set when the user manually overrode the baseline commit SHA */
    baseCommitUsed: string | null;
    provider: 'github' | 'gitlab' | 'bitbucket' | null;
    commitsCount: number;
    filesCount: number;
    patchedFilesCount: number;
    patchesOmitted: boolean;
    patchesTruncated: boolean;
    /** What established the baseline commit: project-wide green run, per-test last-pass, or manual override. */
    baselineKind?: 'run-green' | 'test-green' | 'manual';
    /** Error message when the SCM diff fetch failed. */
    error?: string | null;
  } | null;
  /** True when the last passing run is newer than the cluster's lastSeen — test may already be fixed. */
  alreadyGreen?: boolean;
  /** Locator healing alternatives for the failing locator. null when not a locator failure or no snapshot data. */
  locatorHealing?: {
    source: import('#shared/locator-healing.types').LocatorHealingSource;
    alternativesCount: number;
  } | null;
  /** Full source files fetched to ground the diagnosis (suspect changed files + test imports). */
  sourceFiles?: {
    count: number;
    /** Repo-relative paths of the fetched files. */
    paths: string[];
    /** true when at least one file was truncated to the size cap. */
    truncated: boolean;
  } | null;
  /** Environment diff vs the last passing execution. null when no passing baseline exists. */
  environmentDiff?: {
    changedKeys: number;
    baselineRunId: number | null;
  } | null;
  /** Visual screenshot diff vs the last passing execution. null when no comparable screenshots exist. */
  visualDiff?: {
    changedPixelRatio: number;
    dimensionMismatch: boolean;
  } | null;
  /** Failure-time DOM snapshot rendered from the stored trace. null when no trace or no snapshot. */
  domSnapshot?: {
    chars: number;
    snapshotName?: string;
  } | null;
  /** Full call stack of the failing action from the trace's stacks index. null when no trace/stacks. */
  traceCallStack?: {
    frames: number;
    framesWithSource: number;
  } | null;
  /** Network activity parsed from the trace's HAR-like stream. null when no trace or no entries. */
  traceNetwork?: {
    requests: number;
    failed: number;
  } | null;
  /** App state (URL/storage keys/cookie flags) at test end. null when not captured. */
  appState?: {
    hasBaseline: boolean;
  } | null;
  /** Sections where data is not applicable (with reason), keyed by section id. Absent in coverage means "no data". */
  notApplicable?: Record<string, string>;
}

/**
 * A commit as returned by the failure-cluster commit-list endpoints and rendered
 * by the commit picker / browser. Shared so those components don't each redeclare it.
 */
export interface CommitListItem {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Changed file returned in SCM diff — mirrors ScmProvider.ChangedFile
 */
export interface ScmChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/**
 * Structured SCM changes returned alongside the context preview
 */
export interface ScmChanges {
  commits: { sha: string; message: string }[];
  files: ScmChangedFile[];
  patchesOmitted?: boolean;
}

/** Supported AI provider identifiers */
export type AiProvider = 'anthropic' | 'openai';

/**
 * Model metadata returned by the provider's models endpoint.
 * Shared between the server models endpoint and frontend model picker UI.
 */
export interface ModelInfo {
  id: string;
  label?: string;
  ownedBy?: string;
  contextLength?: number;
  maxTokens?: number;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  modalities?: string[];
}

/**
 * The distinct model "slots" Piwi can call. Each role has its own complete
 * provider configuration (or reuses another role's credentials):
 * - `diagnosis`  — the main model that writes the final diagnosis (required root)
 * - `research`   — optional cheaper/faster pre-analysis pass (two-stage diagnosis)
 * - `embedding`  — optional embeddings model for semantic failure clustering
 */
export type AiModelRole = 'diagnosis' | 'research' | 'embedding';

/** A fully-resolved provider config for a single role (server-side; holds the raw key). */
export interface ResolvedAiRole {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string | null;
}

/**
 * Runtime AI configuration — built from env vars or DB settings.
 * Contains the raw API key; never sent to the client.
 * AiSettings is the client-facing equivalent (hasApiKey + envManaged instead).
 *
 * The top-level `provider`/`apiKey`/`model`/`baseUrl` fields mirror the
 * `diagnosis` role for back-compat with callers that take an AiConfig directly.
 */
export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string | null;
  autoDiagnose: boolean;
  source: 'env' | 'settings';
  /** Per-role resolved configs. `diagnosis` is always present; others are null when unconfigured. */
  roles: {
    diagnosis: ResolvedAiRole;
    research: ResolvedAiRole | null;
    embedding: ResolvedAiRole | null;
  };
}

/**
 * AI status — returned by GET /api/ai/status
 */
export interface AiStatus {
  configured: boolean;
  provider?: AiProvider | null;
  model?: string | null;
  autoDiagnose?: boolean;
  source?: string | null;
}

/**
 * Client-facing config for one model role (no raw secret — only `hasApiKey`).
 * A role with `reuse` set inherits its provider/key/baseUrl from another role.
 */
export interface AiRoleSettings {
  provider: AiProvider | null;
  model: string | null;
  baseUrl: string | null;
  reuse: AiModelRole | null;
  hasApiKey: boolean;
}

/**
 * AI settings — returned by GET /api/settings/ai.
 * Each model role carries a complete (or reused) provider config.
 */
export interface AiSettings {
  roles: {
    diagnosis: AiRoleSettings | null;
    research: AiRoleSettings | null;
    embedding: AiRoleSettings | null;
  };
  autoDiagnose: boolean;
  hasScmToken: boolean;
  envManaged: boolean;
  customInstructions: string | null;
}

// ============================================================================
// AI Settings request body types
// ============================================================================

/**
 * One role config as submitted by the client (apiKey is plaintext or omitted).
 */
export interface AiRoleConfigInput {
  provider?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  reuse?: AiModelRole | null;
}

/**
 * Request body for PUT /api/settings/ai
 */
export interface SaveAiSettingsBody {
  roles?: Partial<Record<AiModelRole, AiRoleConfigInput | null>> | null;
  autoDiagnose?: boolean;
  customInstructions?: string | null;
  scmToken?: string | null;
}

/**
 * Aggregated AI token usage for one provider + model pair.
 */
export interface AiUsageModelRow {
  provider: string | null;
  model: string;
  diagnoses: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  avgDurationMs: number | null;
}

/**
 * AI usage summary — returned by GET /api/settings/ai/usage
 */
export interface AiUsageSummary {
  days: number;
  totals: { diagnoses: number; inputTokens: number; outputTokens: number };
  byModel: AiUsageModelRow[];
}

// ============================================================================
// Entity Link types (A.4)
// ============================================================================

/**
 * Entity link — attach an external URL to a run, test-case run, or test case.
 * API response type, mirrors the DB row minus internal-only fields.
 */
export interface EntityLinkInfo {
  id: number;
  testRunId?: number | null;
  testRunsCaseId?: number | null;
  testCaseId?: number | null;
  url: string;
  provider: string;
  key?: string | null;
  title?: string | null;
  statusText?: string | null;
  statusColor?: string | null;
  unfurledAt?: string | Date | null;
  createdBy?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Flaky tests types (Pillar 3)
// ============================================================================

/**
 * Flaky test entry — returned by GET /api/projects/[id]/flaky-tests
 */
export interface FlakyTest {
  testCaseId: number;
  latestRunsCaseId: number;
  title: string;
  filePath: string;
  totalRuns: number;
  failedRuns: number;
  retryPassRuns: number;
  alternations: number;
  failureRate: number;
  score: number;
  lastFlakeAt: string | Date | null;
  rootCause: string | null;
  impact: number;
  wastedCiMinutes: number;
  avgFailedDurationMs: number;
}
