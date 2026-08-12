/**
 * Create and prepare a SEPARATE database for destructive tests.
 *
 *   npm run db:test-setup
 *
 * Why this exists: `npm run test:int` and `npm run smoke` delete every pick,
 * lot, and bid. Until now they pointed at the same database as the live draft,
 * with only a guard script standing between a mistyped command and an erased
 * draft. A guard is a warning; a separate database is a wall.
 *
 * Writes TEST_DATABASE_URL into .env.local. Everything destructive reads that
 * variable and refuses to run if it matches DATABASE_URL.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const TEST_DB_NAME = 'neondb_test'

function testUrlFrom(prodUrl: string): string {
  const u = new URL(prodUrl)
  u.pathname = `/${TEST_DB_NAME}`
  return u.toString()
}

async function main() {
  const prod = process.env.DATABASE_URL
  if (!prod) throw new Error('DATABASE_URL is not set.')

  const prodName = new URL(prod).pathname.slice(1)
  if (prodName === TEST_DB_NAME) {
    throw new Error(`DATABASE_URL already points at ${TEST_DB_NAME} — refusing.`)
  }

  const admin = neon(prod)
  const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB_NAME}`
  if (existing.length === 0) {
    // CREATE DATABASE cannot run inside a transaction; the HTTP driver sends
    // this as a single statement, which is exactly what's needed.
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`)
    console.log(`✓ created database ${TEST_DB_NAME}`)
  } else {
    console.log(`• database ${TEST_DB_NAME} already exists`)
  }

  const testUrl = testUrlFrom(prod)

  // Persist it for the test scripts.
  const envPath = '.env.local'
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const withoutOld = current
    .split('\n')
    .filter((l) => !l.startsWith('TEST_DATABASE_URL='))
    .join('\n')
    .replace(/\n+$/, '')
  writeFileSync(envPath, `${withoutOld}\nTEST_DATABASE_URL="${testUrl}"\n`)
  console.log('✓ wrote TEST_DATABASE_URL to .env.local')

  console.log(`\nNow run:\n  npm run db:test-migrate\n`)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
