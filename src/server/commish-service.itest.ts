/**
 * Commissioner actions against real Postgres.
 * ⚠️ Wipes draft state. Guarded by ALLOW_DB_RESET=1 — see draft-service.itest.ts.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { getState, nominate, placeBid, settleExpiredLots } from './draft-service'
import * as commish from './commish-service'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

d('commish-service (real Postgres)', () => {
  const sql = getSql()
  let managers: Array<{ id: number; draft_slot: number }> = []
  let players: Array<{ id: string }> = []

  beforeAll(async () => {
    managers = (await sql`SELECT id, draft_slot FROM managers ORDER BY draft_slot`) as never
    players = (await sql`SELECT id FROM players ORDER BY search_rank LIMIT 20`) as never
  })

  beforeEach(async () => {
    await sql`DELETE FROM bids`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='live', nomination_index=0, rev=0,
              timer_seconds=25, soft_close_seconds=10 WHERE id=1`
  })

  afterAll(async () => {
    await sql`DELETE FROM bids`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='setup', nomination_index=0 WHERE id=1`
  })

  async function openLot(opening = 5) {
    const s = await getState()
    const who = s.onTheClock!.managerId
    const r = await nominate(who, players[0].id, opening)
    return { lotId: (r as { ok: true; data: { lotId: number } }).data.lotId, nominator: who }
  }

  describe('pause / resume', () => {
    it('banks the exact time left and restores it', async () => {
      const { lotId } = await openLot()
      await sql`UPDATE lots SET ends_at = now() + interval '17 seconds' WHERE id=${lotId}`

      await commish.pause()
      const [paused] = await sql`SELECT paused_remaining_ms FROM lots WHERE id=${lotId}`
      expect(Number(paused.paused_remaining_ms)).toBeGreaterThan(16_000)
      expect(Number(paused.paused_remaining_ms)).toBeLessThanOrEqual(17_100)

      // Time passes while everyone is at the fridge.
      await new Promise((r) => setTimeout(r, 1500))

      await commish.resume()
      const [{ ms }] = await sql`
        SELECT EXTRACT(EPOCH FROM (ends_at - now())) * 1000 AS ms FROM lots WHERE id=${lotId}`
      // Still ~17s, NOT 15.5s — the break must not eat the clock.
      expect(Number(ms)).toBeGreaterThan(16_000)
    })

    it('a paused lot past its deadline does not settle', async () => {
      const { lotId } = await openLot()
      await commish.pause()
      await sql`UPDATE lots SET ends_at = now() - interval '1 minute' WHERE id=${lotId}`
      expect(await settleExpiredLots()).toBe(false)
      expect((await getState()).lot).not.toBeNull()
    })
  })

  describe('clock adjustment', () => {
    it('adds and removes time from the live lot', async () => {
      const { lotId } = await openLot()
      await sql`UPDATE lots SET ends_at = now() + interval '20 seconds' WHERE id=${lotId}`
      await commish.adjustClock(30)
      const [{ ms }] = await sql`
        SELECT EXTRACT(EPOCH FROM (ends_at - now())) * 1000 AS ms FROM lots WHERE id=${lotId}`
      expect(Number(ms)).toBeGreaterThan(49_000)
    })

    it('clamps a large negative adjustment to "now" rather than far in the past', async () => {
      // Taking 300s off a 5s clock ends the lot immediately — that's a
      // legitimate "sold!" from the commissioner. What must NOT happen is the
      // deadline landing minutes in the past, which would make the remaining
      // time meaningless and confuse any client mid-render.
      const { lotId } = await openLot()
      await sql`UPDATE lots SET ends_at = now() + interval '5 seconds' WHERE id=${lotId}`
      await commish.adjustClock(-300)
      const [{ ms }] = await sql`
        SELECT EXTRACT(EPOCH FROM (ends_at - now())) * 1000 AS ms FROM lots WHERE id=${lotId}`
      // Clamped to the moment of the update; only round-trip time has passed.
      expect(Number(ms)).toBeLessThanOrEqual(0)
      expect(Number(ms)).toBeGreaterThan(-5_000)
    })
  })

  describe('undo', () => {
    it('refunds the money, returns the player, and rewinds the order', async () => {
      const before = await getState()
      const { lotId, nominator } = await openLot()
      const bidder = managers.find((m) => m.id !== nominator)!
      await placeBid(bidder.id, lotId, 42)
      await sql`UPDATE lots SET ends_at = now() - interval '1 second' WHERE id=${lotId}`
      await settleExpiredLots()

      const after = await getState()
      expect(after.managers.find((m) => m.id === bidder.id)!.budget).toBe(158)

      const undone = await commish.undoLastPick()
      expect(undone.ok).toBe(true)

      const restored = await getState()
      expect(restored.managers.find((m) => m.id === bidder.id)!.budget).toBe(200)
      expect(restored.managers.find((m) => m.id === bidder.id)!.rostered).toBe(0)
      // Same manager is back on the clock, and the player is draftable again.
      expect(restored.onTheClock!.managerId).toBe(before.onTheClock!.managerId)
      const re = await nominate(restored.onTheClock!.managerId, players[0].id, 1)
      expect(re.ok).toBe(true)
    })

    it('refuses when there is nothing to undo', async () => {
      expect((await commish.undoLastPick()).ok).toBe(false)
    })
  })

  describe('editing a pick', () => {
    async function settleOne(price: number) {
      const { lotId, nominator } = await openLot(price)
      await sql`UPDATE lots SET ends_at = now() - interval '1 second' WHERE id=${lotId}`
      await settleExpiredLots()
      const [pick] = await sql`SELECT id FROM picks ORDER BY pick_no DESC LIMIT 1`
      return { pickId: pick.id as number, nominator }
    }

    it('corrects a mistyped price and recalculates the budget', async () => {
      const { pickId, nominator } = await settleOne(50)
      expect((await commish.editPrice(pickId, 15)).ok).toBe(true)
      const s = await getState()
      expect(s.managers.find((m) => m.id === nominator)!.budget).toBe(185)
    })

    it('refuses a price that would strand a manager without $1 per empty slot', async () => {
      // This is the one path that writes a price without going through the bid
      // rules, so it has to guard the invariant itself.
      const { pickId } = await settleOne(10)
      const r = await commish.editPrice(pickId, 195)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toMatch(/at least \$1 each/i)
    })

    it('reassigns a player and moves both budgets', async () => {
      const { pickId, nominator } = await settleOne(30)
      const other = managers.find((m) => m.id !== nominator)!
      expect((await commish.reassignPick(pickId, other.id)).ok).toBe(true)

      const s = await getState()
      expect(s.managers.find((m) => m.id === nominator)!.budget).toBe(200)
      expect(s.managers.find((m) => m.id === other.id)!.budget).toBe(170)
      expect(s.managers.find((m) => m.id === other.id)!.rostered).toBe(1)
    })
  })

  describe('order control', () => {
    it('skips a nominator who has stepped away', async () => {
      const before = await getState()
      expect((await commish.skipNominator()).ok).toBe(true)
      const after = await getState()
      expect(after.onTheClock!.managerId).not.toBe(before.onTheClock!.managerId)
    })

    it('refuses to skip while a lot is live', async () => {
      await openLot()
      expect((await commish.skipNominator()).ok).toBe(false)
    })

    it('voids the current lot without awarding it', async () => {
      const { lotId } = await openLot()
      expect((await commish.voidLot()).ok).toBe(true)
      const s = await getState()
      expect(s.lot).toBeNull()
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
      expect(Number(n)).toBe(0)
      // Voided, not sold — so the player can be nominated again.
      const [lot] = await sql`SELECT status FROM lots WHERE id=${lotId}`
      expect(lot.status).toBe('void')
    })

    it('swaps two seats without touching completed picks', async () => {
      const [a, b] = managers
      expect((await commish.swapSeats(a.id, b.id)).ok).toBe(true)
      const rows = await sql`SELECT id, draft_slot FROM managers WHERE id IN (${a.id}, ${b.id})`
      const byId = new Map(rows.map((r) => [r.id, r.draft_slot]))
      expect(byId.get(a.id)).toBe(b.draft_slot)
      expect(byId.get(b.id)).toBe(a.draft_slot)
      await commish.swapSeats(a.id, b.id) // restore
    })
  })
})
