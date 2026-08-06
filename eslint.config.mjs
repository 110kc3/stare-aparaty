// ESLint flat config. Deliberately no package.json / node_modules: CI runs it
// via `npx --yes eslint@9`, matching the repo's dependency-free build path.
// Run locally the same way: npx --yes eslint@9 .
//
// The rule set is intentionally narrow — correctness only, no style opinions.
// Formatting is left to the existing hand-maintained conventions rather than a
// formatter, so a lint run never produces a diff that buries real history.
export default [
  {
    files: ['scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
        Intl: 'readonly',
        setTimeout: 'readonly',
        TextDecoder: 'readonly',
        Buffer: 'readonly',
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // The bugs a lint run can actually catch in this codebase.
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-await-in-loop': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-fallthrough': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable': 'error',
      'no-unsafe-negation': 'error',
      // Off: its only hit here is `process.exitCode = 1` after an await in a
      // strictly sequential function — a known false positive for this rule.
      'require-atomic-updates': 'off',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // refresh-amazon.js passes callbacks to Playwright's page.evaluate(), whose
    // bodies execute in the browser — those reference browser globals that do
    // not exist in the Node scope around them.
    files: ['scripts/refresh-amazon.js'],
    languageOptions: {
      globals: {
        navigator: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
  },
];
