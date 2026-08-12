/**
 * PIN management.
 *
 *   npm run pins              # show who has claimed a seat
 *   npm run pins -- --set 1111   # set EVERY seat to the same PIN (testing)
 *   npm run pins -- --clear      # clear all PINs so everyone claims their own
 *
 * Run `--clear` before the real draft: a shared PIN is fine for a rehearsal and
 * pointless for the real thing, where the whole purpose is stopping someone
 * bidding from the wrong seat by mistake.
 */
import { neon } from '@neondatabase/serverless'
import { hashPin, isValidPinFormat } from '../src/lib/auth'

const args = process.argv.slice(2)
const flagValue = (flag: string) => {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  if (args.includes('--clear')) {
    await sql`UPDATE managers SET pin_hash = NULL`
    console.log('✓ cleared every PIN — each manager sets their own on first join\n')
  } else if (args.includes('--set')) {
    const pin = flagValue('--set')
    if (!pin || !isValidPinFormat(pin)) {
      throw new Error('--set needs a 4-digit PIN, e.g. `npm run pins -- --set 1111`')
    }
    // Hash per manager so the stored values still differ (unique salts).
    const managers = await sql`SELECT id FROM managers`
    for (const m of managers) {
      await sql`UPDATE managers SET pin_hash = ${await hashPin(pin)} WHERE id = ${m.id}`
    }
    console.log(`✓ every seat now uses PIN ${pin} — TESTING ONLY, clear it before Friday\n`)
  }

  const rows = await sql`
    SELECT display_name, draft_slot, is_commish, (pin_hash IS NOT NULL) AS claimed
    FROM managers ORDER BY draft_slot`
  console.table(
    rows.map((r) => ({
      seat: r.draft_slot + 1,
      manager: r.display_name,
      commissioner: r.is_commish ? 'yes' : '',
      status: r.claimed ? 'PIN set' : 'unclaimed — any 4 digits',
    })),
  )
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
