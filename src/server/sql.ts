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
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set.')
    _sql = neon(url)
  }
  return _sql
}
