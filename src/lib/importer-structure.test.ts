import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The history importer rewrites a season by deleting its rows and inserting new ones. Done
 * as a single `WITH x AS (DELETE ...) INSERT ...` statement it looks atomic but fails on
 * every re-import into a populated table (the INSERT cannot see the DELETE, so the primary
 * key collides). It must be an atomic `sql.transaction([...])` batch. Found by rehearsing the
 * live rollout; pinned here so it cannot come back.
 */
describe('the Sleeper importer', () => {
  const text = readFileSync(join(process.cwd(), 'scripts', 'import-sleeper-history.ts'), 'utf8')

  it('never rewrites a season with a DELETE inside a CTE', () => {
    expect(text).not.toMatch(/WITH\s+\w+\s+AS\s*\(\s*DELETE/i)
  })

  it('writes transactions and stat lines as atomic batches', () => {
    expect((text.match(/sql\.transaction\(/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})
