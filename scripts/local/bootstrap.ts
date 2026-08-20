/**
 * Build the local development schema from scratch.
 *
 *   npm run db:local:setup
 *
 * Brings an empty local Postgres (see docker-compose.yml) up to the current
 * schema, applies the hand-written SQL, and seeds it — the local equivalent of
 * `db:push && db:sql && db:seed`, which cannot be used here for one specific
 * reason.
 *
 * ## Why not `drizzle-kit push`
 *
 * `drizzle-kit` reaches for `@neondatabase/serverless` and connects over a
 * **WebSocket**. The local proxy serves only Neon's HTTP SQL endpoint (port 4444;
 * `docker inspect` confirms nothing else is exposed), so push hangs on "Pulling
 * schema from database" forever rather than failing.
 *
 * `drizzle-kit generate` needs no database at all — it diffs `src/db/schema.ts`
 * against its own snapshot and emits SQL — so the schema is generated offline and
 * then applied through the same HTTP client the app uses. That keeps a single
 * source of truth (`schema.ts`); nothing here restates a table definition.
 *
 * The generated output is regenerated every run and is gitignored: a committed
 * baseline would rot the moment the schema moved, and a stale one that still
 * applies cleanly is worse than none.
 *
 * ## This refuses to touch anything remote
 *
 * It drops and recreates. Pointed at Neon it would destroy the league's record,
 * so it checks the host and exits rather than trusting the caller.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { neon } from '@neondatabase/serverless'
import '../../src/db/neon-local'
import { isLocalDatabaseUrl } from '../../src/db/neon-local'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set.')

if (!isLocalDatabaseUrl(url)) {
  console.error(`\n✗ Refusing to run: ${new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).hostname} is not local.`)
  console.error('  This script drops and recreates the public schema.\n')
  process.exit(1)
}

const sql = neon(url)
const root = join(process.cwd())

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nBootstrapping local database "${dbName}"\n`)

  // A clean slate, so the generated baseline always applies. Local only — the
  // guard above is what makes this safe to say out loud.
  process.stdout.write('  drop and recreate public schema … ')
  // One statement per call: Neon's HTTP endpoint rejects a multi-statement
  // string with a bare syntax error (42601), which reads like bad SQL rather
  // than an unsupported shape.
  await sql.query('DROP SCHEMA public CASCADE')
  await sql.query('CREATE SCHEMA public')
  console.log('ok')

  // Regenerate rather than trust a committed file; see the header.
  process.stdout.write('  generate SQL from src/db/schema.ts … ')
  rmSync(join(root, 'drizzle'), { recursive: true, force: true })
  execFileSync('npx', ['drizzle-kit', 'generate', '--name=local'], { stdio: 'pipe' })
  console.log('ok')

  const genDir = join(root, 'drizzle')
  for (const file of readdirSync(genDir).filter((f) => f.endsWith('.sql')).sort()) {
    process.stdout.write(`  apply ${file} … `)
    // drizzle separates statements with its own breakpoint marker; the HTTP
    // driver is happy to take them one at a time.
    const body = readFileSync(join(genDir, file), 'utf8')
    for (const stmt of body.split('--> statement-breakpoint')) {
      if (stmt.trim()) await sql.query(stmt)
    }
    console.log('ok')
  }

  const sqlDir = join(root, 'src/db/sql')
  for (const file of readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort()) {
    process.stdout.write(`  apply ${file} … `)
    await sql.query(readFileSync(join(sqlDir, file), 'utf8'))
    console.log('ok')
  }

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`
  console.log(`\n  ${tables.length} tables/views:`)
  console.log(`  ${tables.map((t) => t.table_name).join(', ')}\n`)
  console.log('✓ Schema in place. Seed it next:  npm run db:local:seed\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
