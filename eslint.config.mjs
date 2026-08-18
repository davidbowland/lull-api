// Fleet ESLint flat config — API / SAM+Lambda TypeScript flavor.
// ESLint 9 + typescript-eslint 8. Translated from the former .eslintrc.json,
// preserving original intent.
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import functional from 'eslint-plugin-functional'
import jest from 'eslint-plugin-jest'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // 1) Build artifacts and generated files never linted.
  {
    ignores: [
      '**/__mocks__/',
      '**/__snapshots__/',
      '.aws-sam/',
      '.swc/',
      'build/',
      'coverage/',
      'dist/',
      'node_modules/',
      '**/*.min.*',
      'jest.*.*',
    ],
  },

  // 2) Base recommended sets.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 3) Language options + fleet rule intent.
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        module: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '_', ignoreRestSiblings: true, varsIgnorePattern: '_' },
      ],
      'no-negated-condition': 'error',
      'sort-vars': 'error',
    },
  },

  // 4) eslint-plugin-functional LITE subset — validated to pass with zero
  //    code changes against the fleet's API source, except errors.ts (the
  //    one sanctioned OOP exception for custom Error subclasses).
  {
    files: ['src/**/*.ts'],
    ignores: ['**/errors.ts'],
    plugins: { functional },
    rules: {
      'functional/no-classes': 'error',
      'functional/no-this-expressions': 'error',
    },
  },

  // 5) Jest rules scoped to test / mock files only.
  {
    files: ['**/*.test.ts', '**/__tests__/**/*.ts', '**/__mocks__/**/*.ts'],
    ...jest.configs['flat/recommended'],
    settings: { jest: { version: 29 } },
    rules: {
      ...jest.configs['flat/recommended'].rules,
      'jest/no-mocks-import': 'off',
    },
  },

  // 6) Prettier LAST — disables all formatting rules that would fight prettier.
  prettier,
)
