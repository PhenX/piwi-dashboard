import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
const ogImage = 'https://piwitests.dev/og-image.png'
const siteUrl = 'https://piwitests.dev'

export default defineConfig({
  title: 'Piwi Dashboard',
  description:
    'CI throws away every report it makes. Piwi keeps them — then groups the failures by root cause, scores the flaky tests, and finds the locator you should have used. Self-hosted, MIT, zero telemetry.',
  base: '/',
  // AGENTS.md is the agent guide for this directory, not a page of the site:
  // it links to sibling guides outside the docs root, so building it as a page
  // both publishes the wrong thing and fails the dead-link check.
  srcExclude: ['AGENTS.md'],
  // Example values in the generated configuration reference (PIWI_SITE_URL,
  // Ollama base URLs) are intentionally unreachable localhost URLs.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  sitemap: {
    hostname: siteUrl,
  },
  vite: {
    // The #shared modules imported below live outside the docs root, and their
    // nearest tsconfig (application/tsconfig.json) references Nuxt-generated
    // .nuxt/tsconfig.*.json files that only exist after the app has been
    // installed. Inline an empty tsconfig so the docs build never reads
    // on-disk tsconfigs and stays independent of the app's install state.
    esbuild: {
      tsconfigRaw: '{}',
    },
    resolve: {
      alias: {
        // The env-var registry and format emitters are imported straight from
        // the application's shared modules — same alias the app uses, so the
        // docs (reference page + generator) can never drift from the code.
        '#shared': fileURLToPath(new URL('../../application/shared', import.meta.url)),
      },
    },
  },
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico', sizes: 'any' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Piwi Dashboard — Your Playwright results, kept and explained' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'CI throws away every report it makes. Piwi keeps them — then groups failures by root cause, scores flaky tests, and finds the locator you should have used. Self-hosted, MIT, zero telemetry.',
      },
    ],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:url', content: siteUrl }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Piwi Dashboard — Your Playwright results, kept and explained' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'CI throws away every report it makes. Piwi keeps them — then groups failures by root cause, scores flaky tests, and finds the locator you should have used. Self-hosted, MIT, zero telemetry.',
      },
    ],
    ['meta', { name: 'twitter:image', content: ogImage }],
  ],
  themeConfig: {
    outline: 'deep',
    search: {
      provider: 'local',
    },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Reporter', link: '/reporter' },
      // Recipes and Operate each have their own path-prefixed sidebar, so their
      // groups no longer ride along on every page — the top nav is how a reader
      // reaches them from outside those prefixes. activeMatch keeps the nav item
      // highlighted across every page under the section.
      { text: 'Features', link: '/features/ui-overview', activeMatch: '/features/' },
      { text: 'Recipes', link: '/recipes/' },
      { text: 'Operate', link: '/operate/deployment', activeMatch: '/operate/' },
      { text: 'Blog', link: '/blog/' },
      { text: 'API docs', link: 'https://piwitests.dev/demo/docs' },
      { text: 'Demo', link: 'https://piwitests.dev/demo/' },
    ],

    // Sidebar order follows the reader's journey: understand it → get results
    // in → read them → run the instance → wire it into other tools. A group
    // answers one question the reader is holding, so a page belongs to the
    // group matching what they are doing, never to the feature it describes.
    // Multi-sidebar, keyed by URL path prefix (VitePress picks the sidebar whose
    // key prefixes the current path, longest match first). The restructure moves
    // each section under its own prefix so it can present a focused sidebar:
    // Recipes live under /recipes/, the result-reading feature pages under
    // /features/, the operator pages under /operate/. Every page not yet moved
    // falls back to the journey-ordered '/' sidebar below. As the remaining
    // sections move (guide/ reference/), each gets a key here and leaves the
    // fallback.
    sidebar: {
      '/recipes/': [
        {
          text: 'Recipes',
          items: [
            { text: 'All recipes', link: '/recipes/' },
            { text: 'Regression or flake?', link: '/recipes/regression-or-flaky' },
            { text: 'Fix a broken locator', link: '/recipes/broken-locator' },
            { text: 'Triage a run gone red', link: '/recipes/mass-failure' },
            { text: 'Cut costly flakiness', link: '/recipes/flaky-cleanup' },
            { text: 'Cut the time it costs', link: '/recipes/faster-suite' },
          ],
        },
      ],
      // Operate — the operator's journey: stand it up, secure it, mind the data,
      // keep it current. The configuration reference and generator stay in the
      // '/' fallback for now; they move to a Reference sidebar in a later step.
      '/operate/': [
        {
          text: 'Operate',
          items: [
            { text: 'Deployment', link: '/operate/deployment' },
            { text: 'Production checklist', link: '/operate/production-checklist' },
            { text: 'Authentication', link: '/operate/authentication' },
            { text: 'Database', link: '/operate/database' },
            { text: 'Storage configuration', link: '/operate/storage' },
            { text: 'Backup & restore', link: '/operate/backup-restore' },
            { text: 'Upgrading', link: '/operate/upgrading' },
            { text: 'Configuration reference', link: '/configuration' },
            { text: 'Configuration generator', link: '/configuration/generator' },
          ],
        },
      ],
      // Features — reading the results: what the dashboard shows you and does
      // with a run, from the dashboard map through evidence, clusters, diagnosis,
      // the fix, and the supporting lenses (analytics, notifications, sharing).
      '/features/': [
        {
          text: 'Reading the results',
          items: [
            { text: 'UI overview', link: '/features/ui-overview' },
            { text: 'Failure evidence', link: '/features/evidence' },
            { text: 'Failure clusters & the inbox', link: '/features/failure-clusters' },
            { text: 'AI diagnosis & clustering', link: '/features/ai-diagnosis' },
            { text: 'Fix plans, reproduce & bisect', link: '/features/fix-plans' },
            { text: 'What changed in a run', link: '/features/run-changes' },
            { text: 'Flaky tests', link: '/features/flaky-tests' },
            { text: 'Slow tests & wasted time', link: '/features/slow-tests' },
            { text: 'Branches', link: '/features/branches' },
            { text: 'Analytics', link: '/features/analytics' },
            { text: 'Timeline markers', link: '/features/timeline-markers' },
            { text: 'Notifications & alerts', link: '/features/notifications' },
            { text: 'Locator healing', link: '/features/locator-healing' },
            { text: 'Auto-heal PRs', link: '/features/auto-heal' },
            { text: 'Offline export', link: '/features/offline-export' },
            { text: 'Share links', link: '/features/share-links' },
          ],
        },
      ],
      '/': [
        {
          text: 'Start here',
          items: [
            { text: 'What Piwi does', link: '/what-piwi-does' },
            { text: 'Getting started', link: '/getting-started' },
            { text: 'Core concepts', link: '/concepts' },
            { text: 'Your first failure, explained', link: '/first-failure' },
            { text: 'Why Piwi? (comparison & FAQ)', link: '/comparison' },
            { text: 'Privacy & data flow', link: '/privacy' },
          ],
        },
        {
          text: 'Sending results',
          items: [
            { text: 'Reporter', link: '/reporter' },
            { text: 'Capture fixtures', link: '/capture-fixtures' },
            { text: 'AI steps', link: '/ai-steps' },
            { text: 'CI & sharding', link: '/ci' },
            { text: 'Test selections', link: '/test-selection' },
            { text: 'Backend logs', link: '/backend-logs' },
            { text: 'Importing past runs', link: '/importing-runs' },
          ],
        },
        {
          // The result-reading feature pages moved to the /features/ sidebar
          // (reached via the Features nav); the operator pages moved to
          // /operate/. What remains here is the configuration reference and
          // generator, still at the root path until they move to Reference.
          text: 'Configuration',
          items: [
            { text: 'Configuration reference', link: '/configuration' },
            { text: 'Configuration generator', link: '/configuration/generator' },
          ],
        },
        {
          text: 'Apps & integrations',
          items: [
            { text: 'Piwi CLI', link: '/cli' },
            { text: 'Desktop app', link: '/desktop' },
            { text: 'Browser extension', link: '/extension' },
            { text: 'Test functions catalog', link: '/test-functions' },
            { text: 'Open in IDE', link: '/ide-integration' },
            { text: 'MCP server', link: '/mcp' },
            { text: 'Agent skills', link: '/mcp#agent-skills' },
            { text: 'API docs (interactive)', link: 'https://piwitests.dev/demo/docs' },
          ],
        },
      ],
    },

    editLink: {
      pattern: 'https://github.com/PiwiTests/platform/edit/main/apps/docs/:path',
      text: 'Edit this page on GitHub',
    },

    lastUpdated: {
      text: 'Updated at',
      formatOptions: {
        dateStyle: 'full',
        timeStyle: 'medium',
      },
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/PiwiTests/platform' },
    ],

    externalLinkIcon: true,

    footer: {
      message:
        'Released under the MIT License. Zero telemetry — Piwi never phones home.<br>Piwi Dashboard is not affiliated with, endorsed by, or connected to Microsoft Corporation. Playwright is a trademark of Microsoft.',
      copyright: 'Copyright © 2025-present Fabien Ménager',
    },
  },
})
