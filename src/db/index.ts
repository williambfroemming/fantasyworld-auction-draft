import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
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
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local`.')
  return drizzle(neon(url), { schema })
}

let _db: ReturnType<typeof createDb> | null = null

export function getDb() {
  if (!_db) _db = createDb()
  return _db
}

export { schema }
