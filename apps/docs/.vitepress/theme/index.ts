import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import ConfigModeSwitch from './components/ConfigModeSwitch.vue'
import EnvWizard from './components/EnvWizard.vue'
import './custom.css'

// Extends the default VitePress theme with a small amount of custom CSS (see
// custom.css) — used to style inline screenshot figures on content pages — the
// configuration reference/generator components used on /configuration and
// /configuration/generator, and a Layout wrapper that mounts the in-docs chat
// assistant (DocsChat) as a floating widget on every page.
export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('ConfigModeSwitch', ConfigModeSwitch)
    app.component('EnvWizard', EnvWizard)
  },
} satisfies Theme
