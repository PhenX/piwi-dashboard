/**
 * Shared test fixtures for the Piwi Dashboard test suite.
 *
 * Extends the base Playwright `test` with dashboard fixtures that mirror the
 * behavior of `@piwitests/reporter` fixtures — automatically
 * capturing network request timing, browser performance (Web Vitals),
 * ARIA snapshots, and locator interaction data for every page interaction
 * so they appear in the dashboard.
 *
 * Usage in test files:
 * ```ts
 * import { test, expect } from './fixtures'
 * ```
 */
import { gunzipSync } from 'node:zlib';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import {
  generateAlternatives,
  extractAccessibleName,
  approximateAccessibleName,
  captureCallerLocation,
  dedupeSnapshotsByLocation,
  resolveAriaRole,
  suggestLocatorsFromAria,
  LOCATOR_METHODS,
  CHAIN_METHODS,
  ACTION_METHODS,
  LOCATOR_CREATING_CHAINS,
  CAPTURED_ATTRIBUTES,
  type LocatorSnapshot,
  type FailedLocatorInfo,
} from '../../reporter/dist/internal/capture/locator-healing.js';
import { ariaSnapshotBestEffort } from '../../reporter/dist/internal/capture/capture-fixtures.js';
import { ATTACHMENT_NAMES, LOCATOR_SUGGESTION_ANNOTATION } from '../../reporter/dist/internal/capture/attachments.js';

type NetworkRequest = {
  method: string;
  url: string;
  status: number;
  duration: number;
  startTime: number;
  resourceType: string;
  serverLogs?: unknown;
};

async function collectNetworkAndVitals(page: Page, testInfo: TestInfo) {
  const networkRequests: NetworkRequest[] = [];
  const pendingHandlers: Promise<void>[] = [];

  page.on('requestfinished', (request) => {
    const p = (async () => {
      try {
        const url = request.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return;

        const timing = request.timing();
        const response = await request.response();
        const duration = timing.responseEnd > 0 ? Math.round(timing.responseEnd - timing.requestStart) : 0;

        const entry: NetworkRequest = {
          method: request.method(),
          url,
          status: response ? response.status() : 0,
          duration,
          startTime: timing.startTime,
          resourceType: request.resourceType(),
        };

        if (response) {
          const logHeader = response.headers()['x-piwi-logs'];
          if (logHeader) {
            try {
              entry.serverLogs = JSON.parse(gunzipSync(Buffer.from(logHeader, 'base64')).toString('utf-8'));
            } catch {
              /* ignore malformed header */
            }
          }
        }

        networkRequests.push(entry);
      } catch {
        // ignore aborted requests
      }
    })();
    pendingHandlers.push(p);
  });

  return async () => {
    // Wait for all in-flight requestfinished handlers to complete before
    // snapshotting networkRequests — without this, the last request (often
    // the one that caused the test to fail) races with fixture teardown and
    // its entry (including serverLogs) can be missing from the attachment.
    await Promise.allSettled(pendingHandlers);

    if (networkRequests.length > 0) {
      await testInfo.attach(ATTACHMENT_NAMES.network, {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(networkRequests)),
      });
    }

    try {
      const webVitals = await page.evaluate(() => {
        const navEntries = performance.getEntriesByType('navigation');
        const paintEntries = performance.getEntriesByType('paint');
        const nav = navEntries[0] as PerformanceNavigationTiming | undefined;

        const navigation = nav
          ? {
              url: nav.name,
              ttfb: Math.round(nav.responseStart - nav.fetchStart),
              domInteractive: Math.round(nav.domInteractive - nav.fetchStart),
              domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.fetchStart),
              loadComplete: Math.round(nav.loadEventEnd - nav.fetchStart),
              transferSize: nav.transferSize || 0,
              encodedBodySize: nav.encodedBodySize || 0,
              decodedBodySize: nav.decodedBodySize || 0,
            }
          : null;

        const paint: Record<string, number> = {};
        for (const entry of paintEntries) {
          const key = entry.name.replace(/-([a-z])/g, (_: string, letter: string) => letter.toUpperCase());
          paint[key] = Math.round(entry.startTime);
        }

        if (!navigation && Object.keys(paint).length === 0) return null;
        return { navigation, paint };
      });

      if (webVitals) {
        await testInfo.attach(ATTACHMENT_NAMES.webVitals, {
          contentType: 'application/json',
          body: Buffer.from(JSON.stringify(webVitals)),
        });
      }
    } catch {
      // page may already be closed or no navigation happened
    }
  };
}

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use, testInfo) => {
    // ── Locator interaction capture (dogfooding: matches reporter/src/fixtures.ts) ──
    const captureLocators = process.env.PIWI_CAPTURE_LOCATORS !== 'false';
    const capturedLocators: LocatorSnapshot[] = [];
    const capturePromises: Promise<void>[] = [];
    const failedLocators: FailedLocatorInfo[] = [];

    // Method-surface constants are imported from the reporter so this fixture
    // stays in lockstep with the reporter's proxy (LOCATOR_METHODS, CHAIN_METHODS,
    // ACTION_METHODS, CAPTURED_ATTRIBUTES).

    function wrapLocator(locator: any, originMethod: string, originArgs: unknown[]): any {
      return new Proxy(locator, {
        get(target, prop) {
          const original = target[prop];
          if (typeof original !== 'function') return original;

          if (CHAIN_METHODS.includes(prop as string)) {
            return (...args: unknown[]) => {
              const next = original.apply(target, args);
              if (LOCATOR_CREATING_CHAINS.has(prop as string)) {
                return wrapLocator(next, String(prop), args);
              }
              return wrapLocator(next, originMethod, originArgs);
            };
          }

          if (!ACTION_METHODS.includes(prop as string)) return original;

          return async (...callArgs: unknown[]) => {
            const seq = capturedLocators.length;
            // Capture the test call-site now (sync) so the snapshot's location
            // matches the error stack's first user frame.
            const callerLocation = captureCallerLocation();
            const used = {
              method: originMethod,
              args: originArgs,
              raw: `${originMethod}(${JSON.stringify(originArgs)})`,
            };

            // Push a placeholder immediately — DOM capture runs async below
            capturedLocators.push({
              location: callerLocation,
              used,
              element: null,
              alternatives: [],
            });

            // The placeholder is already pushed. If the action throws, record
            // the failed locator (so teardown can suggest a fresh one for the
            // element's current identity) and re-throw so the test still fails.
            let result: unknown;
            try {
              result = await original.apply(target, callArgs);
            } catch (err) {
              failedLocators.push({ method: originMethod, args: originArgs });
              throw err;
            }

            const resolveAttrs = (async () => {
              let deadline: ReturnType<typeof setTimeout> | undefined;
              try {
                const attrs = (await Promise.race([
                  target.evaluate(
                    (el: any, keep: string[]) => {
                      const attrMap: Record<string, string | null> = {};
                      for (const key of keep) {
                        const v = el.getAttribute(key) ?? (el as any)[key];
                        attrMap[key] = typeof v === 'string' ? v.slice(0, 200) : v ? String(v).slice(0, 200) : null;
                      }
                      const r = el.getBoundingClientRect();
                      // Uniqueness probe — mirrors reporter/src/internal/capture/capture-fixtures.ts.
                      const selectorCounts: {
                        testId?: number;
                        id?: number;
                        name?: number;
                        classes?: Record<string, number>;
                      } = {};
                      try {
                        const doc = el.ownerDocument;
                        const cssEsc = (s: string): string => doc.defaultView.CSS.escape(s);
                        const count = (sel: string): number | undefined => {
                          try {
                            return doc.querySelectorAll(sel).length;
                          } catch {
                            return undefined;
                          }
                        };
                        if (attrMap['data-testid']) {
                          selectorCounts.testId = count(`[data-testid=${JSON.stringify(attrMap['data-testid'])}]`);
                        }
                        if (attrMap['id']) selectorCounts.id = count(`#${cssEsc(attrMap['id'])}`);
                        if (attrMap['name']) selectorCounts.name = count(`[name=${JSON.stringify(attrMap['name'])}]`);
                        const classList = (attrMap['class'] || '')
                          .split(/\s+/)
                          .filter((c: string) => c.length > 1)
                          .slice(0, 10);
                        if (classList.length > 0) {
                          const classCounts: Record<string, number> = {};
                          for (const cls of classList) {
                            const n = count(`.${cssEsc(cls)}`);
                            if (n !== undefined) classCounts[cls] = n;
                          }
                          selectorCounts.classes = classCounts;
                        }
                      } catch {
                        // Uniqueness probing is best-effort — never fail the capture.
                      }
                      return {
                        tagName: el.tagName?.toLowerCase?.() ?? 'unknown',
                        attributes: attrMap,
                        // Collapse whitespace so multi-line text can't produce
                        // a getByText suggestion with literal newlines in it.
                        textContent: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                        center: {
                          x: Math.round(r.x + r.width / 2),
                          y: Math.round(r.y + r.height / 2),
                        },
                        hasLabel: !!(el.labels && el.labels.length > 0),
                        selectorCounts,
                      };
                    },
                    [...CAPTURED_ATTRIBUTES],
                  ),
                  new Promise<null>((_, reject) => {
                    deadline = setTimeout(() => reject(new Error('locator capture timeout')), 500);
                  }),
                ])) as any;

                // Only pay for the ARIA snapshot when the accessible name will
                // be used (role-based or form-field alternatives).
                const role = resolveAriaRole({ ...attrs, accessibleName: null });
                const isFormField = ['input', 'select', 'textarea'].includes(attrs.tagName);
                // Bound with a timeout: without it, ariaSnapshot waits up to the
                // test timeout when the page is mid-navigation, hanging the
                // fixture teardown that drains these capture promises.
                const aria = role || isFormField ? await ariaSnapshotBestEffort(target as any, 500) : null;

                const accessibleName =
                  extractAccessibleName(aria) || approximateAccessibleName({ ...attrs, accessibleName: null });

                capturedLocators[seq] = {
                  location: callerLocation,
                  used,
                  // hasLabel/selectorCounts inform alternative generation only —
                  // keep the stored element to the wire shape.
                  element: {
                    tagName: attrs.tagName,
                    attributes: attrs.attributes,
                    textContent: attrs.textContent,
                    accessibleName,
                    center: attrs.center,
                  },
                  alternatives: generateAlternatives({ ...attrs, accessibleName }),
                };
              } catch {
                // keep the placeholder
              } finally {
                clearTimeout(deadline);
              }
            })();

            capturePromises.push(resolveAttrs);

            return result;
          };
        },
      });
    }

    if (captureLocators) {
      for (const method of LOCATOR_METHODS) {
        const original = (page as any)[method].bind(page);
        (page as any)[method] = (...args: unknown[]) => wrapLocator(original(...args), method, args);
      }
    }

    // ── Existing event listeners ──────────────────────────────────────────
    const flush = await collectNetworkAndVitals(page, testInfo);
    await use(page);

    // ── Attach locator snapshots ──────────────────────────────────────────
    // Cap the drain so a stuck capture (e.g. a navigation in flight) can never
    // hang teardown past the test timeout; per-action evaluate/ariaSnapshot are
    // already bounded, this is a backstop.
    let drainDeadline: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(capturePromises),
      new Promise((resolve) => {
        drainDeadline = setTimeout(resolve, 2000);
      }),
    ]);
    clearTimeout(drainDeadline);
    if (capturedLocators.length > 0) {
      await testInfo.attach(ATTACHMENT_NAMES.locators, {
        contentType: 'application/json',
        // Repeated call sites (loops) keep only their latest capture.
        body: Buffer.from(JSON.stringify(dedupeSnapshotsByLocation(capturedLocators))),
      });
    }

    try {
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await page.screenshot({ fullPage: true, timeout: 5000 });
        await testInfo.attach('failure-screenshot', {
          contentType: 'image/png',
          body: screenshot,
        });
      }
    } catch {
      // page may already be closed or screenshot failed — skip
    }

    try {
      if (testInfo.status !== 'passed' && testInfo.status !== 'skipped') {
        // Version-tolerant + bounded — mirrors the reporter's flushSink.
        const snapshot = await ariaSnapshotBestEffort(page.locator(':root') as any);
        if (snapshot) {
          await testInfo.attach(ATTACHMENT_NAMES.ariaSnapshot, {
            contentType: 'text/plain',
            body: snapshot,
          });

          // Suggest a fresh locator for the failed action from the current page
          // (matches reporter/src/fixtures.ts). Annotation shows in the report +
          // trace; attachment shows in the trace viewer. Does not change the locator.
          const failed = failedLocators[failedLocators.length - 1];
          const suggestion = failed ? suggestLocatorsFromAria(failed, snapshot) : null;
          if (suggestion) {
            testInfo.annotations.push({
              type: LOCATOR_SUGGESTION_ANNOTATION,
              description: `${suggestion.failing} matched nothing on the failing page — the element may have been renamed or moved. Suggested: ${suggestion.suggestions.join('  |  ')}`,
            });
            await testInfo.attach(ATTACHMENT_NAMES.locatorSuggestion, {
              contentType: 'application/json',
              body: Buffer.from(JSON.stringify(suggestion)),
            });
          }
        }
      }
    } catch {
      // aria snapshot may fail if page is already closed
    }

    await flush();
  },
});

export { expect };
