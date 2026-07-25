import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
const ogImage = 'https://piwitests.github.io/og-image.png'
const siteUrl = 'https://piwitests.github.io'

export default defineConfig({
  title: 'Piwi Dashboard',
  description: 'A modern dashboard for storing and visualising Playwright test results',
  base: '/',
  // Example values in the generated configuration reference (PIWI_SITE_URL,
  // Ollama base URLs) are intentionally unreachable localhost URLs.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
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
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Piwi Dashboard — A permanent home for your Playwright test results' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Live dashboards, failure clustering, and flaky-test tracking for your whole team — self-hosted, no SaaS.',
      },
    ],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:url', content: siteUrl }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Piwi Dashboard — A permanent home for your Playwright test results' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Live dashboards, failure clustering, and flaky-test tracking for your whole team — self-hosted, no SaaS.',
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
      { text: 'API docs', link: 'https://piwitests.github.io/demo/docs' },
      { text: 'Demo', link: 'https://piwitests.github.io/demo/' },
    ],

    sidebar: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Why Piwi? (comparison & FAQ)', link: '/comparison' },
      { text: 'UI overview', link: '/ui-overview' },
      { text: 'Reporter', link: '/reporter' },
      { text: 'Capture fixtures', link: '/capture-fixtures' },
      { text: 'Importing past runs', link: '/importing-runs' },
      {
        text: 'Features',
        items: [
          { text: 'AI diagnosis & clustering', link: '/ai-diagnosis' },
          { text: 'Flaky tests & analytics', link: '/flaky-tests' },
          { text: 'Timeline markers', link: '/timeline-markers' },
          { text: 'Notifications & alerts', link: '/notifications' },
        ],
      },
      {
        text: 'Configuration',
        items: [
          { text: 'Configuration reference', link: '/configuration' },
          { text: 'Configuration generator', link: '/configuration/generator' },
          { text: 'Authentication', link: '/authentication' },
          { text: 'Storage configuration', link: '/storage' },
          { text: 'Deployment', link: '/deployment' },
          { text: 'Desktop app', link: '/desktop' },
        ],
      },
      {
        text: 'Integrate',
        items: [
          { text: 'API docs (interactive)', link: 'https://piwitests.github.io/demo/docs' },
          { text: 'MCP server', link: '/mcp' },
          { text: 'Open in IDE', link: '/ide-integration' },
          { text: 'Backend logs', link: '/backend-logs' },
        ],
      },
    ],

    editLink: {
      pattern: 'https://github.com/PiwiTests/platform/edit/main/docs/:path',
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
