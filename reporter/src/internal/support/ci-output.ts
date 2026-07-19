import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from './logger.js';
import { errorMessage } from './errors.js';

/**
 * The facts about a just-submitted run that CI pipelines want to consume: the
 * clickable dashboard URL plus the identifiers and status behind it. Produced by
 * the submit ladder once a run lands, and rendered into CI-native channels by
 * `emitRunOutputs`.
 */
export interface RunOutput {
  /** Clickable dashboard URL for the run (`<serverUrl>/test-runs/<id>`). */
  runUrl: string;
  /** Dashboard run id. */
  runId: number | string;
  /** Dashboard project id, when the submit response carried one. */
  projectId?: number | string | null;
  /** Project name the run was reported under. */
  projectName: string;
  /** Overall run status (`"passed"` / `"failed"`). */
  status: string;
  /** Link back to the CI build/job that produced the run, when detected. */
  ciBuildUrl?: string | null;
}

/**
 * Surface the dashboard run URL wherever a CI pipeline can pick it up, so a
 * downstream step (a custom email, a Slack post, a deploy gate) can consume it
 * without scraping the reporter's stdout.
 *
 * Layered, best-effort — a failure in any channel is logged and swallowed so it
 * never fails the run:
 *  1. Always logs `View run: <url>` for a human reading the CI log.
 *  2. `outputFile` (opt-in): a portable JSON file every CI can read
 *     (`cat piwi-run.json`, Jenkins `readJSON`, etc.).
 *  3. GitHub Actions (auto): step outputs on `$GITHUB_OUTPUT`
 *     (`steps.<id>.outputs.piwi_run_url`), a markdown link on
 *     `$GITHUB_STEP_SUMMARY`, and a `::notice::` workflow annotation.
 *  4. GitLab CI (auto): a dotenv report file (default `piwi.env`) to be wired as
 *     `artifacts:reports:dotenv:` so later jobs inherit `$PIWI_RUN_URL`.
 */
export function emitRunOutputs(
  output: RunOutput,
  logger: Logger,
  outputFile?: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  logger.info(`View run: ${output.runUrl}`);

  if (outputFile) writeOutputFile(outputFile, output, logger);
  if (env.GITHUB_ACTIONS) emitGitHubActions(output, env, logger);
  if (env.GITLAB_CI) emitGitLabDotenv(output, env, logger);
}

/** Portable machine-readable output: a JSON file readable by any CI system. */
function writeOutputFile(file: string, output: RunOutput, logger: Logger): void {
  try {
    const dir = path.dirname(file);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          runUrl: output.runUrl,
          runId: output.runId,
          projectId: output.projectId ?? null,
          projectName: output.projectName,
          status: output.status,
          ciBuildUrl: output.ciBuildUrl ?? null,
        },
        null,
        2,
      ) + '\n',
    );
    logger.info(`Wrote run output to ${file}`);
  } catch (error) {
    logger.warn(`Failed to write run output file '${file}': ${errorMessage(error)}`);
  }
}

/** GitHub Actions: step outputs, a job-summary link, and a workflow annotation. */
function emitGitHubActions(output: RunOutput, env: NodeJS.ProcessEnv, logger: Logger): void {
  const pairs: Array<[string, string]> = [
    ['piwi_run_url', output.runUrl],
    ['piwi_run_id', String(output.runId)],
    ['piwi_run_status', output.status],
  ];
  if (output.projectId != null) pairs.push(['piwi_project_id', String(output.projectId)]);

  // Values are single-line (URL / id / status), so the plain `key=value` form is
  // safe — no heredoc delimiter needed.
  if (env.GITHUB_OUTPUT) {
    appendFileLines(
      env.GITHUB_OUTPUT,
      pairs.map(([k, v]) => `${k}=${v}`),
      logger,
      'step output',
    );
  }
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileLines(
      env.GITHUB_STEP_SUMMARY,
      ['### Piwi test run', '', `[View run](${output.runUrl}) — **${output.status}**`, ''],
      logger,
      'step summary',
    );
  }
  // A workflow annotation must be a bare stdout line (no logger prefix).
  process.stdout.write(`::notice title=Piwi test run::${output.runUrl}\n`);
}

/** GitLab CI: a dotenv report file so later jobs inherit the run URL as a variable. */
function emitGitLabDotenv(output: RunOutput, env: NodeJS.ProcessEnv, logger: Logger): void {
  const file = env.PIWI_DOTENV_FILE || 'piwi.env';
  const lines = [`PIWI_RUN_URL=${output.runUrl}`, `PIWI_RUN_ID=${output.runId}`, `PIWI_RUN_STATUS=${output.status}`];
  if (output.projectId != null) lines.push(`PIWI_PROJECT_ID=${output.projectId}`);
  if (output.ciBuildUrl) lines.push(`PIWI_CI_BUILD_URL=${output.ciBuildUrl}`);
  try {
    fs.writeFileSync(file, lines.join('\n') + '\n');
    logger.info(`Wrote GitLab dotenv report to ${file} (declare it as artifacts:reports:dotenv)`);
  } catch (error) {
    logger.warn(`Failed to write GitLab dotenv file '${file}': ${errorMessage(error)}`);
  }
}

/** Append newline-terminated lines to a file, swallowing (but logging) failures. */
function appendFileLines(file: string, lines: string[], logger: Logger, label: string): void {
  try {
    fs.appendFileSync(file, lines.join('\n') + '\n');
  } catch (error) {
    logger.warn(`Failed to write GitHub Actions ${label}: ${errorMessage(error)}`);
  }
}

/** Pick the most specific CI build/job URL from collected CI metadata, if any. */
export function ciBuildUrlFromMetadata(metadata: Record<string, any> | undefined): string | undefined {
  const ci = metadata?.ci;
  if (!ci) return undefined;
  return ci.buildUrl || ci.pipelineUrl || ci.jobUrl || undefined;
}
