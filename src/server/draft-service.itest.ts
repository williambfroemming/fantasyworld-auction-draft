/**
 * Integration tests against a REAL Postgres database.
 *
 * ⚠️ These DELETE all picks, lots, and bids between tests. They do not touch
 * managers or players, but they will absolutely destroy a draft in progress.
 *
 * Guarded behind ALLOW_DB_RESET=1 so that a stray `npm run test:int` on draft
 * night cannot wipe the live draft. Run with:
 *
 *   npm run test:int
 *
 * These cover the claims that unit tests cannot: that concurrent bids serialize
 * correctly, that the soft close behaves exactly as specified, and that a lot
 * settles into a pick with the budget moving by precisely the price.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { getState, nominate, placeBid, settleExpiredLots } from './draft-service'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL

const d = ENABLED ? describe : describe.skip

if (!ENABLED) {
  console.warn('\n⚠️  Integration tests skipped. Run with ALLOW_DB_RESET=1 and a DATABASE_URL.\n')
}

d('draft-service (real Postgres)', () => {
  const sql = getSql()
  let managers: Array<{ id: number; draft_slot: number; name: string }> = []
  let players: Array<{ id: string; position: string }> = []

  beforeAll(async () => {
    managers = (await sql`SELECT id, draft_slot, name FROM managers ORDER BY draft_slot`) as never
    players = (await sql`SELECT id, position FROM players ORDER BY search_rank LIMIT 40`) as never
    expect(managers.length).toBe(10)
    expect(players.length).toBeGreaterThan(20)
  })

  beforeEach(async () => {
    await resetDraft()
  })

  afterAll(async () => {
    await resetDraft()
    await sql`UPDATE draft SET status = 'setup' WHERE id = 1`
  })

  async function resetDraft() {
    await sql`DELETE FROM bids`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='live', nomination_index=0, rev=0,
              timer_seconds=25, soft_close_seconds=10 WHERE id = 1`
  }

  /** The manager currently on the clock, per the service's own view. */
  async function onTheClock() {
    const s = await getState()
    return s.onTheClock!.managerId
  }

  // -------------------------------------------------------------------------
  describe('budgets', () => {
    it('starts everyone at $200 with a $185 max bid', async () => {
      const s = await getState()
      expect(s.managers).toHaveLength(10)
      for (const m of s.managers) {
        expect(m.budget).toBe(200)
        expect(m.maxBid).toBe(185)
        expect(m.rostered).toBe(0)
      }
    })
  })

  describe('nomination', () => {
    it('only the manager on the clock may nominate', async () => {
      const clock = await onTheClock()
      const other = managers.find((m) => m.id !== clock)!

      const bad = await nominate(other.id, players[0].id, 1)
      expect(bad.ok).toBe(false)
      expect(bad.ok === false && bad.reason).toMatch(/turn to nominate/i)

      const good = await nominate(clock, players[0].id, 1)
      expect(good.ok).toBe(true)
    })

    it('rejects an opening bid above the nominator max', async () => {
      const clock = await onTheClock()
      const r = await nominate(clock, players[0].id, 186)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toMatch(/max bid/i)
    })

    it('refuses a second lot while one is open', async () => {
      const clock = await onTheClock()
      expect((await nominate(clock, players[0].id, 1)).ok).toBe(true)
      const second = await nominate(await onTheClock(), players[1].id, 1)
      expect(second.ok).toBe(false)
    })

    it('makes the nominator the standing high bidder', async () => {
      const clock = await onTheClock()
      await nominate(clock, players[0].id, 12)
      const s = await getState()
      expect(s.lot?.highBidderId).toBe(clock)
      expect(s.lot?.highBid).toBe(12)
    })

    it('advances the snake, reversing at the turn of the round', async () => {
      const seen: number[] = []
      for (let i = 0; i < 12; i++) {
        const who = await onTheClock()
        seen.push(who)
        await nominate(who, players[i].id, 1)
        await sql`UPDATE lots SET ends_at = now() - interval '1 second' WHERE status='open'`
        await settleExpiredLots()
      }
      const slots = seen.map((id) => managers.find((m) => m.id === id)!.draft_slot)
      expect(slots.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      // Round 2 comes straight back down the order.
      expect(slots.slice(10, 12)).toEqual([9, 8])
    })
  })

  describe('bidding', () => {
    async function openLot(opening = 1) {
      const clock = await onTheClock()
      const r = await nominate(clock, players[0].id, opening)
      expect(r.ok).toBe(true)
      return { lotId: (r as { ok: true; data: { lotId: number } }).data.lotId, nominator: clock }
    }

    it('accepts a raise and rejects one that does not beat it', async () => {
      const { lotId, nominator } = await openLot(5)
      const bidder = managers.find((m) => m.id !== nominator)!

      expect((await placeBid(bidder.id, lotId, 4)).ok).toBe(false)
      expect((await placeBid(bidder.id, lotId, 5)).ok).toBe(false)
      expect((await placeBid(bidder.id, lotId, 6)).ok).toBe(true)
    })

    it('enforces max bid in the database, not just the client', async () => {
      const { lotId, nominator } = await openLot(1)
      const bidder = managers.find((m) => m.id !== nominator)!

      const over = await placeBid(bidder.id, lotId, 186)
      expect(over.ok).toBe(false)
      expect(over.ok === false && over.reason).toMatch(/max bid/i)

      expect((await placeBid(bidder.id, lotId, 185)).ok).toBe(true)
    })

    it('serializes ten simultaneous bids into exactly one winner', async () => {
      const { lotId, nominator } = await openLot(1)
      const bidders = managers.filter((m) => m.id !== nominator)

      // Everyone slams the same amount at the same instant.
      const results = await Promise.all(bidders.map((b) => placeBid(b.id, lotId, 50)))
      const winners = results.filter((r) => r.ok)
      expect(winners).toHaveLength(1)

      const s = await getState()
      expect(s.lot?.highBid).toBe(50)
      // Exactly one bid recorded at that price — no lost updates, no double charge.
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM bids WHERE lot_id=${lotId} AND amount=50`
      expect(Number(n)).toBe(1)
    })

    it('lets an escalating race through and keeps the true maximum', async () => {
      const { lotId, nominator } = await openLot(1)
      const bidders = managers.filter((m) => m.id !== nominator)

      const results = await Promise.all(bidders.map((b, i) => placeBid(b.id, lotId, 10 + i)))
      const okCount = results.filter((r) => r.ok).length
      expect(okCount).toBeGreaterThan(0)

      const s = await getState()
      // Whatever interleaving happened, the standing bid is the highest accepted.
      const [{ max }] = await sql`SELECT COALESCE(MAX(amount),0)::int AS max FROM bids WHERE lot_id=${lotId}`
      expect(s.lot?.highBid).toBe(Number(max))
    })

    it('rejects every bid while the draft is paused', async () => {
      const { lotId, nominator } = await openLot(1)
      await sql`UPDATE draft SET status='paused' WHERE id=1`
      const bidder = managers.find((m) => m.id !== nominator)!
      const r = await placeBid(bidder.id, lotId, 20)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toMatch(/paused/i)
    })
  })

  describe('the soft close', () => {
    async function openWithClock(secondsLeft: number) {
      const clock = await onTheClock()
      const r = await nominate(clock, players[0].id, 1)
      const lotId = (r as { ok: true; data: { lotId: number } }).data.lotId
      await sql`UPDATE lots SET ends_at = now() + make_interval(secs => ${secondsLeft}) WHERE id=${lotId}`
      return { lotId, nominator: clock }
    }

    it('does NOT extend the clock when a bid lands outside the final 10s', async () => {
      const { lotId, nominator } = await openWithClock(20)
      const before = (await sql`SELECT ends_at FROM lots WHERE id=${lotId}`)[0].ends_at

      const bidder = managers.find((m) => m.id !== nominator)!
      expect((await placeBid(bidder.id, lotId, 5)).ok).toBe(true)

      const after = (await sql`SELECT ends_at FROM lots WHERE id=${lotId}`)[0].ends_at
      expect(new Date(after).getTime()).toBe(new Date(before).getTime())
    })

    it('snaps the clock back to exactly 10s when a bid lands inside it', async () => {
      const { lotId, nominator } = await openWithClock(3)
      const bidder = managers.find((m) => m.id !== nominator)!
      expect((await placeBid(bidder.id, lotId, 5)).ok).toBe(true)

      const [{ ms }] = await sql`
        SELECT EXTRACT(EPOCH FROM (ends_at - now())) * 1000 AS ms FROM lots WHERE id=${lotId}`
      expect(Number(ms)).toBeGreaterThan(9_000)
      expect(Number(ms)).toBeLessThanOrEqual(10_100)
    })

    it('keeps resetting on repeated late bids, so a war cannot time out early', async () => {
      const { lotId, nominator } = await openWithClock(2)
      const bidders = managers.filter((m) => m.id !== nominator)
      for (let i = 0; i < 5; i++) {
        await sql`UPDATE lots SET ends_at = now() + interval '2 seconds' WHERE id=${lotId}`
        expect((await placeBid(bidders[i].id, lotId, 5 + i)).ok).toBe(true)
        const [{ ms }] = await sql`
          SELECT EXTRACT(EPOCH FROM (ends_at - now())) * 1000 AS ms FROM lots WHERE id=${lotId}`
        expect(Number(ms)).toBeGreaterThan(9_000)
      }
    })

    it('refuses a bid once time has expired', async () => {
      const { lotId, nominator } = await openWithClock(-1)
      const bidder = managers.find((m) => m.id !== nominator)!
      const r = await placeBid(bidder.id, lotId, 20)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toMatch(/expired/i)
    })
  })

  describe('settlement', () => {
    it('awards the player and moves the budget by exactly the price', async () => {
      const clock = await onTheClock()
      const r = await nominate(clock, players[0].id, 1)
      const lotId = (r as { ok: true; data: { lotId: number } }).data.lotId
      const bidder = managers.find((m) => m.id !== clock)!
      await placeBid(bidder.id, lotId, 37)

      await sql`UPDATE lots SET ends_at = now() - interval '1 second' WHERE id=${lotId}`
      expect(await settleExpiredLots()).toBe(true)

      const s = await getState()
      expect(s.lot).toBeNull()
      const winner = s.managers.find((m) => m.id === bidder.id)!
      expect(winner.rostered).toBe(1)
      expect(winner.budget).toBe(200 - 37)
      expect(winner.maxBid).toBe(200 - 37 - 14) // 15 slots left, $1 reserved each
      expect(s.recentPicks[0]).toMatchObject({ managerId: bidder.id, price: 37 })
    })

    it('is idempotent under ten concurrent settles — one pick, not ten', async () => {
      const clock = await onTheClock()
      const r = await nominate(clock, players[0].id, 9)
      const lotId = (r as { ok: true; data: { lotId: number } }).data.lotId
      await sql`UPDATE lots SET ends_at = now() - interval '1 second' WHERE id=${lotId}`

      // Every polling client hits /api/state at once.
      const settled = await Promise.all(Array.from({ length: 10 }, () => settleExpiredLots()))
      expect(settled.filter(Boolean)).toHaveLength(1)

      const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
      expect(Number(n)).toBe(1)
    })

    it('does not settle while paused, even past the deadline', async () => {
      const clock = await onTheClock()
      const r = await nominate(clock, players[0].id, 3)
      const lotId = (r as { ok: true; data: { lotId: number } }).data.lotId
      await sql`UPDATE lots SET ends_at = now() - interval '5 seconds',
                paused_remaining_ms = 4000 WHERE id=${lotId}`

      expect(await settleExpiredLots()).toBe(false)
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
      expect(Number(n)).toBe(0)
    })

    it('will not let the same player be drafted twice', async () => {
      const clock = await onTheClock()
      const r = await nominate(clock, players[0].id, 2)
      const lotId = (r as { ok: true; data: { lotId: number } }).data.lotId
      await sql`UPDATE lots SET ends_at = now() - interval '1 second' WHERE id=${lotId}`
      await settleExpiredLots()

      const again = await nominate(await onTheClock(), players[0].id, 2)
      expect(again.ok).toBe(false)
      expect(again.ok === false && again.reason).toMatch(/already drafted/i)
    })
  })

  describe('the invariant that matters', () => {
    it('never lets a manager end up unable to fill their roster', async () => {
      // Drive one manager to the wall: always bid their entire max.
      const victim = managers[0]
      for (let i = 0; i < 16; i++) {
        const clock = await onTheClock()
        const r = await nominate(clock, players[i].id, 1)
        const lotId = (r as { ok: true; data: { lotId: number } }).data.lotId

        const s = await getState()
        const me = s.managers.find((m) => m.id === victim.id)!
        if (me.maxBid > s.lot!.highBid && me.rostered < 16) {
          await placeBid(victim.id, lotId, me.maxBid)
        }
        await sql`UPDATE lots SET ends_at = now() - interval '1 second' WHERE id=${lotId}`
        await settleExpiredLots()

        const after = await getState()
        for (const m of after.managers) {
          const slotsLeft = after.draft.rosterSize - m.rostered
          // The whole point: money left is always enough for the slots left.
          expect(m.budget).toBeGreaterThanOrEqual(slotsLeft)
          expect(m.maxBid).toBeLessThanOrEqual(m.budget)
          if (m.rostered < after.draft.rosterSize) expect(m.maxBid).toBeGreaterThanOrEqual(1)
        }
      }
    })
  })
})
