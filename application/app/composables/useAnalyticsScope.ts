import { analyticsScopeToQuery, DEFAULT_ANALYTICS_DAYS, type AnalyticsScope } from '#shared/analytics/scope';
import type { AnalyticsWidgetId } from '#shared/analytics/registry';

export interface AnalyticsScopeState {
  days: number;
  environment: string | null;
  fullRunsOnly: boolean;
}

const DEFAULT_STATE: AnalyticsScopeState = {
  days: DEFAULT_ANALYTICS_DAYS,
  environment: null,
  fullRunsOnly: true,
};

/**
 * The `/analytics` page's global filter state (persisted per user in a
 * cookie, SSR-safe) plus the query object every widget fetch derives from.
 */
export function useAnalyticsScope() {
  const state = useCookie<AnalyticsScopeState>('piwi-analytics-scope', {
    default: () => ({ ...DEFAULT_STATE }),
    encode: (v) => JSON.stringify(v),
    decode: (v) => {
      try {
        return v ? { ...DEFAULT_STATE, ...(JSON.parse(v) as Partial<AnalyticsScopeState>) } : { ...DEFAULT_STATE };
      } catch {
        return { ...DEFAULT_STATE };
      }
    },
  });

  const scope = computed<AnalyticsScope>(() => ({
    days: state.value.days,
    environment: state.value.environment,
    fullRunsOnly: state.value.fullRunsOnly,
  }));

  const scopeQuery = computed(() => analyticsScopeToQuery(scope.value));

  return { state, scope, scopeQuery };
}

/**
 * Fetch one analytics widget's data. The query is reactive — changing the
 * scope refetches every mounted widget.
 */
export function useAnalyticsWidget<T>(widget: AnalyticsWidgetId, query: () => Record<string, string>) {
  return useFetch<T>(`/api/analytics/${widget}`, {
    query: computed(query),
    lazy: true,
    server: false,
  });
}
