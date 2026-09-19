/** @type {import('jest').Config} */
// Unit-test config for a standalone Open Mercato app.
// Integration tests run through Playwright (`yarn test:integration:ephemeral`)
// and are excluded here.
// `create-mercato-app` skips `__tests__`/`__integration__` while copying the
// template, so a freshly scaffolded app owns no test files until you write one.
module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  passWithNoTests: true,
  rootDir: '.',
  roots: ['<rootDir>/src'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/\\.mercato/(.*)$': '<rootDir>/.mercato/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^#generated/(.*)$': '<rootDir>/.mercato/generated/$1',
  },
  // `@open-mercato/shared/lib/commands` pulls in ESM-only MikroORM, whose
  // `import.meta.resolve` cannot be parsed as CommonJS. The local transformer
  // strips those usages before delegating to ts-jest; without it every command,
  // entity, or data-engine test fails to load.
  transform: {
    '^.+\\.(t|j)sx?$': [
      '<rootDir>/scripts/jest-mikroorm-transformer.cjs',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowJs: true,
          isolatedModules: true,
        },
        diagnostics: false,
      },
    ],
  },
  // `kysely` ships ESM only and is reached through `@mikro-orm/sql`. Tests that
  // open a real Postgres connection (the workflow-engine durability suite) load
  // that driver, so it has to be transformed like the rest.
  transformIgnorePatterns: ['/node_modules/(?!(@open-mercato|@mikro-orm|kysely|@tanstack/react-table|@tanstack/table-core|@tanstack/react-store|@tanstack/store)/)'],
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/.mercato/', '/.ai/qa/', '/__integration__/'],
}
