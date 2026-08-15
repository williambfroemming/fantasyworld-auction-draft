/**
 * The private player queue — players you are targeting (docs/BACKLOG.md §4).
 *
 * ## Privacy is the whole feature
 *
 * Every function here takes the manager id from the **signed session cookie**,
 * never from a request body, and every query filters on it. A queue that leaks is
 * worse than no queue: it hands your strategy to the people bidding against you.
 *
 * Two structural rules follow, and they are the reason this is a separate
 * service and a separate route rather than a field on the state payload:
 *
 *  1. **Nothing here may enter `/api/state`.** That payload is league-wide.
 *  2. **Nothing here may enter the polling fingerprint** (`src/lib/version.ts`).
 *     That fingerprint is composed of values every mutation already touches, so
 *     there is no bump discipline to forget — and widening it to cover a private
 *     queue would make *every* client's 204 depend on one person's private edit.
 *
 * ## Auto-pruning
 *
 * Players get bought all night, and a queue still listing three players who sold
 * an hour ago is worse than no queue. Entries are never silently deleted when a
 * player is drafted, though: `drafted` is reported per entry so the UI can say
 * "2 of your targets were drafted" rather than quietly shrinking, which reads as
 * a bug.
 */
import { getSql } from './sql'
import type { ActionResult } from './draft-service'

export interface QueuedPlayer {
  playerId: string
  name: string
  team: string | null
  position: string
  rank: number | null
  byeWeek: number | null
  sortOrder: number
  /** Bought by someone this season — still listed, but struck through. */
  drafted: boolean
  /** On the block right now. */
  onTheBlock: boolean
}

/** A queue is capped so it stays a shortlist rather than a second player pool. */
export const QUEUE_LIMIT = 60

async function currentSeason(): Promise<number> {
  const [d] = await getSql()`SELECT season FROM draft WHERE id = 1`
  return Number(d.season)
}

/** This manager's queue. Never call it with an id from a request body. */
export async function getQueue(managerId: number): Promise<QueuedPlayer[]> {
  const sql = getSql()
  const season = await currentSeason()

  const rows = await sql`
    SELECT q.player_id, q.sort_order,
           p.name, p.team, p.position, p.search_rank, p.bye_week,
           EXISTS (SELECT 1 FROM picks pk
                    WHERE pk.player_id = q.player_id AND pk.season = ${season}) AS drafted,
           EXISTS (SELECT 1 FROM lots l
                    WHERE l.player_id = q.player_id AND l.season = ${season}
                      AND l.status = 'open') AS on_the_block
    FROM player_queue q
    JOIN players p ON p.id = q.player_id
    WHERE q.manager_id = ${managerId} AND q.season = ${season}
    ORDER BY q.sort_order, q.id`

  return rows.map((r) => ({
    playerId: r.player_id,
    name: r.name,
    team: r.team,
    position: r.position,
    rank: r.search_rank,
    byeWeek: r.bye_week,
    sortOrder: Number(r.sort_order),
    drafted: r.drafted,
    onTheBlock: r.on_the_block,
  }))
}

/**
 * Star a player. Idempotent — starring twice is a no-op, not an error, because
 * two taps on a laptop trackpad mid-draft should not produce a red message.
 */
export async function addToQueue(
  managerId: number,
  playerId: string,
): Promise<ActionResult<{ added: boolean }>> {
  const sql = getSql()
  const season = await currentSeason()

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM player_queue
    WHERE manager_id = ${managerId} AND season = ${season}`
  if (Number(n) >= QUEUE_LIMIT) {
    return { ok: false, reason: `Your queue is full at ${QUEUE_LIMIT} players` }
  }

  // One statement: the sort order is derived from the current max inside the
  // insert, so two quick taps cannot both read the same value and collide.
  const rows = await sql`
    INSERT INTO player_queue (season, manager_id, player_id, sort_order)
    SELECT ${season}, ${managerId}, ${playerId},
           COALESCE((SELECT MAX(sort_order) + 1 FROM player_queue
                      WHERE manager_id = ${managerId} AND season = ${season}), 0)
    WHERE EXISTS (SELECT 1 FROM players WHERE id = ${playerId})
    ON CONFLICT (season, manager_id, player_id) DO NOTHING
    RETURNING id`

  if (rows.length === 0) {
    // Either already queued (fine) or an unknown player (not fine).
    const [exists] = await sql`SELECT 1 AS yes FROM players WHERE id = ${playerId}`
    if (!exists) return { ok: false, reason: 'Unknown player' }
    return { ok: true, data: { added: false } }
  }
  return { ok: true, data: { added: true } }
}

export async function removeFromQueue(
  managerId: number,
  playerId: string,
): Promise<ActionResult<{ removed: boolean }>> {
  const sql = getSql()
  const season = await currentSeason()
  const rows = await sql`
    DELETE FROM player_queue
    WHERE manager_id = ${managerId} AND season = ${season} AND player_id = ${playerId}
    RETURNING id`
  return { ok: true, data: { removed: rows.length > 0 } }
}

/** Drop everyone already bought. Offered as a button, never done silently. */
export async function pruneQueue(managerId: number): Promise<ActionResult<{ removed: number }>> {
  const sql = getSql()
  const season = await currentSeason()
  const rows = await sql`
    DELETE FROM player_queue q
    WHERE q.manager_id = ${managerId} AND q.season = ${season}
      AND EXISTS (SELECT 1 FROM picks pk
                   WHERE pk.player_id = q.player_id AND pk.season = ${season})
    RETURNING q.id`
  return { ok: true, data: { removed: rows.length } }
}
