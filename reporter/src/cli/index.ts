#!/usr/bin/env node
/**
 * `piwi` — the reporter package's command-line entry point.
 *
 * Deliberately tiny. The reporter's job is to get results into the dashboard
 * during `playwright test`; this CLI exists only for the things that have to
 * happen *after* a run has landed, where the dashboard's history is what makes
 * the answer possible. Today that is one command.
 */
import { runGate } from './gate.js';

const USAGE = `
piwi — companion commands for the Piwi Dashboard reporter

Usage:
  npx piwi <command> [options]

Commands:
  gate    Fail a CI job on the dashboard's analysis of a run

Run \`npx piwi gate --help\` for that command's options.
`.trim();

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'gate':
      return runGate(rest);
    case undefined:
    case '-h':
    case '--help':
      console.log(USAGE);
      return 0;
    default:
      console.error(`piwi: unknown command "${command}"\n`);
      console.error(USAGE);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(`piwi: ${(e as Error).message}`);
    process.exitCode = 2;
  });
