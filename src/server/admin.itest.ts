/**
 * The admin panel's new powers, against a REAL Postgres database.
 * ⚠️ Wipes draft state. Guarded by ALLOW_DB_RESET=1 — see draft-service.itest.ts.
 * Needs `db:migrate-access -- --test` first (lockout columns).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPin } from '@/lib/auth'

// The admin route reads the signed session through next/headers, which does not
// exist outside a request. Swap the one function that touches it.
const session = vi.hoisted(() => ({ id: null as number | null }))
vi.mock('./session', () => ({ currentManagerId: async () => session.id }))

import { getSql } from './sql'
import { awardLot, getState, nominate } from './draft-service'
import * as commish from './commish-service'
import { executeTrade } from './trade-service'
import { signIn } from './pin-service'
import { GET as adminGet } from '@/app/api/admin/route'
import { POST as commishPost } from '@/app/api/commish/route'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

d('admin panel (real Postgres)', () => {
  const sql = getSql()
  let managers: Array<{ id: number; is_commish: boolean }> = []
  let players: Array<{ id: string }> = []
  let commishIds: number[] = []
  let savedSeason: Record<string, unknown> | undefined
  let season = 0

  beforeAll(async () => {
    managers = (await sql`SELECT id, is_commish FROM managers ORDER BY draft_slot`) as never
    players = (await sql`SELECT id FROM players ORDER BY search_rank LIMIT 20`) as never
    commishIds = managers.filter((m) => m.is_commish).map((m) => m.id)
    const [dr] = await sql`SELECT season FROM draft WHERE id = 1`
    season = Number(dr.season)
    ;[savedSeason] = await sql`SELECT * FROM seasons WHERE season = ${season}`
  })

  beforeEach(async () => {
    await sql`DELETE FROM budget_adjustments`
    await sql`DELETE FROM trades`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='live', nomination_index=0, rev=0 WHERE id=1`
    // Exactly one commissioner to start every test: the first seat.
    await sql`UPDATE managers SET is_commish = (id = ${managers[0].id})`
    session.id = null
  })

  afterAll(async () => {
    await sql`DELETE FROM budget_adjustments`
    await sql`DELETE FROM trades`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='setup', nomination_index=0 WHERE id=1`
    await sql`UPDATE managers SET is_commish = (id = ANY(${commishIds}::int[]))`
    await sql`UPDATE managers SET pin_hash = NULL, pin_attempts = 0, pin_locked_until = NULL`
    if (savedSeason) {
      await sql`UPDATE seasons SET draft_city = ${savedSeason.draft_city as string | null},
                  draft_state = ${savedSeason.draft_state as string | null},
                  buy_in = ${savedSeason.buy_in as number | null},
                  champion_prize = ${savedSeason.champion_prize as number | null},
                  runner_up_prize = ${savedSeason.runner_up_prize as number | null},
                  third_prize = ${savedSeason.third_prize as number | null},
                  side_bet = ${savedSeason.side_bet as number | null}
                WHERE season = ${season}`
    } else {
      await sql`DELETE FROM seasons WHERE season = ${season}`
    }
  })

  const post = (body: unknown) =>
    commishPost(new Request('http://x/api/commish', { method: 'POST', body: JSON.stringify(body) }))

  describe('who may use it', () => {
    it('answers 401 signed out and 403 to a member, on both routes', async () => {
      expect((await adminGet()).status).toBe(401)
      expect((await post({ action: 'pause' })).status).toBe(401)
      session.id = managers[1].id
      expect((await adminGet()).status).toBe(403)
      expect((await post({ action: 'pause' })).status).toBe(403)
    })

    it('gives the commissioner lock state but never a PIN hash', async () => {
      await sql`UPDATE managers SET pin_hash = ${await hashPin('1234')}`
      session.id = managers[0].id
      const res = await adminGet()
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toMatch(/no-store/)
      const text = await res.text()
      expect(text).not.toMatch(/pin_hash|pinHash|\$2[aby]\$|scrypt/i)
      const body = JSON.parse(text)
      expect(body.members).toHaveLength(managers.length)
      expect(body.members[0]).toHaveProperty('pinLockedUntil')
    })

    it('keeps lock state off the polling payload', async () => {
      await sql`UPDATE managers SET pin_attempts = 5, pin_locked_until = now() + interval '15 minutes'`
      const s = JSON.stringify(await getState())
      expect(s).not.toMatch(/pinAttempts|pinLockedUntil|pin_attempts|pin_locked_until/)
    })
  })

  describe('commissioner role', () => {
    it('adds and removes a commissioner', async () => {
      expect((await commish.setCommish(managers[1].id, true)).ok).toBe(true)
      expect((await commish.setCommish(managers[1].id, false)).ok).toBe(true)
      const rows = await sql`SELECT id FROM managers WHERE is_commish`
      expect(rows.map((r) => r.id)).toEqual([managers[0].id])
    })

    it('refuses to remove the last commissioner', async () => {
      const r = await commish.setCommish(managers[0].id, false)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toMatch(/at least one/i)
    })

    it('never leaves zero when two commissioners remove each other at once', async () => {
      // The first version of the guard lost this race every time. Several rounds,
      // because a race that is only sometimes lost is the dangerous kind.
      for (let round = 0; round < 5; round++) {
        await sql`UPDATE managers SET is_commish = (id IN (${managers[0].id}, ${managers[1].id}))`
        const results = await Promise.all([
          commish.setCommish(managers[0].id, false),
          commish.setCommish(managers[1].id, false),
        ])
        const [{ n }] = await sql`SELECT count(*)::int AS n FROM managers WHERE is_commish`
        expect(Number(n)).toBe(1)
        expect(results.filter((r) => r.ok)).toHaveLength(1)
      }
    })

    it('bumps rev so clients see the change', async () => {
      const before = (await getState()).version
      await commish.setCommish(managers[1].id, true)
      expect((await getState()).version).not.toBe(before)
    })
  })

  describe('unlocking a seat', () => {
    it('lifts the lock and keeps the PIN the member already has', async () => {
      const id = managers[1].id
      await sql`UPDATE managers SET pin_hash = ${await hashPin('4321')} WHERE id = ${id}`
      for (let i = 0; i < 5; i++) await signIn(id, '0000')
      expect((await signIn(id, '4321')).ok).toBe(false) // locked
      expect((await commish.unlockSeat(id)).ok).toBe(true)
      expect((await signIn(id, '4321')).ok).toBe(true)
    })
  })

  describe('editing any pick', () => {
    async function sell(playerIndex: number, price: number) {
      const s = await getState()
      const who = s.onTheClock!.managerId
      const n = await nominate(who, players[playerIndex].id)
      const lotId = (n as { ok: true; data: { lotId: number } }).data.lotId
      expect((await awardLot(who, lotId, who, price)).ok).toBe(true)
      const [pk] = await sql`SELECT id FROM picks ORDER BY pick_no DESC LIMIT 1`
      return { pickId: Number(pk.id), who }
    }

    it('edits a pick that is not the last one', async () => {
      const first = await sell(0, 40)
      await sell(1, 10)
      expect((await commish.editPrice(first.pickId, 25)).ok).toBe(true)
      const [pk] = await sql`SELECT price FROM picks WHERE id = ${first.pickId}`
      expect(pk.price).toBe(25)
    })

    it('refuses to reassign a traded player', async () => {
      const { pickId, who } = await sell(0, 20)
      const other = managers.find((m) => m.id !== who)!
      const third = managers.find((m) => m.id !== who && m.id !== other.id)!
      const t = await executeTrade(who, {
        aId: who, bId: other.id, picksAToB: [pickId], picksBToA: [], cashAToB: 0, cashBToA: 0,
      })
      expect(t.ok).toBe(true)
      const r = await commish.reassignPick(pickId, third.id)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toMatch(/traded/i)
    })
  })

  describe('recording a sale', () => {
    it('writes the same pick awardLot would, and leaves the cursor alone', async () => {
      // A normal sale first, so the cursor is off zero.
      const s0 = await getState()
      const who = s0.onTheClock!.managerId
      const n = await nominate(who, players[0].id)
      await awardLot(who, (n as { ok: true; data: { lotId: number } }).data.lotId, who, 12)
      const [before] = await sql`SELECT nomination_index FROM draft WHERE id = 1`
      const clockBefore = (await getState()).onTheClock

      const buyer = managers[3].id
      const r = await commish.recordSale(players[5].id, buyer, 7)
      expect(r.ok).toBe(true)

      const [after] = await sql`SELECT nomination_index FROM draft WHERE id = 1`
      expect(after.nomination_index).toBe(before.nomination_index)
      expect((await getState()).onTheClock).toEqual(clockBefore)

      const [pk] = await sql`
        SELECT pk.*, p.name, p.team, p.position, p.search_rank, p.pos_rank, p.sleeper_id
        FROM picks pk JOIN players p ON p.id = pk.player_id WHERE pk.player_id = ${players[5].id}`
      expect(pk.manager_id).toBe(buyer)
      expect(pk.nominator_id).toBe(buyer)
      expect(pk.price).toBe(7)
      expect(pk.pick_no).toBe(2)
      expect(pk.player_name).toBe(pk.name)
      expect(pk.player_team).toBe(pk.team)
      expect(pk.player_position).toBe(pk.position)
      expect(pk.player_rank).toBe(pk.search_rank)
      expect(pk.player_pos_rank).toBe(pk.pos_rank)
      expect(pk.player_sleeper_id).toBe(pk.sleeper_id)
      const [lot] = await sql`SELECT status, sold_price, winner_id FROM lots WHERE player_id = ${players[5].id}`
      expect(lot).toEqual({ status: 'sold', sold_price: 7, winner_id: buyer })
    })

    it('can be undone without moving whose turn it is', async () => {
      const clockBefore = (await getState()).onTheClock
      expect((await commish.recordSale(players[2].id, managers[4].id, 3)).ok).toBe(true)
      expect((await commish.undoLastPick()).ok).toBe(true)
      expect((await getState()).onTheClock).toEqual(clockBefore)
    })

    it('refuses a price over max bid, a drafted player, and a player on the block', async () => {
      const over = await commish.recordSale(players[0].id, managers[0].id, 186)
      expect(over.ok === false && over.reason).toMatch(/max bid/i)

      await commish.recordSale(players[0].id, managers[0].id, 5)
      const again = await commish.recordSale(players[0].id, managers[1].id, 5)
      expect(again.ok === false && again.reason).toMatch(/already on/i)

      const s = await getState()
      await nominate(s.onTheClock!.managerId, players[1].id)
      const onBlock = await commish.recordSale(players[1].id, managers[1].id, 5)
      expect(onBlock.ok === false && onBlock.reason).toMatch(/on the block/i)

      const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
      expect(Number(n)).toBe(1)
    })

    it('refuses before the draft has started', async () => {
      await sql`UPDATE draft SET status = 'setup' WHERE id = 1`
      const r = await commish.recordSale(players[0].id, managers[0].id, 5)
      expect(r.ok).toBe(false)
    })
  })

  describe('season details', () => {
    it('round-trips unknown as null, not 0, and a real 0 as 0', async () => {
      const r = await commish.setSeasonDetails({
        season, city: 'San Diego', state: 'CA', buyIn: 200,
        championPrize: null, runnerUpPrize: 0, thirdPrize: null, sideBet: 10,
      })
      expect(r.ok).toBe(true)
      const { seasons } = await commish.listSeasonDetails()
      const row = seasons.find((s) => s.season === season)!
      expect(row).toMatchObject({
        city: 'San Diego', state: 'CA', buyIn: 200,
        championPrize: null, runnerUpPrize: 0, thirdPrize: null, sideBet: 10,
      })
    })

    it('will not invent a season that is not on record', async () => {
      const r = await commish.setSeasonDetails({
        season: 2999, city: null, state: null, buyIn: null,
        championPrize: null, runnerUpPrize: null, thirdPrize: null, sideBet: null,
      })
      expect(r.ok).toBe(false)
    })

    it('requires the new year typed to confirm a season roll', async () => {
      session.id = managers[0].id
      const res = await post({ action: 'startNewSeason', year: season + 1, confirm: season })
      const body = await res.json()
      expect(body.ok).toBe(false)
      const [dr] = await sql`SELECT season FROM draft WHERE id = 1`
      expect(Number(dr.season)).toBe(season)
    })
  })
})
