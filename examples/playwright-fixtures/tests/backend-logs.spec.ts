import { test, expect } from './fixtures';

// The app is instrumented with @piwitests/instrumentation-nitro (see
// app/plugins/piwi-test-logs.ts): each response carries its server-side
// Warning/Error logs in the X-Piwi-Logs header, and the fixtures attach them
// to the matching network request. On the dashboard, open this test's
// "Network & backend logs" panel — /api/report carries a warning and an
// error with a stack trace, and the 500 from /api/failing carries the
// unhandled error.
test('backend logs ride along on the X-Piwi-Logs header', async ({ page }) => {
  await page.goto('/backend');

  await page.getByTestId('load-report').click();
  await expect(page.locator('#backend-result')).toHaveText('report loaded');

  const failedResponse = page.waitForResponse('/api/failing');
  await page.getByTestId('trigger-failure').click();
  expect((await failedResponse).status()).toBe(500);
  await expect(page.locator('#backend-result')).toHaveText('backend failed as expected (500)');
});
