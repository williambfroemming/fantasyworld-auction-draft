/**
 * Commissioner actions — the escape hatches.
 *
 * Live drafts go wrong: someone mis-clicks a bid, a player gets awarded to the
 * wrong manager, the room needs to stop for twenty minutes. Every one of these
 * exists because the alternative is editing the database by hand at 11pm.
 *
 * All of them bump `draft.rev`, which is part of the polling fingerprint, so
 * every client picks the change up on its next poll.
 */
import { getSql } from './sql'
import type { ActionResult } from './draft-service'

async function bumpRev() {
  await getSql()`UPDATE draft SET rev = rev + 1 WHERE id = 1`
}

/**
 * Pause: bank the milliseconds left so resuming restores the exact clock.
 *
 * Storing the remainder rather than just a flag is what makes a mid-lot break
 * safe — otherwise the deadline keeps sliding past while everyone is at the
 * fridge, and the lot settles the instant you resume.
 */
export async function pause(): Promise<ActionResult<null>> {
  const sql = getSql()
  await sql`
    UPDATE lots
    SET paused_remaining_ms = GREATEST(0, EXTRACT(EPOCH FROM (ends_at - now())) * 1000)::int
    WHERE status = 'open' AND paused_remaining_ms IS NULL`
  await sql`UPDATE draft SET status = 'paused' WHERE id = 1 AND status = 'live'`
  await bumpRev()
  return { ok: true, data: null }
}

export async function resume(): Promise<ActionResult<null>> {
  const sql = getSql()
  await sql`
    UPDATE lots
    SET ends_at = now() + make_interval(secs => paused_remaining_ms / 1000.0),
        paused_remaining_ms = NULL
    WHERE status = 'open' AND paused_remaining_ms IS NOT NULL`
  await sql`UPDATE draft SET status = 'live' WHERE id = 1 AND status = 'paused'`
  await bumpRev()
  return { ok: true, data: null }
}

/** Change the defaults. Applies to the next nomination, not the live lot. */
export async function setTimers(
  timerSeconds: number,
  softCloseSeconds: number,
): Promise<ActionResult<null>> {
  if (timerSeconds < 3 || timerSeconds > 300) return { ok: false, reason: 'Timer must be 3–300s' }
  if (softCloseSeconds < 1 || softCloseSeconds > timerSeconds) {
    return { ok: false, reason: 'Soft close must be between 1s and the full timer' }
  }
  await getSql()`UPDATE draft SET timer_seconds = ${timerSeconds},
                 soft_close_seconds = ${softCloseSeconds} WHERE id = 1`
  await bumpRev()
  return { ok: true, data: null }
}

/** Nudge the clock on the lot that's actually running. */
export async function adjustClock(deltaSeconds: number): Promise<ActionResult<null>> {
  const sql = getSql()
  const rows = await sql`
    UPDATE lots
    SET ends_at = GREATEST(now(), ends_at + make_interval(secs => ${deltaSeconds})),
        version = version + 1
    WHERE status = 'open'
    RETURNING id`
  if (rows.length === 0) return { ok: false, reason: 'No lot is on the clock' }
  return { ok: true, data: null }
}

/**
 * Undo the most recent pick: refund it, return the player to the pool, and
 * rewind the nomination order by one so the same manager nominates again.
 */
export async function undoLastPick(): Promise<ActionResult<{ playerName: string }>> {
  const sql = getSql()
  const [last] = await sql`
    SELECT pk.id, pk.player_id, p.name FROM picks pk
    JOIN players p ON p.id = pk.player_id
    ORDER BY pk.pick_no DESC LIMIT 1`
  if (!last) return { ok: false, reason: 'There are no picks to undo' }

  await sql`DELETE FROM picks WHERE id = ${last.id}`
  // Void the lot so the player is draftable again but the history is kept.
  await sql`UPDATE lots SET status = 'void' WHERE player_id = ${last.player_id} AND status = 'sold'`
  await sql`UPDATE draft SET nomination_index = GREATEST(0, nomination_index - 1) WHERE id = 1`
  await bumpRev()
  return { ok: true, data: { playerName: last.name } }
}

/** Fix a mistyped price. Budget recalculates automatically — it's derived. */
export async function editPrice(pickId: number, price: number): Promise<ActionResult<null>> {
  if (!Number.isInteger(price) || price < 0) return { ok: false, reason: 'Price must be a whole dollar' }
  const sql = getSql()

  // Guard the invariant by hand here: this is the one path that can write a
  // price without going through the bid rules, so it must not be able to push
  // a manager below $1 per empty roster slot.
  const [check] = await sql`
    SELECT d.starting_budget, d.roster_size,
           COALESCE(SUM(pk.price), 0) AS spent, COUNT(pk.id) AS rostered,
           (SELECT price FROM picks WHERE id = ${pickId}) AS old_price,
           (SELECT manager_id FROM picks WHERE id = ${pickId}) AS manager_id
    FROM draft d
    LEFT JOIN picks pk ON pk.manager_id = (SELECT manager_id FROM picks WHERE id = ${pickId})
    WHERE d.id = 1
    GROUP BY d.starting_budget, d.roster_size`
  if (!check?.manager_id) return { ok: false, reason: 'Unknown pick' }

  const newSpent = Number(check.spent) - Number(check.old_price) + price
  const budget = Number(check.starting_budget) - newSpent
  const slotsLeft = Number(check.roster_size) - Number(check.rostered)
  if (budget < slotsLeft) {
    return {
      ok: false,
      reason: `That would leave $${budget} for ${slotsLeft} empty slots — they need at least $1 each`,
    }
  }

  await sql`UPDATE picks SET price = ${price} WHERE id = ${pickId}`
  await bumpRev()
  return { ok: true, data: null }
}

/** Give a player to a different manager. */
export async function reassignPick(pickId: number, managerId: number): Promise<ActionResult<null>> {
  const sql = getSql()
  const [pick] = await sql`SELECT price FROM picks WHERE id = ${pickId}`
  if (!pick) return { ok: false, reason: 'Unknown pick' }

  const [totals] = await sql`SELECT budget, rostered FROM manager_totals WHERE id = ${managerId}`
  const [settings] = await sql`SELECT roster_size FROM draft WHERE id = 1`
  if (!totals) return { ok: false, reason: 'Unknown manager' }
  if (Number(totals.rostered) >= Number(settings.roster_size)) {
    return { ok: false, reason: 'That roster is already full' }
  }
  const slotsAfter = Number(settings.roster_size) - Number(totals.rostered) - 1
  if (Number(totals.budget) - Number(pick.price) < slotsAfter) {
    return { ok: false, reason: 'They cannot afford it and still fill their roster' }
  }

  await sql`UPDATE picks SET manager_id = ${managerId} WHERE id = ${pickId}`
  await bumpRev()
  return { ok: true, data: null }
}

/** Skip whoever is on the clock — they've stepped away. */
export async function skipNominator(): Promise<ActionResult<null>> {
  const sql = getSql()
  const [open] = await sql`SELECT id FROM lots WHERE status = 'open'`
  if (open) return { ok: false, reason: 'Finish the current lot first' }
  await sql`UPDATE draft SET nomination_index = nomination_index + 1 WHERE id = 1`
  await bumpRev()
  return { ok: true, data: null }
}

/** Cancel the lot on the clock without awarding it. */
export async function voidLot(): Promise<ActionResult<null>> {
  const sql = getSql()
  const rows = await sql`UPDATE lots SET status = 'void' WHERE status = 'open' RETURNING id`
  if (rows.length === 0) return { ok: false, reason: 'No lot is on the clock' }
  await sql`UPDATE draft SET nomination_index = GREATEST(0, nomination_index - 1) WHERE id = 1`
  await bumpRev()
  return { ok: true, data: null }
}

export async function setStatus(status: 'setup' | 'live' | 'done'): Promise<ActionResult<null>> {
  await getSql()`UPDATE draft SET status = ${status} WHERE id = 1`
  await bumpRev()
  return { ok: true, data: null }
}

/** Re-draw the seating. Locked once the draft is live and picks exist. */
export async function setDraftOrder(orderedManagerIds: number[]): Promise<ActionResult<null>> {
  const sql = getSql()
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
  const [settings] = await sql`SELECT status FROM draft WHERE id = 1`
  if (Number(n) > 0 && settings.status !== 'setup') {
    return { ok: false, reason: 'The draft has started — use "swap two managers" instead' }
  }
  for (const [slot, id] of orderedManagerIds.entries()) {
    await sql`UPDATE managers SET draft_slot = ${slot} WHERE id = ${id}`
  }
  await bumpRev()
  return { ok: true, data: null }
}

/** Swap two seats mid-draft; completed picks are untouched. */
export async function swapSeats(aId: number, bId: number): Promise<ActionResult<null>> {
  const sql = getSql()
  const rows = await sql`SELECT id, draft_slot FROM managers WHERE id IN (${aId}, ${bId})`
  if (rows.length !== 2) return { ok: false, reason: 'Unknown manager' }
  const [a, b] = rows
  await sql`UPDATE managers SET draft_slot = ${b.draft_slot} WHERE id = ${a.id}`
  await sql`UPDATE managers SET draft_slot = ${a.draft_slot} WHERE id = ${b.id}`
  await bumpRev()
  return { ok: true, data: null }
}

/** Let someone re-set a forgotten PIN. */
export async function clearPin(managerId: number): Promise<ActionResult<null>> {
  await getSql()`UPDATE managers SET pin_hash = NULL WHERE id = ${managerId}`
  return { ok: true, data: null }
}
