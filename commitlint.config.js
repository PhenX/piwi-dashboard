export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'docs', 'chore', 'ci', 'refactor', 'test', 'build', 'style', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      ['app', 'reporter', 'db', 'ui', 'demo', 'ci', 'docs', 'deps', 'auth', 'ai', 'notifications', 'release'],
    ],
    'scope-empty': [1, 'never'],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
  },
};
