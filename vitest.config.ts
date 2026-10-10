import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['web/src/**/*.test.ts', 'server/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
})
