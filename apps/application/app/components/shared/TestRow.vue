<script setup lang="ts">
/**
 * One test in a list, read the same way everywhere: a status icon and the test
 * title on the first line with the exceptional badges and the right-side metrics
 * (duration, browser, retries, wasted time, cluster), the failure headline on
 * the second line, and the source path on the third. The whole row reflows to a
 * single column on a phone, so it reads as a card with no horizontal scroll.
 *
 * Built to be reused by the run's Tests tab, the cluster's affected-tests list,
 * the run's Changes tab and the project catalog; each passes the execution and,
 * when it has one, the resolved cluster name and the live step.
 */
import type { TestCaseResult } from '~~/types/api';
import type { LiveStepInfo } from '~/utils/live-steps';
import { badgesFromTestCase } from '~/utils/test-row-badges';

const props = withDefaults(
  defineProps<{
    testCase: TestCaseResult;
    /** Resolved cluster display name; falls back to the id when absent. */
    clusterName?: string | null;
    /** Show the failing row's cluster chip on the right. */
    showCluster?: boolean;
    quarantined?: boolean;
    /** Render a selection checkbox on a failing row and reflect `selected`. */
    selectable?: boolean;
    selected?: boolean;
    /** The step this row's worker is on right now (live runs only). */
    liveStep?: LiveStepInfo | null;
    highlighted?: boolean;
    projectKey?: string | number | null;
    projectName?: string | null;
    /** How many badges to show before the rest fold into `+N`. */
    badgeMax?: number;
    /** Extra left padding in px, to indent a row under a nested group header. */
    indent?: number;
  }>(),
  {
    clusterName: null,
    showCluster: true,
    quarantined: false,
    selectable: false,
    selected: false,
    liveStep: null,
    highlighted: false,
    projectKey: null,
    projectName: null,
    badgeMax: 3,
    indent: 0,
  },
);

const emit = defineEmits<{ toggle: [] }>();

const tc = computed(() => props.testCase);
const failed = computed(() => isFailedStatus(tc.value.status));
const href = computed(() => `/test-run-cases/${tc.value.executionId}`);

const badges = computed(() => badgesFromTestCase(tc.value, { quarantined: props.quarantined }));

const statusHint = computed(() =>
  tc.value.status === 'didnotrun'
    ? formatDidNotRunReason(tc.value.didNotRunReason)
    : formatStatusLabel(tc.value.status),
);

const clusterLabel = computed(() =>
  tc.value.failureClusterId != null ? (props.clusterName ?? `Cluster #${tc.value.failureClusterId}`) : '',
);
</script>

<template>
  <div
    class="border-b border-default px-3 py-2.5 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
    :class="highlighted ? 'animate-pulse bg-yellow-100 dark:bg-yellow-900/30' : ''"
    :style="indent ? { paddingLeft: `${12 + indent}px` } : undefined"
  >
    <div class="flex items-start gap-2 min-w-0">
      <input
        v-if="selectable"
        type="checkbox"
        class="size-4 shrink-0 mt-0.5 cursor-pointer accent-primary focus-visible:ring-2 focus-visible:ring-primary rounded"
        :checked="selected"
        :aria-label="`Select ${tc.title}`"
        @change="emit('toggle')"
      />
      <span class="size-4 shrink-0 mt-0.5" role="img" :aria-label="`Status: ${statusHint}`" :title="statusHint">
        <UIcon
          :name="getStatusIcon(tc.status)"
          class="size-4"
          :class="[getStatusTextClass(tc.status), isStatusInFlight(tc.status) ? 'animate-spin' : '']"
        />
      </span>

      <div class="flex-1 min-w-0 space-y-1">
        <!-- Line 1: title, badges, then the right-side metrics -->
        <div class="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
          <!-- Neutral title: a primary-green title reads as "passed" on a failed row. -->
          <a
            :href="href"
            class="text-highlighted hover:text-primary hover:underline font-medium break-words min-w-0"
            :title="tc.title"
            @click.prevent="navigateTo(href)"
            >{{ tc.title }}</a
          >
          <BadgeGroup :badges="badges" :max="badgeMax" />

          <div class="flex items-center gap-2 ml-auto shrink-0 text-xs text-muted">
            <template v-if="tc.status === 'running'">
              <span v-if="!liveStep" class="text-info">In progress…</span>
            </template>
            <DurationValue v-else-if="tc.duration" :ms="tc.duration" />
            <BrowserBadge :browser="tc.browser" size="sm" />
            <UBadge
              v-if="(tc.retries ?? 0) > 0"
              color="warning"
              variant="soft"
              size="xs"
              :title="`${tc.retries} retries`"
            >
              {{ tc.retries }}x
            </UBadge>
            <span
              v-if="tc.wastedTimeMs"
              class="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"
              title="Wasted in fixed waits"
            >
              <UIcon name="i-lucide-hourglass" class="size-3 shrink-0" />
              <DurationValue :ms="tc.wastedTimeMs" unit-class="opacity-60" no-title />
            </span>
            <NuxtLink
              v-if="showCluster && tc.failureClusterId"
              :to="`/failure-clusters/${tc.failureClusterId}`"
              class="shrink-0"
              @click.stop
            >
              <UBadge color="info" variant="subtle" size="xs" class="max-w-44">
                <span class="truncate">{{ clusterLabel }}</span>
              </UBadge>
            </NuxtLink>
          </div>
        </div>

        <FailureHeadline
          v-if="failed && tc.error"
          :error="tc.error"
          :steps="tc.steps"
          truncate
          class="text-xs text-gray-600 dark:text-gray-400"
        />

        <OpenInIdeLink
          v-if="tc.location"
          :location="tc.location"
          :project-key="projectKey"
          :project-name="projectName"
          class="block text-xs text-zinc-400 dark:text-zinc-500"
        />

        <TestRowLiveStep v-if="liveStep" :step="liveStep" class="max-w-full" />
      </div>
    </div>
  </div>
</template>
