import { defineConfig } from 'oxlint'
import base from '../../shared/oxlint.baseConfig.mts'

export default defineConfig({
  ...base,
  plugins: ['typescript', 'unicorn', 'import'],
  ignorePatterns: [...base.ignorePatterns],
  rules: {
    ...base.rules,
    'unicorn/prefer-node-protocol': 'error',
    '@typescript-eslint/consistent-type-imports': 'error',
  },
  overrides: [
    {
      // Core source must stay pure: no Node built-ins (it has to be
      // browser/worker/server-safe) and no cross-package imports. The boundary
      // test in tests/ scans the source and may itself use node:*.
      files: ['src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['node:*'], message: 'Core must stay Node-free — keep runtime needing node:* in the reporter.' },
              { group: ['**/application/**', '**/reporter/**'], message: 'Core must not import from application/ or reporter/.' },
            ],
          },
        ],
      },
    },
  ],
})
