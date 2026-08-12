import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/** Unit tests only — pure, fast, no database. */
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.itest.ts'],
  },
})
