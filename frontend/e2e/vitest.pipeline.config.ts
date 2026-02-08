import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['e2e/pipeline/**/*.test.ts'],
    testTimeout: 600_000,  // 10 minutes per test (Replicate can be slow)
    hookTimeout: 60_000,
    pool: 'forks',
    maxConcurrency: 1,
    sequence: { concurrent: false },
    globals: true,
  },
})
