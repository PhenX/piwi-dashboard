<script setup lang="ts">
import type { TestRunCiMetadata } from '~~/types/api';
import type { BrowserConfig } from '#shared/types';

defineProps<{
  ci?: TestRunCiMetadata | null;
  environment?: string | null;
  playwrightVersion?: string | null;
  reporterVersion?: string | null;
  /** When provided, a dense browser line (icon + screen resolution) is folded in. */
  browser?: BrowserConfig | null;
  class?: string;
}>();
</script>

<template>
  <BlockCard :class="$props.class" title="CI / Env" icon="i-lucide-cloud" help="run.ci-env">
    <div class="space-y-1.5 text-sm">
      <!-- Environment + CI provider -->
      <div v-if="environment || ci?.provider" class="flex items-center gap-x-2 gap-y-1 flex-wrap">
        <UIcon name="i-lucide-cloud" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span v-if="environment" class="rounded-full border border-default px-2 py-0.5 text-xs bg-elevated/60">{{
          environment
        }}</span>
        <span v-if="ci?.provider">{{ ci.provider }}</span>
      </div>
      <!-- Build (links to the CI build when a URL is available) -->
      <div v-if="ci?.buildNumber || ci?.buildUrl" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-hash" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <a v-if="ci?.buildUrl" :href="ci.buildUrl" target="_blank" class="text-primary hover:underline">{{
          ci?.buildNumber ? `Build #${ci.buildNumber}` : 'View build'
        }}</a>
        <span v-else>Build #{{ ci.buildNumber }}</span>
      </div>
      <!-- Workflow · job -->
      <div v-if="ci?.workflow || ci?.jobName" class="flex items-center gap-x-1.5 gap-y-1 flex-wrap">
        <UIcon name="i-lucide-workflow" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span v-if="ci?.workflow">{{ ci.workflow }}</span>
        <span v-if="ci?.workflow && ci?.jobName" class="text-gray-300 dark:text-gray-600">·</span>
        <span v-if="ci?.jobName">{{ ci.jobName }}</span>
      </div>
      <!-- Tooling versions -->
      <div v-if="playwrightVersion || reporterVersion" class="flex items-center gap-x-1.5 gap-y-1 flex-wrap">
        <UIcon name="i-lucide-tag" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span v-if="playwrightVersion">Playwright v{{ playwrightVersion }}</span>
        <span v-if="playwrightVersion && reporterVersion" class="text-gray-300 dark:text-gray-600">·</span>
        <span v-if="reporterVersion">Piwi v{{ reporterVersion }}</span>
      </div>
      <!-- Browser: dense (icon + screen resolution); full config on hover via the badge -->
      <div v-if="browser" class="flex items-center gap-1.5">
        <BrowserBadge :browser="{ ...browser, viewport: undefined }" size="sm" />
        <span v-if="browser.viewport" class="tabular-nums">
          {{ browser.viewport.width }}×{{ browser.viewport.height }}
          <span v-if="browser.deviceScaleFactor && browser.deviceScaleFactor !== 1" class="text-gray-400"
            >@{{ browser.deviceScaleFactor }}x</span
          >
        </span>
      </div>
    </div>
  </BlockCard>
</template>
