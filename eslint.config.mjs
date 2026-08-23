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

  // 4.5) The registry is data. generators/index.ts and services/packs.ts are on the public GET's
  //      module graph -- get-pack-by-date.ts imports packs.ts, packs.ts imports the registry, and
  //      isComplete uses every entry, so esbuild cannot shake any of it out. An implementation import
  //      here puts the Bedrock SDK into that function's bundle and constructs a BedrockRuntimeClient
  //      at every cold start, in a role holding no grant to use it. Measured on this checkout
  //      against a positive control that wires one SDK-importing model generator into
  //      modelContributions: 624,978 -> 693,296 bytes bundled, and 11,835 -> 12,088 bytes with the
  //      AWS SDK external, going from zero Bedrock references to a module-scope client construction.
  //
  //      SOURCEMAP INCLUDED, because template.yaml sets it (`Sourcemap: true`, :171) and figures
  //      quoted as that function's real build have to be that build. It costs a flat 45 bytes -- the
  //      sourceMappingURL comment -- so the same run without it reads 624,933 -> 693,251 and
  //      11,790 -> 12,043, and the deltas that carry the argument are identical either way.
  //
  //      THIS RULE IS THE WEAKER OF THE TWO GUARDS AND ONLY MATCHES THESE PATHS BY NAME. It catches
  //      a direct import of a module it has been told about. It does not catch a registry leaf that
  //      reaches Bedrock several hops down, and it does not catch a new implementation module under
  //      any other name -- measured: the positive control above wires in `./__positive` and this
  //      rule exits 0 on it, while the module-factory probe in
  //      __tests__/unit/generators/index.test.ts fails. That probe is the guard that holds the
  //      invariant; this one turns the most likely single mistake into a lint error at the keystroke
  //      rather than at `npm test`. Two guards, because neither sees what the other does.
  {
    files: ['src/generators/index.ts', 'src/services/packs.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // `@generators/model` is listed separately because `**/generators/model` does not
              // reach it: minimatch matches PATH SEGMENTS, and `@generators` is not a segment equal
              // to `generators`. Latent rather than live today -- tsconfig's `paths` block is
              // commented out, so only Jest's moduleNameMapper defines the alias and src/ cannot
              // compile with it -- but the aliases are already the house style in __tests__, and
              // uncommenting `paths` is one line away. Measured before this entry existed:
              // `import { modelGenerators } from '@generators/model'` in this file, eslint 0 errors.
              group: ['**/generators/model', './model', '../generators/model', '@generators/model'],
              message:
                'The registry is DATA. modelGenerators holds implementations that reach Bedrock; importing it here puts the Bedrock SDK into GetPackByDateFunction bundle. Read modelContributions instead.',
            },
            {
              // `@services/bedrock` for the same segment reason as `@generators/model` above, and
              // `@aws-sdk/client-bedrock*` rather than the one package name so a sibling is caught
              // too: `*` does not cross `/`, so this covers client-bedrock-agent-runtime and
              // whatever else AWS ships under that prefix, and nothing outside it. Measured before
              // these entries existed: both `@services/bedrock` and
              // `@aws-sdk/client-bedrock-agent-runtime` linted 0 errors in this file.
              group: [
                '**/services/bedrock',
                './bedrock',
                '../services/bedrock',
                '@services/bedrock',
                '@aws-sdk/client-bedrock*',
              ],
              message:
                'Nothing on the request path may reach Bedrock. get-pack-by-date.ts imports packs.ts, which imports the registry, and isComplete uses every entry -- so esbuild cannot shake this out.',
            },
          ],
        },
      ],
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
      // TEST FILES ONLY -- src/ still forbids require(). Jest's module-registry APIs are CommonJS by
      // construction: jest.resetModules() and jest.isolateModules() exist to make a module load
      // AGAIN, and an ESM import cannot do that, because it is hoisted and evaluated once before any
      // statement in the file runs. The Bedrock probe in __tests__/unit/generators/index.test.ts is
      // the reason this is here, and re-loading a module under a fresh registry is the whole of what
      // it does.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // 6) Prettier LAST — disables all formatting rules that would fight prettier.
  prettier,
)
