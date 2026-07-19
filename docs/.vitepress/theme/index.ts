import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import ConfigModeSwitch from './components/ConfigModeSwitch.vue'
import EnvWizard from './components/EnvWizard.vue'
import './custom.css'

// Extends the default VitePress theme with a small amount of custom CSS (see
// custom.css) — used to style inline screenshot figures on content pages — and
// the configuration reference/generator components used on /configuration and
// /configuration/generator.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ConfigModeSwitch', ConfigModeSwitch)
    app.component('EnvWizard', EnvWizard)
  },
} satisfies Theme
