<script setup lang="ts">
import { docsUrl } from '#shared/docs';

const config = useRuntimeConfig();
const authEnabled = computed(() => !!config.public.authEnabled);
const isDesktop = useIsDesktop();

// Desktop build only: the reporter must send this app's local access token —
// the desktop guard enforces it even though sign-in is off — so bake it into
// the generated snippet instead of the PIWI_API_KEY env-var reference.
const { data: reporterConfig } = useFetch<{ url: string; token: string } | null>('/api/desktop/reporter-config', {
  immediate: isDesktop,
  default: () => null,
});

// Reflect the actual dashboard URL so the generated config snippet is correct
const serverUrl = ref('http://localhost:3000');
onMounted(() => {
  serverUrl.value = window.location.origin;
});

const apiKeyLine = computed(() => {
  if (isDesktop && reporterConfig.value) return `\n      apiKey: '${reporterConfig.value.token}',`;
  return authEnabled.value ? `\n      apiKey: process.env.PIWI_API_KEY,` : '';
});

const configCode = computed(
  () => `import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['list'],
    ['@piwitests/reporter', {
      serverUrl: '${serverUrl.value}',
      projectName: 'my-project',${apiKeyLine.value}
    }],
  ],
  use: {
    trace: 'retain-on-failure',
  },
})`,
);

const wrapConfigCode = computed(
  () => `import { defineConfig } from '@playwright/test'
import PiwiDashboard from '@piwitests/reporter'

export default PiwiDashboard.wrapConfig(
  defineConfig({
    // your existing config
    use: {
      trace: 'retain-on-failure',
    },
  }),
  {
    serverUrl: '${serverUrl.value}',
    projectName: 'my-project',${apiKeyLine.value}
  },
)`,
);

const fixturesExtendCode = `// tests/fixtures.ts
import { test as base, expect } from '@playwright/test'
import { piwiFixtures } from '@piwitests/reporter'

export const test = base.extend(piwiFixtures)
export { expect }`;

const fixturesUseCode = `// your test file
import { test, expect } from './fixtures'

test('homepage loads', async ({ page }) => {
  await page.goto('/')
  // network requests, web vitals, console errors, and ARIA snapshots
  // are captured automatically and appear in the dashboard
})`;

const fixturesDropInCode = `// tests/fixtures.ts
import { test as base } from '@playwright/test'
import { extendPiwiFixtures } from '@piwitests/reporter'

export const test = extendPiwiFixtures(base)
export { expect } from '@playwright/test'`;

interface WizardStep {
  title: string;
  description: string;
  done?: boolean;
  code?: string | null;
  lang?: string;
  /** Renders an inline call-to-action instead of (or alongside) a code block. */
  action?: 'create-api-key';
}

const steps = computed<Array<WizardStep & { id: number }>>(() => {
  const list: WizardStep[] = [
    {
      title: 'Start the dashboard',
      description: "You're already here — the dashboard is running.",
      done: true,
    },
    {
      title: 'Install the reporter',
      description: 'Add the Piwi reporter to your Playwright project.',
      code: 'npm install --save-dev @piwitests/reporter',
      lang: 'bash',
    },
  ];

  if (authEnabled.value) {
    list.push({
      title: 'Create an API key',
      description:
        'Authentication is enabled on this instance, so the reporter needs a key to submit results. Create one, then set it as PIWI_API_KEY in your CI secrets (used by the snippet below).',
      action: 'create-api-key',
    });
  }

  list.push(
    {
      title: 'Configure Playwright',
      description: isDesktop
        ? "Add the reporter to your playwright.config.ts. The apiKey below is this app's local access token."
        : 'Add the reporter to your playwright.config.ts.',
      code: configCode.value,
      lang: 'typescript',
    },
    {
      title: 'Run your tests',
      description: 'Results appear in the dashboard automatically. The project is created on first submit.',
      code: 'npx playwright test',
      lang: 'bash',
    },
  );

  return list.map((step, index) => ({ id: index + 1, ...step }));
});

const STEP_COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
const stepCountWord = computed(() => STEP_COUNT_WORDS[steps.value.length] ?? String(steps.value.length));

const goFurtherOpen = ref(false);
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-3">
        <div class="p-2 bg-primary/10 rounded-lg shrink-0">
          <UIcon name="i-lucide-rocket" class="size-5 text-primary" />
        </div>
        <div>
          <h2 class="text-xl font-semibold inline-flex items-center gap-1">
            Get started in 60 seconds <HelpHint topic="home.get-started" />
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">Send your first test run in {{ stepCountWord }} steps</p>
        </div>
      </div>
    </template>

    <div>
      <div v-for="(step, index) in steps" :key="step.id" class="flex gap-4">
        <!-- Step indicator + vertical connector -->
        <div class="flex flex-col items-center shrink-0">
          <div
            class="flex size-8 items-center justify-center rounded-full text-sm font-semibold"
            :class="
              step.done
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-primary/10 text-primary'
            "
          >
            <UIcon v-if="step.done" name="i-lucide-check" class="size-4" />
            <span v-else>{{ step.id }}</span>
          </div>
          <div v-if="index < steps.length - 1" class="w-px flex-1 mt-2 min-h-6 bg-gray-200 dark:bg-gray-700" />
        </div>

        <!-- Step content -->
        <div class="flex-1 pb-6">
          <div class="flex items-center gap-2 mb-1">
            <h3 class="font-medium">{{ step.title }}</h3>
            <UBadge v-if="step.done" color="success" variant="subtle" size="xs">Done</UBadge>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">{{ step.description }}</p>
          <UButton
            v-if="step.action === 'create-api-key'"
            to="/settings/users"
            icon="i-lucide-key-round"
            size="sm"
            variant="soft"
          >
            Create an API key
          </UButton>
          <CodeBlock v-if="step.code" :code="step.code" :lang="step.lang" />
        </div>
      </div>

      <!-- Go further (collapsible) -->
      <div class="border-t border-gray-200 dark:border-gray-700 pt-4 mt-2">
        <button
          class="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-primary transition-colors w-full text-left"
          @click="goFurtherOpen = !goFurtherOpen"
        >
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4 transition-transform duration-200"
            :class="goFurtherOpen ? 'rotate-90' : ''"
          />
          Go further — simpler config &amp; capture fixtures
        </button>

        <div v-if="goFurtherOpen" class="mt-4 space-y-6">
          <!-- wrapConfig -->
          <div>
            <h4 class="font-medium text-sm mb-1">
              Simpler config with <code class="text-primary text-xs">wrapConfig</code>
            </h4>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Instead of manually adding the reporter array entry,
              <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">wrapConfig</code>
              auto-injects the reporter and chains the global setup in one call. It also registers the run on the
              dashboard <em>before</em> your
              <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">globalSetup</code> runs, so the
              dashboard shows an initializing state during setup.
            </p>
            <CodeBlock :code="wrapConfigCode" lang="typescript" />
          </div>

          <!-- piwiFixtures -->
          <div>
            <h4 class="font-medium text-sm mb-1">
              Capture fixtures — network, Web Vitals, console &amp; locator healing with
              <code class="text-primary text-xs">piwiFixtures</code>
            </h4>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Extend your Playwright
              <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">test</code> with
              <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">piwiFixtures</code> to
              automatically capture network timing, browser Web Vitals, console errors, ARIA snapshots on failure, and
              the locator snapshots that power locator healing. See the
              <DocLink to="capture-fixtures" no-icon class="text-primary hover:underline"
                >capture fixtures guide</DocLink
              >.
            </p>

            <p class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
              Option A — extend your existing fixtures
            </p>
            <CodeBlock :code="fixturesExtendCode" lang="typescript" class="mb-3" />
            <CodeBlock :code="fixturesUseCode" lang="typescript" class="mb-4" />

            <p class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
              Option B — one-line extend
            </p>
            <CodeBlock :code="fixturesDropInCode" lang="typescript" />
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
        <span
          >Need more options? See the
          <DocLink to="reporter" no-icon class="text-primary hover:underline">full reporter docs</DocLink>.</span
        >
        <UButton
          :to="docsUrl('demo/')"
          target="_blank"
          variant="ghost"
          size="sm"
          color="neutral"
          trailing-icon="i-lucide-external-link"
        >
          View demo with sample data
        </UButton>
      </div>
    </template>
  </UCard>
</template>
