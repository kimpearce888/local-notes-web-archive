import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'dev/test-results/**',
      'node_modules/**',
      // T-083: archived task evidence (spec copies saved as QA evidence) —
      // never linted; see dev/task-deliverables/README.md
      'dev/task-deliverables/**',
      // T-109: human-QA evidence (videos, screenshots, logs) — not code.
      'dev/artifacts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node tooling scripts — the build/release pipeline at scripts/ and the
    // dev-only audit tooling at dev/scripts/ (T-109 layout).
    files: ['scripts/**/*.mjs', 'dev/scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // PRD §7: no dynamic code execution — enforce statically where possible.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Pre-paint theme hint: intentionally plain browser JS (runs before any
    // bundling, inline in the document head's place — CSP 'self' external).
    files: ['public/theme-hint.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
