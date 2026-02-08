import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    exclude: ['e2e/pipeline/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: 'forks',
    maxConcurrency: 1,
    sequence: { concurrent: false },
    globals: true,
  },
})
