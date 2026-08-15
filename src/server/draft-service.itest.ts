/**
 * Integration tests against a REAL Postgres database.
 *
 * ⚠️ These DELETE all picks, lots, trades, and adjustments between tests. They
 * do not touch managers or players, but they will absolutely destroy a draft in
 * progress.
 *
 * Guarded behind ALLOW_DB_RESET=1 *and* pointed at TEST_DATABASE_URL by
 * scripts/guard-test-db.ts, so a stray run on draft night cannot wipe the live
 * draft. Run with:
 *
 *   npm run test:int
 *
 * These cover the claims unit tests cannot: that the award statement is atomic
 * and cannot double-sell a player, that a sale moves the budget by precisely the
 * price, and that the reserve invariant survives a full 16-round draft.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { awardLot, getState, nominate } from './draft-service'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL

const d = ENABLED ? describe : describe.skip

if (!ENABLED) {
  console.warn('\n⚠️  Integration tests skipped. Run with ALLOW_DB_RESET=1 and a DATABASE_URL.\n')
}

d('draft-service (real Postgres)', () => {
  const sql = getSql()
  let managers: Array<{ id: number; draft_slot: number; name: string; is_commish: boolean }> = []
  let players: Array<{ id: string; position: string }> = []

  beforeAll(async () => {
    managers = (await sql`SELECT id, draft_slot, name, is_commish FROM managers
                          ORDER BY draft_slot`) as never
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
    await sql`DELETE FROM budget_adjustments`
    await sql`DELETE FROM trades`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='live', nomination_index=0, rev=0 WHERE id = 1`
  }

  /** The manager currently on the clock, per the service's own view. */
  async function onTheClock() {
    const s = await getState()
    return s.onTheClock!.managerId
  }

  async function openLot(playerIndex = 0) {
    const clock = await onTheClock()
    const r = await nominate(clock, players[playerIndex].id)
    expect(r.ok).toBe(true)
    return { lotId: (r as { ok: true; data: { lotId: number } }).data.lotId, nominator: clock }
  }

  /** Nominate and immediately sell, to move the draft along. */
  async function buy(playerIndex: number, winnerId: number, price: number) {
    const { lotId, nominator } = await openLot(playerIndex)
    const r = await awardLot(nominator, lotId, winnerId, price)
    expect(r.ok).toBe(true)
    return lotId
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

      const bad = await nominate(other.id, players[0].id)
      expect(bad.ok).toBe(false)
      expect(bad.ok === false && bad.reason).toMatch(/turn to nominate/i)

      expect((await nominate(clock, players[0].id)).ok).toBe(true)
    })

    it('refuses a second lot while one is open', async () => {
      await openLot(0)
      const second = await nominate(await onTheClock(), players[1].id)
      expect(second.ok).toBe(false)
    })

    it('opens with no price and no winner — the room has not bid yet', async () => {
      const { lotId } = await openLot(0)
      const [row] = await sql`SELECT sold_price, winner_id, status FROM lots WHERE id=${lotId}`
      expect(row.sold_price).toBeNull()
      expect(row.winner_id).toBeNull()
      expect(row.status).toBe('open')
    })

    it('never expires — an open lot is still open long after any old timer', async () => {
      const { lotId } = await openLot(0)
      await sql`UPDATE lots SET created_at = now() - interval '2 hours' WHERE id=${lotId}`
      const s = await getState()
      expect(s.lot?.id).toBe(lotId)
    })

    it('advances the snake, reversing at the turn of the round', async () => {
      const seen: number[] = []
      for (let i = 0; i < 12; i++) {
        const who = await onTheClock()
        seen.push(who)
        const { lotId } = await openLot(i)
        await awardLot(who, lotId, who, 1)
      }
      const slots = seen.map((id) => managers.find((m) => m.id === id)!.draft_slot)
      expect(slots.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      // Round 2 comes straight back down the order.
      expect(slots.slice(10, 12)).toEqual([9, 8])
    })
  })

  describe('awarding', () => {
    it('records the sale and moves the budget by exactly the price', async () => {
      const { lotId, nominator } = await openLot(0)
      const winner = managers.find((m) => m.id !== nominator)!

      expect((await awardLot(nominator, lotId, winner.id, 37)).ok).toBe(true)

      const s = await getState()
      expect(s.lot).toBeNull()
      const w = s.managers.find((m) => m.id === winner.id)!
      expect(w.rostered).toBe(1)
      expect(w.budget).toBe(200 - 37)
      expect(w.maxBid).toBe(200 - 37 - 14) // 15 slots left, $1 reserved each
      expect(s.recentPicks[0]).toMatchObject({ managerId: winner.id, price: 37 })
    })

    it('rejects a price over the winner’s max bid', async () => {
      const { lotId, nominator } = await openLot(0)
      const winner = managers.find((m) => m.id !== nominator)!

      const over = await awardLot(nominator, lotId, winner.id, 186)
      expect(over.ok).toBe(false)
      expect(over.ok === false && over.reason).toMatch(/max bid/i)

      // …and the lot is untouched, so the room can just call the right number.
      const s = await getState()
      expect(s.lot?.id).toBe(lotId)

      expect((await awardLot(nominator, lotId, winner.id, 185)).ok).toBe(true)
    })

    it('rejects $0 — every player costs at least a dollar', async () => {
      const { lotId, nominator } = await openLot(0)
      const r = await awardLot(nominator, lotId, nominator, 0)
      expect(r.ok).toBe(false)
    })

    it('only the nominator or the commissioner may record the sale', async () => {
      const { lotId, nominator } = await openLot(0)
      const stranger = managers.find((m) => m.id !== nominator && !m.is_commish)!

      const bad = await awardLot(stranger.id, lotId, stranger.id, 5)
      expect(bad.ok).toBe(false)
      expect(bad.ok === false && bad.reason).toMatch(/nominator or the commissioner/i)

      const commish = managers.find((m) => m.is_commish)!
      expect((await awardLot(commish.id, lotId, stranger.id, 5)).ok).toBe(true)
    })

    /**
     * The atomicity claim. Ten clients recording the same lot at once — which is
     * what a laggy phone plus an impatient double-tap looks like — must produce
     * exactly one pick, or somebody gets charged twice for one player.
     */
    it('sells exactly once under ten concurrent awards', async () => {
      const { lotId, nominator } = await openLot(0)
      const winner = managers.find((m) => m.id !== nominator)!

      const results = await Promise.all(
        Array.from({ length: 10 }, () => awardLot(nominator, lotId, winner.id, 25)),
      )
      expect(results.filter((r) => r.ok)).toHaveLength(1)

      const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
      expect(Number(n)).toBe(1)

      const s = await getState()
      expect(s.managers.find((m) => m.id === winner.id)!.budget).toBe(200 - 25)
    })

    it('refuses to award while paused', async () => {
      const { lotId, nominator } = await openLot(0)
      await sql`UPDATE draft SET status='paused' WHERE id=1`
      const r = await awardLot(nominator, lotId, nominator, 5)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toMatch(/paused/i)
    })

    it('will not let the same player be drafted twice', async () => {
      await buy(0, managers[0].id, 2)
      const again = await nominate(await onTheClock(), players[0].id)
      expect(again.ok).toBe(false)
      expect(again.ok === false && again.reason).toMatch(/already drafted/i)
    })

    it('cannot award to a manager whose roster is full', async () => {
      const victim = managers[0]
      for (let i = 0; i < 16; i++) await buy(i, victim.id, 1)

      const { lotId, nominator } = await openLot(16)
      const r = await awardLot(nominator, lotId, victim.id, 1)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toMatch(/full/i)
    })
  })

  describe('the invariant that matters', () => {
    it('never lets a manager end up unable to fill their roster', async () => {
      // Drive one manager to the wall: always sell them the player at their max.
      const victim = managers[0]
      for (let i = 0; i < 16; i++) {
        const { lotId, nominator } = await openLot(i)
        const s = await getState()
        const me = s.managers.find((m) => m.id === victim.id)!

        const r = await awardLot(nominator, lotId, victim.id, me.maxBid)
        expect(r.ok).toBe(true)

        const after = await getState()
        for (const m of after.managers) {
          const slotsLeft = after.draft.rosterSize - m.rostered
          // The whole point: money left is always enough for the slots left.
          expect(m.budget).toBeGreaterThanOrEqual(slotsLeft)
          expect(m.maxBid).toBeLessThanOrEqual(m.budget)
          if (m.rostered < after.draft.rosterSize) expect(m.maxBid).toBeGreaterThanOrEqual(1)
        }
      }

      const end = await getState()
      const v = end.managers.find((m) => m.id === victim.id)!
      expect(v.rostered).toBe(16)
      expect(v.budget).toBe(0)
      expect(v.maxBid).toBe(0)
    })
  })
})
