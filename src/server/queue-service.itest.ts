/**
 * The private player queue, against a REAL Postgres database.
 *
 * ⚠️ Destructive. Same guards as the other integration suites — see
 * draft-service.itest.ts.
 *
 * The property worth testing here is **privacy**, and it is not the kind of
 * thing a unit test can assert: it lives in the WHERE clauses. A queue that
 * leaks hands your strategy to the nine people bidding against you, so the first
 * test is that one manager's read cannot see another's rows, and the second is
 * that nothing about the queue reaches the league-wide state payload.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { awardLot, getState, nominate } from './draft-service'
import { addToQueue, getQueue, pruneQueue, removeFromQueue } from './queue-service'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

d('queue-service (real Postgres)', () => {
  const sql = getSql()
  let managers: Array<{ id: number; draft_slot: number }> = []
  let players: Array<{ id: string; name: string }> = []

  beforeAll(async () => {
    managers = (await sql`SELECT id, draft_slot FROM managers ORDER BY draft_slot`) as never
    players = (await sql`SELECT id, name FROM players ORDER BY search_rank LIMIT 80`) as never
  })

  beforeEach(async () => {
    await sql`DELETE FROM player_queue`
    await sql`DELETE FROM budget_adjustments`
    await sql`DELETE FROM trades`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='live', nomination_index=0, rev=0 WHERE id = 1`
  })

  afterAll(async () => {
    await sql`DELETE FROM player_queue`
    await sql`DELETE FROM picks`
    await sql`DELETE FROM lots`
    await sql`UPDATE draft SET status='setup' WHERE id = 1`
  })

  // -------------------------------------------------------------------------
  // Privacy
  // -------------------------------------------------------------------------

  it('never returns another manager’s queue', async () => {
    await addToQueue(managers[0].id, players[0].id)
    await addToQueue(managers[0].id, players[1].id)
    await addToQueue(managers[1].id, players[2].id)

    const mine = await getQueue(managers[0].id)
    const theirs = await getQueue(managers[1].id)

    expect(mine.map((q) => q.playerId)).toEqual([players[0].id, players[1].id])
    expect(theirs.map((q) => q.playerId)).toEqual([players[2].id])
    // The decisive assertion: nothing of mine appears in theirs.
    expect(theirs.some((q) => q.playerId === players[0].id)).toBe(false)
  })

  it('cannot remove a player from someone else’s queue', async () => {
    await addToQueue(managers[0].id, players[0].id)
    const res = await removeFromQueue(managers[1].id, players[0].id)
    expect(res.ok && res.data.removed).toBe(false)
    expect(await getQueue(managers[0].id)).toHaveLength(1)
  })

  it('keeps the queue out of the league-wide state payload', async () => {
    await addToQueue(managers[0].id, players[0].id)
    const state = await getState()
    // Whatever shape state grows, the queued player must not be findable in it.
    expect(JSON.stringify(state)).not.toContain(players[0].id)
    expect(JSON.stringify(state)).not.toContain('queue')
  })

  it('does not move the polling fingerprint — one private edit must not wake ten clients', async () => {
    const before = (await getState()).version
    await addToQueue(managers[0].id, players[0].id)
    await addToQueue(managers[1].id, players[1].id)
    await removeFromQueue(managers[0].id, players[0].id)
    expect((await getState()).version).toBe(before)
  })

  // -------------------------------------------------------------------------
  // Behaviour
  // -------------------------------------------------------------------------

  it('is idempotent — a double tap does not error or duplicate', async () => {
    expect(await addToQueue(managers[0].id, players[0].id)).toMatchObject({
      ok: true,
      data: { added: true },
    })
    expect(await addToQueue(managers[0].id, players[0].id)).toMatchObject({
      ok: true,
      data: { added: false },
    })
    expect(await getQueue(managers[0].id)).toHaveLength(1)
  })

  it('rejects a player that does not exist', async () => {
    expect(await addToQueue(managers[0].id, 'no-such-player')).toMatchObject({ ok: false })
  })

  it('keeps insertion order', async () => {
    for (const i of [5, 2, 9, 1]) await addToQueue(managers[0].id, players[i].id)
    expect((await getQueue(managers[0].id)).map((q) => q.playerId)).toEqual(
      [5, 2, 9, 1].map((i) => players[i].id),
    )
  })

  // -------------------------------------------------------------------------
  // Auto-pruning — the real requirement
  // -------------------------------------------------------------------------

  it('flags a target that somebody bought, rather than silently dropping it', async () => {
    await addToQueue(managers[0].id, players[0].id)
    await addToQueue(managers[0].id, players[1].id)

    // Someone else buys the first one.
    const s = await getState()
    const clock = s.onTheClock!.managerId
    const nom = await nominate(clock, players[0].id)
    expect(nom.ok).toBe(true)
    await awardLot(clock, (nom as { data: { lotId: number } }).data.lotId, managers[3].id, 20)

    const queue = await getQueue(managers[0].id)
    expect(queue).toHaveLength(2) // still listed — not silently shrunk
    expect(queue.find((q) => q.playerId === players[0].id)!.drafted).toBe(true)
    expect(queue.find((q) => q.playerId === players[1].id)!.drafted).toBe(false)
  })

  it('marks a queued player who is on the block right now', async () => {
    await addToQueue(managers[0].id, players[4].id)
    const s = await getState()
    await nominate(s.onTheClock!.managerId, players[4].id)

    const [entry] = await getQueue(managers[0].id)
    expect(entry).toMatchObject({ onTheBlock: true, drafted: false })
  })

  it('prunes only the drafted ones, and only mine', async () => {
    await addToQueue(managers[0].id, players[0].id)
    await addToQueue(managers[0].id, players[1].id)
    await addToQueue(managers[1].id, players[0].id)

    const s = await getState()
    const clock = s.onTheClock!.managerId
    const nom = await nominate(clock, players[0].id)
    await awardLot(clock, (nom as { data: { lotId: number } }).data.lotId, managers[3].id, 5)

    const res = await pruneQueue(managers[0].id)
    expect(res.ok && res.data.removed).toBe(1)
    expect((await getQueue(managers[0].id)).map((q) => q.playerId)).toEqual([players[1].id])
    // The other manager's identical entry is untouched.
    expect(await getQueue(managers[1].id)).toHaveLength(1)
  })

  it('scopes the queue to the season, so last year’s targets do not reappear', async () => {
    await addToQueue(managers[0].id, players[0].id)
    const [{ season }] = await sql`SELECT season FROM draft WHERE id = 1`
    await sql`UPDATE draft SET season = ${Number(season) + 1} WHERE id = 1`

    expect(await getQueue(managers[0].id)).toHaveLength(0)

    await sql`UPDATE draft SET season = ${season} WHERE id = 1`
    expect(await getQueue(managers[0].id)).toHaveLength(1)
  })
})
