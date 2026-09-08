import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import './neon-local'
import { readDatabaseUrl } from '@/server/sql'
import * as schema from './schema'

/**
 * Lazy DB accessor.
 *
 * `neon()` throws if DATABASE_URL is unset, and Next evaluates top-level module
 * code at build time — so initializing at module scope crashes `next build`
 * before the database is provisioned. Hence a plain function.
 *
 * Deliberately NOT a Proxy wrapper: Proxies break libraries that introspect the
 * client object, and the failure mode is a silent hang rather than an error.
 */
function createDb() {
  // Trimmed, via the one helper -- see `readDatabaseUrl`. `neon()` strips
  // trailing whitespace when it parses and not leading, so a secret with a
  // newline on the front fails here and an otherwise identical one does not.
  return drizzle(neon(readDatabaseUrl()), { schema })
}

let _db: ReturnType<typeof createDb> | null = null

export function getDb() {
  if (!_db) _db = createDb()
  return _db
}

export { schema }
