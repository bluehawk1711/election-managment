/**
 * Security rules tests, run against the Storage emulator.
 *
 * A separate project from `npm test` on purpose: these run under Node rather
 * than jest-expo, they need the emulator up, and they are the one place
 * `storage.rules` is actually executed. The Realtime Database rules cannot be
 * exercised this way (they depend on custom claims and cross-node paths), so
 * they are covered by `scripts/probe-writes.mjs` against the live project.
 * Drive these with `npm run rules:test`, which starts the emulator, runs this
 * config, and shuts it down again.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/rules-tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
  },
  // The emulator is not instant to talk to, and a cold rules evaluation on the
  // first assertion regularly takes longer than jest's 5s default.
  testTimeout: 20000,
};
