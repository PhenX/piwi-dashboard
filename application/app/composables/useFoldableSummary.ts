import { useFoldedState } from './useFoldedState';

/** Folded/expanded state for a detail-page summary, keyed by page. */
export function useFoldableSummary(key: string) {
  return useFoldedState(`piwi-summary-fold-${key}`, false);
}
