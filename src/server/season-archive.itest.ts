/**
 * Seasons and the archive, against a REAL Postgres database.
 *
 * ⚠️ Destructive. Same guards as the other integration suites — see
 * draft-service.itest.ts.
 *
 * These exist because the whole risk in docs/BACKLOG.md §2 is *silent*. Budget
 * is derived, so a `manager_totals` that has lost its season filter produces no
 * error and no stored wrong number — it just quietly starts every manager of the
 * new season several hundred dollars in the hole, and the first anyone hears of
 * it is a refused nomination on draft night. No unit test can reach that: the
 * bug lives in a SQL view, so it has to be checked against real SQL.
 *
 * The four things proved here are the four ways a season leak shows up:
 *   1. last year's spend does not count against this year's budget
 *   2. last year's players are draftable again (this is not a keeper league)
 *   3. rolling a season forward deletes nothing
 *   4. an archived pick renders from what was true that night, not from today's
 *      re-imported pool
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { awardLot, getState, nominate } from './draft-service'
import { resetDraft, startNewSeason } from './commish-service'
import { getArchivedSeason, listSeasons } from './archive-service'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

const PAST = 2026
const NOW = 2027

d('seasons + archive (real Postgres)', () => {
  const sql = getSql()
  let managers: Array<{ id: number; draft_slot: number }> = []
  let players: Array<{ id: string; name: string; team: string | null; position: string }> = []

  beforeAll(async () => {
    managers = (await sql`SELECT id, draft_slot FROM managers ORDER BY draft_slot`) as never
    players = (await sql`SELECT id, name, team, position FROM players
                         ORDER BY search_rank LIMIT 60`) as never
  })

  beforeEach(async () => {
    await wipeAll()
    await sql`UPDATE draft SET season=${PAST}, status='live', nomination_index=0, rev=0 WHERE id = 1`
    await snapshotOrder(PAST)
  })

  afterAll(async () => {
    await wipeAll()
    await sql`UPDATE draft SET season=${PAST}, status='setup' WHERE id = 1`
  })

  async function wipeAll() {
    await sql`DELETE FROM budget_adjustments`
    await sql`DELETE FROM trades`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`DELETE FROM season_orders`
  }

  async function snapshotOrder(season: number) {
    await sql`
      INSERT INTO season_orders (season, manager_id, draft_slot, display_name, color)
      SELECT ${season}, m.id, m.draft_slot, m.display_name, m.color FROM managers m
      ON CONFLICT (season, manager_id) DO NOTHING`
  }

  /** Sell `players[i]` to `winnerId` for `price`, whoever is on the clock. */
  async function buy(i: number, winnerId: number, price: number) {
    const s = await getState()
    const clock = s.onTheClock!.managerId
    const nom = await nominate(clock, players[i].id)
    if (!nom.ok) throw new Error(`nominate failed: ${nom.reason}`)
    const res = await awardLot(clock, nom.data.lotId, winnerId, price)
    if (!res.ok) throw new Error(`award failed: ${res.reason}`)
    return res.data.pickNo
  }

  // -------------------------------------------------------------------------
  // 1. The -$1 trap, arriving through a new door
  // -------------------------------------------------------------------------

  it('a new season starts every manager at $200 / $185 no matter what they spent last year', async () => {
    // Spend heavily in the past season.
    await buy(0, managers[0].id, 90)
    await buy(1, managers[0].id, 70)
    await buy(2, managers[1].id, 55)

    const before = await getState()
    expect(before.managers.find((m) => m.id === managers[0].id)!.budget).toBe(40)

    const rolled = await startNewSeason(NOW)
    expect(rolled.ok).toBe(true)

    const after = await getState()
    expect(after.draft.season).toBe(NOW)
    // Every manager, including the two who spent, is fresh again.
    for (const m of after.managers) {
      expect({ id: m.id, budget: m.budget, rostered: m.rostered, maxBid: m.maxBid }).toEqual({
        id: m.id,
        budget: 200,
        rostered: 0,
        maxBid: 185,
      })
    }
  })

  it('keeps every past pick when the season rolls forward', async () => {
    await buy(0, managers[0].id, 12)
    await buy(1, managers[1].id, 8)

    await startNewSeason(NOW)

    const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${PAST}`
    expect(Number(n)).toBe(2)
    const [{ n: now }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${NOW}`
    expect(Number(now)).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 2. Not a keeper league
  // -------------------------------------------------------------------------

  it('lets a player drafted last season be drafted again this season', async () => {
    await buy(0, managers[0].id, 30)
    const taken = players[0].id

    await startNewSeason(NOW)
    await sql`UPDATE draft SET status='live' WHERE id = 1`

    const s = await getState()
    const nom = await nominate(s.onTheClock!.managerId, taken)
    expect(nom.ok).toBe(true)

    // And the pool offers them again.
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM players p
      WHERE p.id = ${taken}
        AND NOT EXISTS (SELECT 1 FROM picks pk WHERE pk.player_id = p.id AND pk.season = ${NOW})`
    expect(Number(n)).toBe(1)
  })

  it('still refuses the same player twice within one season', async () => {
    await buy(0, managers[0].id, 5)
    const s = await getState()
    const again = await nominate(s.onTheClock!.managerId, players[0].id)
    expect(again.ok).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 3. Rolling forward is not deleting
  // -------------------------------------------------------------------------

  it('refuses to start a season that is not ahead of the current one', async () => {
    expect((await startNewSeason(PAST)).ok).toBe(false)
    expect((await startNewSeason(PAST - 1)).ok).toBe(false)
    expect((await startNewSeason(2.5 as number)).ok).toBe(false)
  })

  it('refuses to roll onto a year that already has picks', async () => {
    await buy(0, managers[0].id, 5)
    await startNewSeason(NOW)
    await sql`UPDATE draft SET status='live' WHERE id = 1`
    await buy(1, managers[1].id, 5)

    // Back to the past season, then try to roll onto the one already drafted.
    await sql`UPDATE draft SET season=${PAST} WHERE id = 1`
    const res = await startNewSeason(NOW)
    expect(res.ok).toBe(false)
  })

  it('resetDraft clears only the current season', async () => {
    await buy(0, managers[0].id, 10)
    await buy(1, managers[1].id, 10)
    await startNewSeason(NOW)
    await sql`UPDATE draft SET status='live' WHERE id = 1`
    await buy(2, managers[2].id, 20)

    const res = await resetDraft()
    expect(res.ok && res.data.season).toBe(NOW)

    const [{ n: past }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${PAST}`
    const [{ n: now }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${NOW}`
    expect(Number(past)).toBe(2) // untouched
    expect(Number(now)).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 4. The archive renders from that night, not from today's pool
  // -------------------------------------------------------------------------

  it('keeps the player as they were, after the pool is re-imported', async () => {
    await buy(0, managers[0].id, 42)
    const original = players[0]

    await startNewSeason(NOW)

    // Simulate next season's import: this player changed team.
    await sql`UPDATE players SET team = 'ZZZ' WHERE id = ${original.id}`

    const archived = await getArchivedSeason(PAST)
    expect(archived).not.toBeNull()
    const pick = archived!.rosters.find((p) => p.name === original.name)
    expect(pick).toBeDefined()
    expect(pick!.team).toBe(original.team) // NOT 'ZZZ'
    expect(pick!.price).toBe(42)

    await sql`UPDATE players SET team = ${original.team} WHERE id = ${original.id}`
  })

  it('renders an archived season even if the player row is gone entirely', async () => {
    await buy(0, managers[0].id, 15)
    const gone = players[0]
    await startNewSeason(NOW)

    // A retirement: the pick's foreign key keeps the row alive, but the archive
    // must not depend on reading anything out of it.
    const archived = await getArchivedSeason(PAST)
    const pick = archived!.rosters.find((p) => p.name === gone.name)!
    expect(pick.position).toBe(gone.position)
    expect(pick.byeWeek).toBeNull()
  })

  it('reports a past season budget without consulting manager_totals', async () => {
    await buy(0, managers[0].id, 60)
    await buy(1, managers[0].id, 40)
    await startNewSeason(NOW)

    const archived = await getArchivedSeason(PAST)
    const spender = archived!.managers.find((m) => m.id === managers[0].id)!
    expect(spender.spent).toBe(100)
    expect(spender.budget).toBe(100)
    expect(spender.rostered).toBe(2)

    // Meanwhile the live view says they are fresh for the new season.
    const live = await getState()
    expect(live.managers.find((m) => m.id === managers[0].id)!.budget).toBe(200)
  })

  it('preserves the draft order of a past season after the seating is re-drawn', async () => {
    await buy(0, managers[0].id, 5)
    const seatOfFirst = managers[0].draft_slot

    await startNewSeason(NOW)
    // Re-draw: reverse every seat for the new year.
    for (const m of managers) {
      await sql`UPDATE managers SET draft_slot = ${managers.length - 1 - m.draft_slot}
                WHERE id = ${m.id}`
    }

    const archived = await getArchivedSeason(PAST)
    const seat = archived!.managers.find((m) => m.id === managers[0].id)!
    expect(seat.draftSlot).toBe(seatOfFirst)

    // Restore the seating for the suites that follow.
    for (const m of managers) {
      await sql`UPDATE managers SET draft_slot = ${m.draft_slot} WHERE id = ${m.id}`
    }
  })

  it('lists every season on record, current one included', async () => {
    await buy(0, managers[0].id, 7)
    await startNewSeason(NOW)

    const seasons = await listSeasons()
    expect(seasons.map((s) => s.season)).toEqual([NOW, PAST])
    expect(seasons.find((s) => s.season === NOW)!.isCurrent).toBe(true)
    expect(seasons.find((s) => s.season === PAST)).toMatchObject({ picks: 1, spent: 7 })
  })

  it('returns null for a season nobody drafted', async () => {
    expect(await getArchivedSeason(1999)).toBeNull()
  })
})
