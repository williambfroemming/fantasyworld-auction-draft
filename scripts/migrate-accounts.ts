/**
 * Migration: PIN reset links, linked fantasy accounts, and sign-up requests.
 *
 *   npm run db:migrate-accounts              # against DATABASE_URL
 *   npm run db:migrate-accounts -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written and idempotent (AGENTS.md: `drizzle-kit push` cannot tell a new table
 * from a rename). Purely additive — two nullable columns and two new tables — so it can
 * and MUST be run on the live database before the code that reads them is deployed.
 *
 * Then it links every existing seat to its Sleeper accounts from `MEMBERS`
 * (src/lib/history-identity.ts), matched on `managers.name`, so the ten current members
 * are never asked to prove anything. Usernames come from the committed league files.
 */
import { existsSync, readFileSync } from 'node:fs'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { MEMBERS } from '../src/lib/history-identity'

const useTest = process.argv.includes('--test')
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL
if (!url) throw new Error(`${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set.`)

const sql: NeonQueryFunction<false, false> = neon(url)

async function step(label: string, statement: string) {
  process.stdout.write(`  ${label} … `)
  await sql.query(statement)
  console.log('ok')
}

/** Sleeper user_id -> display name, from the newest committed users.json that has one. */
function sleeperUsernames(): Map<string, string> {
  const names = new Map<string, string>()
  for (const season of [2026, 2025, 2024, 2023, 2022]) {
    const file = `data/sleeper/${season}/users.json`
    if (!existsSync(file)) continue
    for (const u of JSON.parse(readFileSync(file, 'utf8')) as Array<{ user_id: string; display_name: string }>) {
      if (!names.has(u.user_id)) names.set(u.user_id, u.display_name)
    }
  }
  return names
}

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nAdding accounts (reset links, linked accounts, join requests) to "${dbName}"\n`)

  await step('managers.pin_reset_hash', `ALTER TABLE managers ADD COLUMN IF NOT EXISTS pin_reset_hash text`)
  await step('managers.pin_reset_expires', `ALTER TABLE managers ADD COLUMN IF NOT EXISTS pin_reset_expires timestamptz`)
  await step(
    'create member_identities',
    `CREATE TABLE IF NOT EXISTS member_identities (
       id                serial PRIMARY KEY,
       manager_id        integer NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
       provider          text NOT NULL,
       external_user_id  text NOT NULL,
       external_username text,
       verified_at       timestamptz,
       created_at        timestamptz NOT NULL DEFAULT now()
     )`,
  )
  await step(
    'member_identities unique (provider, user)',
    `CREATE UNIQUE INDEX IF NOT EXISTS member_identities_provider_user_idx ON member_identities (provider, external_user_id)`,
  )
  await step(
    'member_identities by manager',
    `CREATE INDEX IF NOT EXISTS member_identities_manager_idx ON member_identities (manager_id)`,
  )
  await step(
    'create join_requests',
    `CREATE TABLE IF NOT EXISTS join_requests (
       id                serial PRIMARY KEY,
       provider          text NOT NULL,
       external_user_id  text NOT NULL,
       external_username text,
       display_name      text NOT NULL,
       pin_hash          text NOT NULL,
       verified_at       timestamptz NOT NULL,
       created_at        timestamptz NOT NULL DEFAULT now()
     )`,
  )
  await step(
    'join_requests unique (provider, user)',
    `CREATE UNIQUE INDEX IF NOT EXISTS join_requests_provider_user_idx ON join_requests (provider, external_user_id)`,
  )

  // Link the existing seats. Matched on the canonical name, never on id, so a local or
  // test database seeded in a different order still links the right people.
  const usernames = sleeperUsernames()
  let linked = 0
  const missing: string[] = []
  for (const m of MEMBERS) {
    const [seat] = await sql`SELECT id FROM managers WHERE name = ${m.appName}`
    if (!seat) {
      missing.push(m.appName)
      continue
    }
    for (const userId of m.sleeperUserIds) {
      const rows = await sql`
        INSERT INTO member_identities (manager_id, provider, external_user_id, external_username)
        VALUES (${seat.id}, 'sleeper', ${userId}, ${usernames.get(userId) ?? null})
        ON CONFLICT (provider, external_user_id) DO NOTHING
        RETURNING id`
      linked += rows.length
    }
  }

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM member_identities`
  const [{ nopin }] = await sql`SELECT count(*)::int AS nopin FROM managers WHERE pin_hash IS NULL`
  console.log(`\n✓ ready — linked ${linked} new Sleeper account(s), ${n} on record.`)
  if (missing.length) console.log(`  ⚠ no seat named: ${missing.join(', ')}`)
  if (Number(nopin) > 0) {
    console.log(
      `  ⚠ ${nopin} seat(s) have no PIN. Empty seats can no longer be claimed by typing a PIN —\n` +
        `    send each of them a reset link from Admin → Members & access.`,
    )
  }
  console.log()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
