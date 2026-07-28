#!/usr/bin/env node
/**
 * `piwi` — the reporter package's command-line entry point.
 *
 * The reporter's job is to get results into the dashboard during
 * `playwright test`; the CLI covers the things that happen around a run:
 * setting a project up in the first place (`init`, `skills`) and acting on the
 * dashboard's history once a run has landed (`gate`).
 */
import { runGate } from './gate.js';
import { runInit } from './init.js';
import { findTemplatesDir, runSkills } from './skills.js';

const USAGE = `
piwi — companion commands for the Piwi Dashboard reporter

Usage:
  npx piwi <command> [options]

Commands:
  init      Wire a Playwright project up to a Piwi Dashboard
  skills    Install the Piwi agent skills into this project
  gate      Fail a CI job on the dashboard's analysis of a run

Run \`npx piwi <command> --help\` for a command's options.
`.trim();

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'init':
      return runInit(rest);
    case 'skills':
      return runSkills(rest, findTemplatesDir(__dirname));
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
