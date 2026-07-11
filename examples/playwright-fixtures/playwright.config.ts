import { defineConfig } from '@playwright/test';
import { wrapConfig } from '@piwitests/reporter';
import { baseConfig, piwiOptions } from './playwright.shared';

/**
 * Recommended setup: `wrapConfig` injects the Piwi Dashboard reporter and
 * chains its global setup (the run shows up on the dashboard while your own
 * globalSetup is still running).
 *
 * See playwright.manual-reporter.config.ts for the plain reporter-array way.
 */
export default wrapConfig(defineConfig(baseConfig, { reporter: [['list']] }), piwiOptions);
