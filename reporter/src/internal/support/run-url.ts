/** Build a clickable dashboard URL for a run, tolerating a trailing slash on `serverUrl`. */
export function runUrl(serverUrl: string, runId: number | string): string {
  return `${serverUrl.replace(/\/+$/, '')}/test-runs/${runId}`;
}
