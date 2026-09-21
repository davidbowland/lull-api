/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */

export default {
  // Tests must never clear mocks by hand; this does it.
  clearMocks: true,

  collectCoverage: true,

  collectCoverageFrom: ['src/**/*'],

  coverageDirectory: 'coverage',

  // Assets are data, and config.ts/types.ts are declarations with nothing to execute.
  coveragePathIgnorePatterns: ['assets/*', 'config.ts', 'types.ts'],

  coverageProvider: 'v8',

  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 80,
    },
  },

  // Keeps test imports aligned with tsconfig paths; add a path in both or neither.
  moduleNameMapper: {
    '^@config$': '<rootDir>/src/config',
    '^@events/(.*)$': '<rootDir>/events/$1',
    '^@generators/(.*)$': '<rootDir>/src/generators/$1',
    '^@handlers/(.*)$': '<rootDir>/src/handlers/$1',
    '^@rules/(.*)$': '<rootDir>/src/rules/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@types$': '<rootDir>/src/types',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
  },

  // Sets TZ=UTC, so a developer machine east of UTC cannot pass what CI will fail.
  setupFiles: ['<rootDir>/jest.setup-test-env.js'],

  // `__mocks__` holds shared fixtures rather than suites, so collecting it fails the run with
  // "must contain at least one test". The worktree paths are gitignored checkouts inside the repo;
  // Jest globs the working directory rather than the git index, so without them a run in the main
  // worktree collects every sibling worktree's copy of the suite and a green gate stops meaning
  // this tree is green.
  testPathIgnorePatterns: ['__mocks__', '/\\.claude/', '/\\.worktrees/'],
}
