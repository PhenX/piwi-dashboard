/**
 * Option A — extend the base `test` with the Piwi Dashboard capture fixtures.
 *
 * Every spec imports `test` from this file instead of `@playwright/test`;
 * that import is what switches capture on for the spec.
 */
import { test as base, expect } from '@playwright/test';
import { dashboardFixtures } from '@piwitests/reporter';

/** Absolute base URL for pages created outside the `page` fixture (browser.newPage etc.). */
export const BASE_URL = 'http://localhost:4173';

export const test = base.extend(dashboardFixtures);
export { expect };
