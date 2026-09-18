// `@types/jest` is installed but TypeScript's automatic inclusion from
// `typeRoots` skips it, so `describe`, `it` and `expect` resolve at runtime yet
// fail `yarn typecheck` with "Cannot find name 'describe'". Referencing the
// package explicitly restores the globals for the whole program without
// pinning a `types` list in tsconfig.json, which would disable automatic
// inclusion for every other @types package.
/// <reference types="jest" />
