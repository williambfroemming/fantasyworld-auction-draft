/**
 * Integration tests for the front page's reads. See `docs/BACKLOG.md` §11.
 *
 * ⚠️ These DELETE all picks, lots, trades and adjustments between tests, like
 * every other `*.itest.ts` here. Guarded behind ALLOW_DB_RESET=1 and pointed at
 * TEST_DATABASE_URL by scripts/guard-test-db.ts. Run with:
 *
 *   npm run local -- npm run test:int
 *
 * What unit tests cannot cover, and what this is for: **that `getLiveSeason()`
 * reads the current season and only the current season.** The front page is
 * exactly the kind of read-only summary where an unscoped query against `picks`
 * looks completely fine and is nine years wrong — and here it would be worse
 * than wrong, because an archived season's unfilled rosters would make the app
 * redirect every visitor into a draft that ended years ago.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { awardLot, getLiveSeason, getState, nominate } from './draft-service'
import { listHistorySeasons } from './history-service'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL

const d = ENABLED ? describe : describe.skip

if (!ENABLED) {
  console.warn('\n⚠️  Integration tests skipped. Run with ALLOW_DB_RESET=1 and a DATABASE_URL.\n')
}

d('landing page reads (real Postgres)', () => {
  const sql = getSql()
  let managers: Array<{ id: number; draft_slot: number }> = []
  let players: Array<{ id: string }> = []
  let season = 0
  let rosterSize = 0

  beforeAll(async () => {
    managers = (await sql`SELECT id, draft_slot FROM managers ORDER BY draft_slot`) as never
    // Enough to fill every roster. `picks.player_id` carries a foreign key to
    // `players`, so a synthetic id is rejected — the fill test below needs
    // `managers × rosterSize` real ones.
    players = (await sql`SELECT id FROM players ORDER BY search_rank LIMIT 200`) as never
    const [d0] = await sql`SELECT season, roster_size FROM draft WHERE id = 1`
    season = Number(d0.season)
    rosterSize = Number(d0.roster_size)
    expect(managers.length).toBe(10)
  })

  beforeEach(async () => {
    await reset()
  })

  afterAll(async () => {
    await reset()
    await sql`UPDATE draft SET status = 'setup' WHERE id = 1`
  })

  async function reset() {
    await sql`DELETE FROM budget_adjustments`
    await sql`DELETE FROM trades`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='live', nomination_index=0, rev=0 WHERE id = 1`
  }

  /** Award one player to a manager, going through the real nomination path. */
  async function sellOne(playerId: string) {
    const s = await getState()
    const clock = s.onTheClock!.managerId
    const r = await nominate(clock, playerId)
    expect(r.ok).toBe(true)
    const lotId = (r as { ok: true; data: { lotId: number } }).data.lotId
    expect((await awardLot(clock, lotId, clock, 1)).ok).toBe(true)
  }

  it('reports every seat unfilled before a single pick', async () => {
    const live = (await getLiveSeason())!
    expect(live.season).toBe(season)
    expect(live.seats).toBe(10)
    expect(live.unfilled).toBe(10)
    expect(live.picks).toBe(0)
  })

  it('shrinks `unfilled` only when a roster actually fills', async () => {
    await sellOne(players[0].id)
    const live = (await getLiveSeason())!
    expect(live.picks).toBe(1)
    // One pick is not one filled roster — sixteen is.
    expect(live.unfilled).toBe(10)
  })

  it('reaches unfilled === 0 when every roster is full', async () => {
    // Fill the league directly. Going through `nominate` 160 times is the
    // draft-service test's job, not this one's.
    expect(players.length).toBeGreaterThanOrEqual(managers.length * rosterSize)
    let n = 0
    for (const m of managers) {
      for (let i = 0; i < rosterSize; i++) {
        const p = players[n++]
        await sql`
          INSERT INTO picks (season, pick_no, player_id, player_name, player_position,
                             manager_id, nominator_id, price)
          VALUES (${season}, ${n}, ${p.id}, ${'Player ' + n}, 'WR',
                  ${m.id}, ${m.id}, 1)`
      }
    }
    const live = (await getLiveSeason())!
    expect(live.unfilled).toBe(0)
    expect(live.picks).toBe(rosterSize * 10)
  })

  /**
   * The season filter, which is the whole reason this file exists.
   *
   * An archived season's picks must not count toward this year's totals, and an
   * archived season's *absence* of picks must not make this year look unfilled.
   */
  it('counts only the current season', async () => {
    const past = season - 1
    await sql`
      INSERT INTO picks (season, pick_no, player_id, player_name, player_position,
                         manager_id, nominator_id, price)
      VALUES (${past}, 1, ${players[0].id}, 'Ghost Of Drafts Past', 'RB',
              ${managers[0].id}, ${managers[0].id}, 99)`

    try {
      const live = (await getLiveSeason())!
      expect(live.season).toBe(season)
      // The archived pick is invisible here, in both the count and the rosters.
      expect(live.picks).toBe(0)
      expect(live.unfilled).toBe(10)
    } finally {
      await sql`DELETE FROM picks WHERE season = ${past}`
    }
  })

  it('does not call a season complete when there are no seats at all', async () => {
    // `unfilled` is 0 for an empty league too, which would read as "draft over".
    // `seats` is what separates the two, so the page can tell them apart.
    const live = (await getLiveSeason())!
    expect(live.seats).toBeGreaterThan(0)
  })

  /**
   * `listHistorySeasons()` grew four columns for this page. Its existing caller
   * (`/history`) reads only the year, so the risk is not that the new fields are
   * wrong — it is that adding them broke the old ones.
   */
  it('still returns the original season listing fields, plus the prize columns', async () => {
    const seasons = await listHistorySeasons()
    if (seasons.length === 0) return

    for (const s of seasons) {
      expect(Number.isInteger(s.season)).toBe(true)
      expect(['legacy', 'standings', 'weekly']).toContain(s.dataTier)
      // Null is unknown, never zero — the new columns must arrive as null rather
      // than as a defaulted 0, or the page will claim somebody won nothing.
      for (const v of [s.championPrize, s.buyIn, s.championManagerId]) {
        expect(v === null || typeof v === 'number').toBe(true)
      }
    }

    // Newest first — the page takes the reigning champion off the front.
    const years = seasons.map((s) => s.season)
    expect(years).toEqual([...years].sort((a, b) => b - a))
  })
})
