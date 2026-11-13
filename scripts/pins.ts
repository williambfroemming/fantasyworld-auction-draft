/**
 * PIN management.
 *
 *   npm run pins              # show who has claimed a seat
 *   npm run pins -- --set 1111   # set EVERY seat to the same PIN (testing)
 *   npm run pins -- --clear      # clear all PINs (rehearsal clean-up)
 *
 * ⚠️ A cleared seat can no longer be claimed from /join — that was a race anyone on
 * the internet could win. After `--clear`, each member needs a reset link from
 * Admin → Members & access (they choose their own PIN from it). A shared PIN from
 * `--set` is fine for a rehearsal and pointless for the real thing.
 */
import { neon } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { hashPin, isValidPinFormat } from '../src/lib/auth'

const args = process.argv.slice(2)
const flagValue = (flag: string) => {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  if (args.includes('--clear')) {
    await sql`UPDATE managers SET pin_hash = NULL, pin_attempts = 0, pin_locked_until = NULL`
    console.log('✓ cleared every PIN — send each member a reset link from the admin panel\n')
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
      status: r.claimed ? 'PIN set' : 'no PIN — needs a reset link',
    })),
  )
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
