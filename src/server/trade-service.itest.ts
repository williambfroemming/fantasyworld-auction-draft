/**
 * Trades against a REAL Postgres database.
 *
 * ⚠️ Destructive. Same guards as the other integration suites — see
 * draft-service.itest.ts.
 *
 * The unit tests prove the *rule* (validateTrade). These prove the SQL actually
 * implements it: that the compensating budget adjustments land, that they sum to
 * zero, and above all that a rejected trade writes NOTHING. A half-applied trade
 * is the one failure mode here that would quietly corrupt every budget for the
 * rest of the draft.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { awardLot, getState, nominate } from './draft-service'
import { executeTrade, listTrades } from './trade-service'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

d('trade-service (real Postgres)', () => {
  const sql = getSql()
  let managers: Array<{ id: number; draft_slot: number }> = []
  let players: Array<{ id: string }> = []

  beforeAll(async () => {
    managers = (await sql`SELECT id, draft_slot FROM managers ORDER BY draft_slot`) as never
    players = (await sql`SELECT id FROM players ORDER BY search_rank LIMIT 60`) as never
  })

  beforeEach(async () => {
    await sql`DELETE FROM budget_adjustments`
    await sql`DELETE FROM trades`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='live', nomination_index=0, rev=0 WHERE id = 1`
  })

  afterAll(async () => {
    await sql`DELETE FROM budget_adjustments`
    await sql`DELETE FROM trades`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='setup' WHERE id = 1`
  })

  /** Sell `players[i]` to `winnerId` for `price`, whoever is on the clock. */
  async function buy(i: number, winnerId: number, price: number): Promise<number> {
    const s = await getState()
    const clock = s.onTheClock!.managerId
    const r = await nominate(clock, players[i].id)
    expect(r.ok).toBe(true)
    const lotId = (r as { ok: true; data: { lotId: number } }).data.lotId
    expect((await awardLot(clock, lotId, winnerId, price)).ok).toBe(true)
    const [pick] = await sql`SELECT id FROM picks WHERE player_id = ${players[i].id}`
    return Number(pick.id)
  }

  async function budgetOf(id: number) {
    const s = await getState()
    return s.managers.find((m) => m.id === id)!
  }

  /** Every trade must leave the league's adjustments summing to exactly zero. */
  async function adjustmentsBalance() {
    const [row] = await sql`SELECT COALESCE(SUM(amount), 0)::int AS total FROM budget_adjustments`
    return Number(row.total)
  }

  // -------------------------------------------------------------------------
  it('moves a player without moving his salary', async () => {
    const [a, b] = managers
    const pickId = await buy(0, a.id, 50)

    expect((await budgetOf(a.id)).budget).toBe(150)
    expect((await budgetOf(b.id)).budget).toBe(200)

    const r = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [pickId],
      picksBToA: [],
      cashAToB: 0,
      cashBToA: 0,
    })
    expect(r.ok).toBe(true)

    const after = await getState()
    const ma = after.managers.find((m) => m.id === a.id)!
    const mb = after.managers.find((m) => m.id === b.id)!

    // The player is on B's roster…
    expect(mb.rostered).toBe(1)
    expect(ma.rostered).toBe(0)
    // …but A is still paying for him. That is the league's rule.
    expect(ma.budget).toBe(150)
    expect(mb.budget).toBe(200)
    expect(await adjustmentsBalance()).toBe(0)
  })

  it('moves cash and nothing else', async () => {
    const [a, b] = managers
    const r = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [],
      picksBToA: [],
      cashAToB: 30,
      cashBToA: 0,
    })
    expect(r.ok).toBe(true)

    expect((await budgetOf(a.id)).budget).toBe(170)
    expect((await budgetOf(b.id)).budget).toBe(230)
    // Max bid follows the money: 16 empty slots, so reserve 15.
    expect((await budgetOf(b.id)).maxBid).toBe(230 - 15)
    expect(await adjustmentsBalance()).toBe(0)
  })

  it('handles players and cash moving both ways at once', async () => {
    const [a, b] = managers
    const pa = await buy(0, a.id, 40)
    const pb = await buy(1, b.id, 25)

    const r = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [pa],
      picksBToA: [pb],
      cashAToB: 0,
      cashBToA: 10,
    })
    expect(r.ok).toBe(true)

    const ma = await budgetOf(a.id)
    const mb = await budgetOf(b.id)
    // Salaries stay put (A pays 40, B pays 25); only the $10 moves.
    expect(ma.budget).toBe(200 - 40 + 10)
    expect(mb.budget).toBe(200 - 25 - 10)
    expect(ma.rostered).toBe(1)
    expect(mb.rostered).toBe(1)
    expect(await adjustmentsBalance()).toBe(0)
  })

  it('rejects cash that would strand a manager below $1 per empty slot', async () => {
    const [a, b] = managers
    // 16 empty slots, $200. Sending $185 leaves $15 for 16 slots.
    const r = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [],
      picksBToA: [],
      cashAToB: 185,
      cashBToA: 0,
    })
    expect(r.ok).toBe(false)

    // $184 leaves exactly $16 for 16 slots, which is the floor, not below it.
    const ok = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [],
      picksBToA: [],
      cashAToB: 184,
      cashBToA: 0,
    })
    expect(ok.ok).toBe(true)
    expect((await budgetOf(a.id)).budget).toBe(16)
  })

  it('rejects trading a player the manager does not own', async () => {
    const [a, b, c] = managers
    const pickId = await buy(0, c.id, 10)

    const r = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [pickId], // belongs to C
      picksBToA: [],
      cashAToB: 0,
      cashBToA: 0,
    })
    expect(r.ok).toBe(false)

    const [pick] = await sql`SELECT manager_id FROM picks WHERE id=${pickId}`
    expect(Number(pick.manager_id)).toBe(c.id)
  })

  it('rejects an empty trade', async () => {
    const [a, b] = managers
    const r = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [],
      picksBToA: [],
      cashAToB: 0,
      cashBToA: 0,
    })
    expect(r.ok).toBe(false)
  })

  it('rejects a trade with oneself', async () => {
    const [a] = managers
    const r = await executeTrade(a.id, {
      aId: a.id,
      bId: a.id,
      picksAToB: [],
      picksBToA: [],
      cashAToB: 5,
      cashBToA: 0,
    })
    expect(r.ok).toBe(false)
  })

  /**
   * The important one. A rejected trade must leave the database exactly as it
   * was — no moved picks, no orphan adjustments, no trade row. This is the
   * single-statement claim, and it is the reason executeTrade is not written as
   * "validate, then apply".
   */
  it('writes absolutely nothing when it is rejected', async () => {
    const [a, b] = managers
    const pa = await buy(0, a.id, 40)
    await buy(1, b.id, 25)

    const before = {
      picks: await sql`SELECT id, manager_id FROM picks ORDER BY id`,
      adjustments: await adjustmentsBalance(),
      trades: (await listTrades()).length,
      rev: (await sql`SELECT rev FROM draft WHERE id=1`)[0].rev,
    }

    // Illegal: sends more cash than A can spare.
    const r = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [pa],
      picksBToA: [],
      cashAToB: 999,
      cashBToA: 0,
    })
    expect(r.ok).toBe(false)

    expect(await sql`SELECT id, manager_id FROM picks ORDER BY id`).toEqual(before.picks)
    expect(await adjustmentsBalance()).toBe(before.adjustments)
    expect((await listTrades()).length).toBe(before.trades)
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM budget_adjustments`
    expect(Number(n)).toBe(0)
    expect((await sql`SELECT rev FROM draft WHERE id=1`)[0].rev).toBe(before.rev)
  })

  it('bumps draft.rev so polling clients notice — the pick count does not change', async () => {
    const [a, b] = managers
    const pickId = await buy(0, a.id, 20)
    const before = await getState()

    expect(
      (
        await executeTrade(a.id, {
          aId: a.id,
          bId: b.id,
          picksAToB: [pickId],
          picksBToA: [],
          cashAToB: 0,
          cashBToA: 0,
        })
      ).ok,
    ).toBe(true)

    const after = await getState()
    expect(after.version).not.toBe(before.version)
  })

  it('records the trade in the log with the players and cash', async () => {
    const [a, b] = managers
    const pa = await buy(0, a.id, 12)

    await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [pa],
      picksBToA: [],
      cashAToB: 0,
      cashBToA: 7,
    })

    const [t] = await listTrades()
    expect(t.managerAId).toBe(a.id)
    expect(t.managerBId).toBe(b.id)
    expect(t.cashAToB).toBe(-7) // B paid A
    expect(t.players).toHaveLength(1)
    expect(t.players[0]).toMatchObject({ pickId: pa, toManagerId: b.id, price: 12 })
  })

  it('refuses to overfill a roster', async () => {
    const [a, b] = managers
    const aPicks: number[] = []
    for (let i = 0; i < 16; i++) aPicks.push(await buy(i, a.id, 1))
    const bPick = await buy(16, b.id, 1)

    // A is full at 16; receiving one more would make 17.
    const r = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [],
      picksBToA: [bPick],
      cashAToB: 0,
      cashBToA: 0,
    })
    expect(r.ok).toBe(false)

    // Swapping one out for one in keeps them at 16, which is fine.
    const ok = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [aPicks[0]],
      picksBToA: [bPick],
      cashAToB: 0,
      cashBToA: 0,
    })
    expect(ok.ok).toBe(true)
    expect((await budgetOf(a.id)).rostered).toBe(16)
  })

  /**
   * Giving a player away opens a roster slot that now needs a dollar behind it.
   * A manager with no slack fails this even though no money leaves their side —
   * the surprising consequence of the reserve rule, asserted here so nobody
   * "fixes" it later.
   */
  it('blocks giving a player away when the freed slot cannot be funded', async () => {
    const [a, b] = managers
    // Spend A down to exactly $0 with a full roster.
    const picks: number[] = []
    for (let i = 0; i < 15; i++) picks.push(await buy(i, a.id, 1))
    const s = await getState()
    const me = s.managers.find((m) => m.id === a.id)!
    picks.push(await buy(15, a.id, me.maxBid)) // spends the rest

    expect((await budgetOf(a.id)).budget).toBe(0)
    expect((await budgetOf(a.id)).rostered).toBe(16)

    const r = await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [picks[0]],
      picksBToA: [],
      cashAToB: 0,
      cashBToA: 0,
    })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/at least \$1 for each|no longer on that roster/i)
  })

  it('keeps max bid consistent with the post-trade roster and budget', async () => {
    const [a, b] = managers
    const pickId = await buy(0, a.id, 30)

    await executeTrade(a.id, {
      aId: a.id,
      bId: b.id,
      picksAToB: [pickId],
      picksBToA: [],
      cashAToB: 0,
      cashBToA: 20,
    })

    const ma = await budgetOf(a.id)
    const mb = await budgetOf(b.id)
    // A: $170 + $20 = $190, 0 players -> reserve 15
    expect(ma.budget).toBe(190)
    expect(ma.maxBid).toBe(190 - 15)
    // B: $200 - $20 = $180, 1 player -> reserve 14
    expect(mb.budget).toBe(180)
    expect(mb.maxBid).toBe(180 - 14)
  })
})
