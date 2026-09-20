import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      // Marks identifiers referenced inside JSX as used, which the base
      // no-unused-vars rule cannot see on its own.
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    settings: { react: { version: 'detect' } },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // jsxPragma: null tells the rule that JSX compiles via the automatic
      // runtime, so identifiers used only inside JSX (motion, Icon, ...) count
      // as used. Without it every JSX-only import is a false positive.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        args: 'after-used',
        argsIgnorePattern: '^_',
      }],
      // These files intentionally export helpers next to components.
      'react-refresh/only-export-components': 'off',
      'react/prop-types': 'off',
    },
    linterOptions: { reportUnusedDisableDirectives: true },
  },
])
