import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * Integration tests — these hit a REAL database and RESET draft state.
 * Guarded by ALLOW_DB_RESET=1; see the top of *.itest.ts.
 * Run sequentially: they share one draft row and would fight each other.
 */
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    include: ['src/**/*.itest.ts'],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
  },
})
