/**
 * `getVersion()` must agree with `getState().version`, always.
 * ⚠️ Wipes draft state. Guarded by ALLOW_DB_RESET=1 — see draft-service.itest.ts.
 *
 * ## Why this file exists
 *
 * `/api/state` answers a poll with 204 by comparing the client's fingerprint to
 * `getVersion()`, but sends the board with a fingerprint from `getState()`. Two
 * functions, one value — and if they ever disagree the failure is silent and
 * total in one of two directions:
 *
 *   - `getVersion()` moves when `getState()` does not → every client refetches
 *     the whole board on every 400ms tick, which is the cost problem this was
 *     built to fix, restored in full and harder to see.
 *   - `getVersion()` is stable when `getState()` moves → clients 204 forever and
 *     sit on a dead board while the room drafts on without them. On draft night
 *     that is indistinguishable from the app being broken.
 *
 * Neither shows up in a unit test, because the divergence lives in the SQL. So
 * this drives the real mutations and compares the two after each one.
 *
 * The mutations are chosen to cover each component of the fingerprint:
 * `lotId` (nominate), `pickCount` (award/undo), `rev` (trade, which changes no
 * pick count and is invisible to the fingerprint otherwise — AGENTS.md), and
 * `draftStatus` (pause/resume).
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { awardLot, getState, getVersion, nominate } from './draft-service'
import { undoLastPick } from './commish-service'
import { executeTrade } from './trade-service'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

d('state version (real Postgres)', () => {
  const sql = getSql()
  let managers: Array<{ id: number; draft_slot: number }> = []
  let players: Array<{ id: string }> = []

  /** The invariant, asserted after every mutation below. */
  async function expectAgreement(label: string) {
    const [version, state] = await Promise.all([getVersion(), getState()])
    expect(version, `getVersion() disagreed with getState().version after ${label}`).toBe(
      state.version,
    )
    return state
  }

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

  it('agrees on a quiet board', async () => {
    await expectAgreement('no mutations')
  })

  it('agrees across nominate and award', async () => {
    const before = await expectAgreement('reset')

    const { lotId, nominator } = await openLot(0)
    const afterNominate = await expectAgreement('nominate')
    expect(afterNominate.version).not.toBe(before.version)

    await awardLot(nominator, lotId, managers[0].id, 5)
    const afterAward = await expectAgreement('award')
    expect(afterAward.version).not.toBe(afterNominate.version)
  })

  it('agrees after an undo', async () => {
    const { lotId, nominator } = await openLot(1)
    await awardLot(nominator, lotId, managers[0].id, 7)
    const afterAward = await expectAgreement('award')

    await undoLastPick()
    const afterUndo = await expectAgreement('undo')
    expect(afterUndo.version).not.toBe(afterAward.version)
  })

  /**
   * The one a naive fingerprint gets wrong: a trade changes no pick *count*, so
   * it is invisible unless `draft.rev` moves. If `getVersion()` ever stops
   * reading `rev`, this is the test that catches it.
   */
  it('agrees after a trade, which moves only rev', async () => {
    const a = managers[0].id
    const b = managers[1].id

    const lot1 = await openLot(2)
    await awardLot(lot1.nominator, lot1.lotId, a, 3)
    const lot2 = await openLot(3)
    await awardLot(lot2.nominator, lot2.lotId, b, 4)

    const beforeTrade = await expectAgreement('two awards')
    const picks = (await sql`
      SELECT id, manager_id FROM picks ORDER BY pick_no`) as Array<{
      id: number
      manager_id: number
    }>

    const commish = (await sql`
      SELECT id FROM managers WHERE is_commish LIMIT 1`) as Array<{ id: number }>

    const traded = await executeTrade(commish[0].id, {
      aId: a,
      bId: b,
      picksAToB: [picks.find((p) => p.manager_id === a)!.id],
      picksBToA: [],
      cashAToB: 0,
      cashBToA: 0,
    })
    expect(traded.ok, `trade failed: ${JSON.stringify(traded)}`).toBe(true)

    const afterTrade = await expectAgreement('trade')
    expect(
      afterTrade.version,
      'a trade changes no pick count — if the fingerprint did not move, rev is missing from getVersion()',
    ).not.toBe(beforeTrade.version)
  })

  it('agrees when the draft is paused and resumed', async () => {
    const live = await expectAgreement('live')

    await sql`UPDATE draft SET status='paused' WHERE id=1`
    const paused = await expectAgreement('pause')
    expect(paused.version).not.toBe(live.version)

    await sql`UPDATE draft SET status='live' WHERE id=1`
    const resumed = await expectAgreement('resume')
    expect(resumed.version).toBe(live.version)
  })

  /**
   * The season filter, which is the quiet one. An unscoped `picks` count in
   * `getVersion()` still *agrees* with `getState()` on a single-season database,
   * so every test above would pass with the bug present. Inserting an archived
   * pick from a prior season is what separates them.
   */
  it('ignores picks from other seasons', async () => {
    const before = await expectAgreement('current season only')

    const [{ season }] = (await sql`SELECT season FROM draft WHERE id=1`) as Array<{
      season: number
    }>

    // A real player id: `picks.player_id` is FK-constrained to `players`. The
    // prior season keeps it clear of this season's UNIQUE (season, player_id),
    // and the snapshot columns carry the archived name exactly as a real
    // archived pick would.
    await sql`
      INSERT INTO picks (season, pick_no, manager_id, nominator_id, player_id,
                         player_name, player_team, player_position, price)
      VALUES (${season - 1}, 1, ${managers[0].id}, ${managers[0].id},
              ${players[19].id}, 'Archived Player', 'FA', 'WR', 1)`

    try {
      const after = await expectAgreement('inserting a prior-season pick')
      expect(
        after.version,
        'a pick from a previous season must not move this season\'s fingerprint',
      ).toBe(before.version)
    } finally {
      await sql`DELETE FROM picks WHERE season = ${season - 1}`
    }
  })
})
