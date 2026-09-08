import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '@/db/neon-local'

/**
 * Raw Neon client for the auction's SQL.
 *
 * The bid/nominate/settle paths are written as hand-rolled single statements
 * (CTEs, conditional UPDATEs) because their correctness *is* the SQL — see
 * docs/PROJECT_PLAN.md §4. An ORM would obscure exactly the part that matters.
 * Drizzle is still used for ordinary reads elsewhere.
 *
 * Lazy for the same reason as getDb(): `neon()` throws without DATABASE_URL and
 * Next evaluates module scope at build time.
 */
let _sql: NeonQueryFunction<false, false> | null = null

export function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = readDatabaseUrl()
    _sql = neon(url)
  }
  return _sql
}

/**
 * `DATABASE_URL`, trimmed.
 *
 * ⚠️ **The trim is load-bearing, and the asymmetry is why.** `neon()` parses
 * with `new URL()`, which strips *trailing* C0 whitespace and not *leading* —
 * so a connection string with a newline on the end works fine and the identical
 * string with one on the front throws "not a valid URL", naming a value nobody
 * can print to compare. That cost two failed runs of the weekly workflow before
 * anyone noticed the secret was multi-line.
 *
 * A stored secret picks up surrounding whitespace extremely easily: editors add
 * a trailing newline, and a copy that starts a line before the value adds a
 * leading one. There is no connection string for which surrounding whitespace
 * is meaningful, so trimming is unambiguous rather than lenient — and it is
 * better placed here than in a paste instruction nobody reads twice.
 */
export function readDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL
  if (!raw || raw.trim() === '') {
    throw new Error(
      raw === undefined
        ? 'DATABASE_URL is not set.'
        : 'DATABASE_URL is set but empty (or only whitespace).',
    )
  }
  return raw.trim()
}
