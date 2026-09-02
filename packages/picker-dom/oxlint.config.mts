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
      // Browser-context modules (injected into a page/iframe by all three
      // hosts) must stay Node-free and import-free of anything outside this
      // package — see each file's own doc comment for the serialization
      // constraint this enforces.
      files: ['src/probe.ts', 'src/overlay-element.ts', 'src/overlay-anchors.ts', 'src/overlay-confirm.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [{ group: ['node:*'], message: 'Browser-context picker modules must stay Node-free.' }],
          },
        ],
      },
    },
  ],
})
