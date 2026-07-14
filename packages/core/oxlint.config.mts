import { defineConfig } from 'oxlint'
import base from '../../shared/oxlint.baseConfig.mts'

export default defineConfig({
  ...base,
  plugins: ['typescript', 'unicorn', 'import'],
  ignorePatterns: [...base.ignorePatterns],
  rules: {
    ...base.rules,
    // Core is pure and dependency-free: forbid Node built-ins (it must stay
    // browser/worker/server-safe) and cross-package imports (no app/reporter
    // leakage). The boundary test enforces the same invariants at runtime.
    'unicorn/prefer-node-protocol': 'error',
    '@typescript-eslint/consistent-type-imports': 'error',
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['node:*'], message: 'Core must stay Node-free — keep runtime that needs node:* in the reporter.' },
          { group: ['**/application/**', '**/reporter/**'], message: 'Core must not import from application/ or reporter/.' },
        ],
      },
    ],
  },
})
