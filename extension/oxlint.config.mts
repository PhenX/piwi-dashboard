import { defineConfig } from 'oxlint'
import base from '../shared/oxlint.baseConfig.mts'

export default defineConfig({
  ...base,
  plugins: ['typescript', 'unicorn', 'import'],
  ignorePatterns: [...base.ignorePatterns, 'dist/**'],
  rules: {
    ...base.rules,
    '@typescript-eslint/consistent-type-imports': 'error',
  },
})
