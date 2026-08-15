/**
 * Commissioner actions against real Postgres.
 * ⚠️ Wipes draft state. Guarded by ALLOW_DB_RESET=1 — see draft-service.itest.ts.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { awardLot, getState, nominate } from './draft-service'
import * as commish from './commish-service'
import { executeTrade } from './trade-service'

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
    await sql`DELETE FROM budget_adjustments`
    await sql`DELETE FROM trades`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='live', nomination_index=0, rev=0 WHERE id=1`
  })

  afterAll(async () => {
    await sql`DELETE FROM budget_adjustments`
    await sql`DELETE FROM trades`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='setup', nomination_index=0 WHERE id=1`
  })

  async function openLot(playerIndex = 0) {
    const s = await getState()
    const who = s.onTheClock!.managerId
    const r = await nominate(who, players[playerIndex].id)
    return { lotId: (r as { ok: true; data: { lotId: number } }).data.lotId, nominator: who }
  }

  describe('pause / resume', () => {
    it('blocks awards while paused and allows them again after resume', async () => {
      const { lotId, nominator } = await openLot()

      await commish.pause()
      expect((await getState()).draft.status).toBe('paused')
      const blocked = await awardLot(nominator, lotId, nominator, 5)
      expect(blocked.ok).toBe(false)
      expect(blocked.ok === false && blocked.reason).toMatch(/paused/i)

      // Nothing expires while paused — the player is still on the block.
      expect((await getState()).lot).not.toBeNull()

      await commish.resume()
      expect((await awardLot(nominator, lotId, nominator, 5)).ok).toBe(true)
    })

    it('blocks nominations while paused', async () => {
      await commish.pause()
      const s = await getState()
      const r = await nominate(s.onTheClock!.managerId, players[0].id)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toMatch(/paused/i)
    })
  })

  describe('undo', () => {
    it('refunds the money, returns the player, and rewinds the order', async () => {
      const before = await getState()
      const { lotId, nominator } = await openLot()
      const winner = managers.find((m) => m.id !== nominator)!
      expect((await awardLot(nominator, lotId, winner.id, 42)).ok).toBe(true)

      const after = await getState()
      expect(after.managers.find((m) => m.id === winner.id)!.budget).toBe(158)

      const undone = await commish.undoLastPick()
      expect(undone.ok).toBe(true)

      const restored = await getState()
      expect(restored.managers.find((m) => m.id === winner.id)!.budget).toBe(200)
      expect(restored.managers.find((m) => m.id === winner.id)!.rostered).toBe(0)
      // Same manager is back on the clock, and the player is draftable again.
      expect(restored.onTheClock!.managerId).toBe(before.onTheClock!.managerId)
      const re = await nominate(restored.onTheClock!.managerId, players[0].id)
      expect(re.ok).toBe(true)
    })

    it('refuses when there is nothing to undo', async () => {
      expect((await commish.undoLastPick()).ok).toBe(false)
    })

    /**
     * A traded player's salary is pinned by a pair of budget_adjustments that
     * reference this pick. Deleting the pick would orphan them and silently
     * shift both managers' budgets for the rest of the draft.
     */
    it('refuses to undo a pick that has been traded', async () => {
      const { lotId, nominator } = await openLot()
      const winner = managers.find((m) => m.id !== nominator)!
      await awardLot(nominator, lotId, winner.id, 20)
      const [pick] = await sql`SELECT id FROM picks ORDER BY pick_no DESC LIMIT 1`

      const other = managers.find((m) => m.id !== winner.id)!
      const traded = await executeTrade(winner.id, {
        aId: winner.id,
        bId: other.id,
        picksAToB: [Number(pick.id)],
        picksBToA: [],
        cashAToB: 0,
        cashBToA: 0,
      })
      expect(traded.ok).toBe(true)

      const r = await commish.undoLastPick()
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toMatch(/traded/i)
    })
  })

  describe('editing a pick', () => {
    async function settleOne(price: number) {
      const { lotId, nominator } = await openLot()
      expect((await awardLot(nominator, lotId, nominator, price)).ok).toBe(true)
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
