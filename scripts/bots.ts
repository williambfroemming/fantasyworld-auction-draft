/**
 * Practice bidders.
 *
 * Lets one person feel a real auction: you drive the UI as yourself while these
 * bid against you, including sniping inside the final seconds so you can see the
 * soft close push the clock back out.
 *
 *   npm run bots                 # bots bid on whatever is on the block
 *   npm run bots -- --max 40     # never bid above $40
 *   npm run bots -- --exclude Bill,Gabes
 *
 * SAFE: only ever places bids through the same rules as a human. It cannot
 * delete anything, and it stops the moment a lot is not open. Ctrl-C to quit.
 */
import { neon } from '@neondatabase/serverless'
import { placeBid, getState } from '../src/server/draft-service'

const args = process.argv.slice(2)
const argVal = (flag: string) => {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

const MAX = Number(argVal('--max') ?? 60)
const EXCLUDE = (argVal('--exclude') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
/** Chance a bot reacts to any given tick. Keeps it feeling human, not machine-gun. */
const AGGRESSION = Number(argVal('--aggression') ?? 0.35)

async function main() {
  const sql = neon(process.env.DATABASE_URL!)
  const [{ status }] = await sql`SELECT status FROM draft WHERE id = 1`
  if (status !== 'live') {
    console.log(`Draft status is "${status}". Start the draft first (⚙ Commish → Start draft).`)
  }

  console.log(`Bots running. Max bid $${MAX}. Excluded: ${EXCLUDE.join(', ') || 'nobody'}`)
  console.log('Ctrl-C to stop.\n')

  let lastLot: number | null = null

  for (;;) {
    try {
      const state = await getState()
      const lot = state.lot

      if (!lot) {
        if (lastLot !== null) {
          console.log('  … lot closed\n')
          lastLot = null
        }
        await sleep(700)
        continue
      }

      if (lot.id !== lastLot) {
        console.log(`▶ ${lot.playerName} (${lot.playerPosition}) opened at $${lot.highBid}`)
        lastLot = lot.id
      }

      const msLeft = Date.parse(lot.endsAt) - Date.now()
      if (msLeft <= 0 || state.draft.status !== 'live') {
        await sleep(400)
        continue
      }

      // Candidates: not the current high bidder, not excluded, can afford a raise.
      const next = lot.highBid + 1
      const candidates = state.managers.filter(
        (m) =>
          m.id !== lot.highBidderId &&
          !EXCLUDE.includes(m.displayName.toLowerCase()) &&
          !EXCLUDE.includes(m.name.toLowerCase()) &&
          m.maxBid >= next &&
          next <= MAX,
      )

      // Bid more eagerly as the clock runs down — that's when real people wake up.
      const urgency = msLeft < 6000 ? 0.8 : AGGRESSION
      if (candidates.length && Math.random() < urgency) {
        const who = candidates[Math.floor(Math.random() * candidates.length)]
        const raise = Math.random() < 0.75 ? 1 : 1 + Math.floor(Math.random() * 4)
        const amount = Math.min(lot.highBid + raise, MAX, who.maxBid)
        if (amount > lot.highBid) {
          const r = await placeBid(who.id, lot.id, amount)
          if (r.ok) {
            console.log(
              `  ${who.displayName} bids $${amount}` +
                (msLeft < 10_000 ? '  ← inside the soft close, clock resets to 10s' : ''),
            )
          }
        }
      }

      await sleep(600 + Math.random() * 900)
    } catch (e) {
      console.error('bot error:', (e as Error).message)
      await sleep(1500)
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
