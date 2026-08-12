/**
 * Applies the hand-written SQL in src/db/sql/ after `drizzle-kit push`.
 * drizzle-kit manages tables; views live here so they stay readable.
 *
 * Run: npx dotenv -e .env.local -- npx tsx scripts/apply-sql.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { neon } from '@neondatabase/serverless'

const dir = join(process.cwd(), 'src/db/sql')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local` first.')
  const sql = neon(url)

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    process.stdout.write(`applying ${file} … `)
    await sql.query(readFileSync(join(dir, file), 'utf8'))
    console.log('ok')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
