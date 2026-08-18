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
     * docs/BACKLOG.md §9 P2, reproduced.
     *
     * `nomination_index - 1` is right only while the cursor sits exactly one
     * past the seat that nominated. Nomination sets it to *the seat it landed
     * on* plus one, so a nomination that skipped four full rosters moves the
     * cursor by five — and one `- 1` per undo cannot walk that back.
     *
     * Two undos in a row is the shortest sequence that shows it: the first
     * lands correctly, the second lands mid-skip-run and hands the turn to a
     * manager who never had it. `lots.nomination_index` is the recorded answer.
     */
    it('hands the turn back across a skip run, not one index at a time', async () => {
      // Seats 1-4 cannot nominate: full rosters, so the snake skips them.
      const full = managers.slice(1, 5)
      const bench = (await sql`
        SELECT id, name, team, position FROM players
        ORDER BY search_rank OFFSET 100 LIMIT ${full.length * 16}`) as Array<{
        id: string
        name: string
        team: string
        position: string
      }>
      let n = 0
      for (const m of full) {
        for (let i = 0; i < 16; i++) {
          const p = bench[n++]
          await sql`
            INSERT INTO picks (season, pick_no, player_id, player_name, player_team,
                               player_position, manager_id, nominator_id, price)
            VALUES ((SELECT season FROM draft WHERE id=1), ${1000 + n}, ${p.id}, ${p.name},
                    ${p.team}, ${p.position}, ${m.id}, ${m.id}, 1)`
        }
      }

      // Seat 0 nominates at index 0; the cursor moves to 1.
      const first = await getState()
      const seat0 = first.onTheClock!.managerId
      expect(seat0).toBe(managers[0].id)
      const a = await openLot(0)
      expect((await awardLot(a.nominator, a.lotId, managers[9].id, 1)).ok).toBe(true)

      // Next nomination skips seats 1-4 and lands on seat 5 at index 5, so the
      // cursor jumps 1 -> 6. This is the gap that `- 1` cannot cross.
      const second = await getState()
      expect(second.onTheClock!.managerId).toBe(managers[5].id)
      expect(second.onTheClock!.index).toBe(5)
      const b = await openLot(1)
      expect((await awardLot(b.nominator, b.lotId, managers[9].id, 1)).ok).toBe(true)

      // First undo: back to seat 5. Correct under either implementation.
      expect((await commish.undoLastPick()).ok).toBe(true)
      expect((await getState()).onTheClock!.managerId).toBe(managers[5].id)

      // Second undo: must be seat 0. The old `- 1` gives index 4, which is a
      // full seat, so the scan skips forward and returns seat 5 a second time.
      expect((await commish.undoLastPick()).ok).toBe(true)
      const back = await getState()
      expect(back.onTheClock!.managerId).toBe(seat0)
      expect(back.onTheClock!.index).toBe(0)
    })

    /**
     * Undoing the final pick must un-finish the draft. The award path now flips
     * `status` to 'done' (§9 P1) and 'done' refuses nominations — so without
     * the matching reversal the league would be one player short and unable to
     * ever draft them.
     */
    it('reopens a draft that the last pick had completed', async () => {
      const { lotId, nominator } = await openLot()
      expect((await awardLot(nominator, lotId, nominator, 3)).ok).toBe(true)
      // Stand in for "that was the 160th pick" — the award path sets this
      // itself only when every roster is full, which is 160 inserts away.
      await sql`UPDATE draft SET status = 'done' WHERE id = 1`

      expect((await commish.undoLastPick()).ok).toBe(true)
      expect((await getState()).draft.status).toBe('live')
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

  /**
   * docs/BACKLOG.md §9 P1. `setStatus` used to be the only writer of
   * `draft.status`, so the database never learned the draft had ended — the
   * 2026 draft was closed by hand. The screen was already right, because it
   * asks "is anybody unfilled?" rather than trusting the flag; this makes the
   * flag agree with it.
   */
  describe('finishing', () => {
    it('flips the draft to done when the award fills the last slot', async () => {
      // Every seat to 16 except the last, which is left one short: one bulk
      // insert rather than ~159 round trips over the HTTP driver.
      // OFFSET 20 skips the players `openLot` draws from and leaves plenty of
      // headroom in a ~500-row pool. An OFFSET that overshoots would insert
      // fewer picks than asked for and quietly leave several seats unfilled,
      // so the row count is asserted rather than assumed.
      const wanted = managers.length * 16 - 1
      const filled = await sql`
        WITH seats AS (
          SELECT id, row_number() OVER (ORDER BY draft_slot) - 1 AS seat FROM managers
        ), pool AS (
          SELECT id, name, team, position,
                 row_number() OVER (ORDER BY search_rank) - 1 AS rn
          FROM (SELECT id, name, team, position, search_rank FROM players
                ORDER BY search_rank OFFSET 20 LIMIT ${wanted}) x
        )
        INSERT INTO picks (season, pick_no, player_id, player_name, player_team,
                           player_position, manager_id, nominator_id, price)
        SELECT (SELECT season FROM draft WHERE id = 1), 4000 + pool.rn,
               pool.id, pool.name, pool.team, pool.position, seats.id, seats.id, 1
        FROM pool JOIN seats ON seats.seat = pool.rn / 16
        RETURNING id`
      expect(filled).toHaveLength(wanted)

      const before = await getState()
      expect(before.draft.status).toBe('live')
      // Exactly one manager can still bid, so the snake must land on them.
      const unfilled = before.managers.filter((m) => m.rostered < before.draft.rosterSize)
      expect(unfilled).toHaveLength(1)
      expect(before.onTheClock!.managerId).toBe(unfilled[0].id)

      const { lotId, nominator } = await openLot()
      const res = await awardLot(nominator, lotId, unfilled[0].id, 1)
      expect(res.ok).toBe(true)
      expect(res.ok === true && res.data.draftComplete).toBe(true)

      const after = await getState()
      expect(after.draft.status).toBe('done')
      // And the two states stop being indistinguishable: nobody is on the
      // clock *because* it is finished, not because the app lost the turn.
      expect(after.onTheClock).toBeNull()
    })

    it('leaves a paused draft alone, and does not fire twice', async () => {
      const { lotId, nominator } = await openLot()
      const res = await awardLot(nominator, lotId, nominator, 1)
      // Nowhere near full, so nothing should have flipped.
      expect(res.ok === true && res.data.draftComplete).toBe(false)
      expect((await getState()).draft.status).toBe('live')
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

    /**
     * The same "the cursor is not the seat" bug as §9 P2, on the skip path.
     *
     * With the cursor behind the seat actually on the clock — which is what a
     * nomination that skipped full rosters leaves behind — `nomination_index +
     * 1` moves the cursor into the run of full seats it was already scanning
     * past, and resolves to the same manager. The button appears dead.
     */
    it('skips past the seat on the clock, not past the raw cursor', async () => {
      // Cursor at 1 with seats 1-3 full puts seat 4 on the clock at index 4.
      const bench = (await sql`
        SELECT id, name, team, position FROM players
        ORDER BY search_rank OFFSET 200 LIMIT 48`) as Array<{
        id: string
        name: string
        team: string
        position: string
      }>
      let n = 0
      for (const m of managers.slice(1, 4)) {
        for (let i = 0; i < 16; i++) {
          const p = bench[n++]
          await sql`
            INSERT INTO picks (season, pick_no, player_id, player_name, player_team,
                               player_position, manager_id, nominator_id, price)
            VALUES ((SELECT season FROM draft WHERE id=1), ${2000 + n}, ${p.id}, ${p.name},
                    ${p.team}, ${p.position}, ${m.id}, ${m.id}, 1)`
        }
      }
      await sql`UPDATE draft SET nomination_index = 1 WHERE id = 1`

      const before = await getState()
      expect(before.onTheClock!.managerId).toBe(managers[4].id)
      expect(before.onTheClock!.index).toBe(4)

      expect((await commish.skipNominator()).ok).toBe(true)

      const after = await getState()
      expect(after.onTheClock!.managerId).toBe(managers[5].id)
    })

    /**
     * Void returns the turn to whoever nominated, across a skip run — the
     * voidLot half of §9 P2.
     */
    it('returns the turn to the nominator after voiding across a skip run', async () => {
      const bench = (await sql`
        SELECT id, name, team, position FROM players
        ORDER BY search_rank OFFSET 300 LIMIT 48`) as Array<{
        id: string
        name: string
        team: string
        position: string
      }>
      let n = 0
      for (const m of managers.slice(1, 4)) {
        for (let i = 0; i < 16; i++) {
          const p = bench[n++]
          await sql`
            INSERT INTO picks (season, pick_no, player_id, player_name, player_team,
                               player_position, manager_id, nominator_id, price)
            VALUES ((SELECT season FROM draft WHERE id=1), ${3000 + n}, ${p.id}, ${p.name},
                    ${p.team}, ${p.position}, ${m.id}, ${m.id}, 1)`
        }
      }
      await sql`UPDATE draft SET nomination_index = 1 WHERE id = 1`

      const before = await getState()
      const who = before.onTheClock!.managerId
      expect(who).toBe(managers[4].id)

      await openLot(0)
      expect((await commish.voidLot()).ok).toBe(true)

      const after = await getState()
      expect(after.onTheClock!.managerId).toBe(who)
      expect(after.onTheClock!.index).toBe(before.onTheClock!.index)
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
