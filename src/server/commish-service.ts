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
import { getState, type ActionResult } from './draft-service'

async function bumpRev() {
  await getSql()`UPDATE draft SET rev = rev + 1 WHERE id = 1`
}

/**
 * The year being drafted right now.
 *
 * Every action in this file operates on the current season only. Past seasons
 * are an archive: undoing a pick from 2026 in 2028 would silently rewrite a
 * finished draft, and none of these controls are reachable from the read-only
 * archive view. See docs/BACKLOG.md §2.
 */
async function currentSeason(): Promise<number> {
  const [d] = await getSql()`SELECT season FROM draft WHERE id = 1`
  return Number(d.season)
}

/**
 * Copy the current seating into `season_orders` for this season.
 *
 * `managers.draft_slot`, `display_name` and `color` are live, mutable columns —
 * re-drawn every setup and editable all season. This snapshot is what makes
 * "who picked where in 2026" survive the 2027 draw. Called after anything that
 * changes seating or naming, so the current season's row always matches
 * reality; once the season rolls over, nothing writes to it again and it is
 * frozen for good.
 */
async function snapshotOrder(season: number) {
  await getSql()`
    INSERT INTO season_orders (season, manager_id, draft_slot, display_name, color)
    SELECT ${season}, m.id, m.draft_slot, m.display_name, m.color FROM managers m
    ON CONFLICT (season, manager_id)
    DO UPDATE SET draft_slot   = EXCLUDED.draft_slot,
                  display_name = EXCLUDED.display_name,
                  color        = EXCLUDED.color`
}

/**
 * Pause: stop nominations and awards until someone resumes.
 *
 * There is no clock to bank any more — an open lot simply stays open. Pause
 * exists so that a break, or an argument about a price, cannot be resolved by
 * someone quietly typing a result in while the room isn't looking.
 */
export async function pause(): Promise<ActionResult<null>> {
  await getSql()`UPDATE draft SET status = 'paused' WHERE id = 1 AND status = 'live'`
  await bumpRev()
  return { ok: true, data: null }
}

export async function resume(): Promise<ActionResult<null>> {
  await getSql()`UPDATE draft SET status = 'live' WHERE id = 1 AND status = 'paused'`
  await bumpRev()
  return { ok: true, data: null }
}

/**
 * Undo the most recent pick: refund it, return the player to the pool, and hand
 * the turn back to the manager who nominated it.
 *
 * "Hand the turn back" used to mean `nomination_index - 1`, which is wrong
 * whenever nomination skipped a full roster to reach that seat — the cursor
 * lands mid-skip-run instead of on the nominator. `lots.nomination_index` is
 * the recorded answer; see docs/BACKLOG.md §9 P2.
 */
export async function undoLastPick(): Promise<ActionResult<{ playerName: string }>> {
  const sql = getSql()
  const season = await currentSeason()
  const [last] = await sql`
    SELECT pk.id, pk.player_id, pk.player_name AS name FROM picks pk
    WHERE pk.season = ${season}
    ORDER BY pk.pick_no DESC LIMIT 1`
  if (!last) return { ok: false, reason: 'There are no picks to undo' }

  // A traded player's salary is held in place by a pair of budget_adjustments
  // that reference this pick's price. Deleting the pick would leave those
  // adjustments behind with nothing to cancel, quietly shifting both managers'
  // budgets for the rest of the draft. Undo the trade first.
  const [traded] = await sql`
    SELECT id FROM trades
    WHERE ${last.id}::int = ANY(picks_a_to_b) OR ${last.id}::int = ANY(picks_b_to_a)
    LIMIT 1`
  if (traded) {
    return {
      ok: false,
      reason: `${last.name} has been traded (trade #${traded.id}) — reverse the trade before undoing the pick`,
    }
  }

  // One statement, three effects: drop the pick, void its lot so the player is
  // draftable again while the history is kept, and rewind the cursor to the
  // seat that nominated. Split across three statements a failure between them
  // could leave a sold lot with no pick, or a refunded player still undraftable.
  //
  // The status reversal matters as much as the rewind: awarding the final pick
  // now flips the draft to 'done', and 'done' refuses nominations. Undoing that
  // pick without undoing the status would leave the draft one player short and
  // permanently unable to fill it.
  await sql`
    WITH gone AS (
      DELETE FROM picks WHERE id = ${last.id}
      RETURNING player_id
    ), voided AS (
      UPDATE lots SET status = 'void'
      WHERE player_id = (SELECT player_id FROM gone)
        AND status = 'sold' AND season = ${season}
      RETURNING nomination_index
    )
    UPDATE draft
    SET nomination_index = COALESCE(
          (SELECT v.nomination_index FROM voided v),
          GREATEST(0, draft.nomination_index - 1)),
        status = CASE WHEN status = 'done' THEN 'live' ELSE status END,
        rev = rev + 1
    WHERE id = 1`
  return { ok: true, data: { playerName: last.name } }
}

/** Fix a mistyped price. Budget recalculates automatically — it's derived. */
export async function editPrice(pickId: number, price: number): Promise<ActionResult<null>> {
  if (!Number.isInteger(price) || price < 1) {
    return { ok: false, reason: 'Every player costs at least $1' }
  }
  const sql = getSql()

  // Guard the invariant by hand here: this is the one path that can write a
  // price without going through the award rules, so it must not be able to push
  // a manager below $1 per empty roster slot.
  //
  // The starting point is manager_totals rather than a SUM over picks, because
  // that view is the only thing that also folds in budget_adjustments. Summing
  // picks directly would ignore every trade this manager has made.
  const [check] = await sql`
    SELECT t.budget, t.rostered, d.roster_size, pk.price AS old_price, pk.season
    FROM picks pk
    JOIN manager_totals t ON t.id = pk.manager_id
    CROSS JOIN draft d
    WHERE pk.id = ${pickId} AND d.id = 1`
  if (!check) return { ok: false, reason: 'Unknown pick' }
  // manager_totals only describes the current season, so its budget is the
  // wrong yardstick for an older pick — and a finished draft should not be
  // edited years later regardless.
  if (Number(check.season) !== (await currentSeason())) {
    return { ok: false, reason: `That pick is from the ${check.season} draft and is archived` }
  }

  const budget = Number(check.budget) - (price - Number(check.old_price))
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

/**
 * Give a player to a different manager — "we awarded that to the wrong person".
 *
 * NOT a trade. This moves the charge along with the player, because the premise
 * is that the original award was a mistake and the money was never really the
 * first manager's to spend. A trade deliberately leaves the salary behind; see
 * src/server/trade-service.ts.
 */
export async function reassignPick(pickId: number, managerId: number): Promise<ActionResult<null>> {
  const sql = getSql()
  const [pick] = await sql`SELECT price, season FROM picks WHERE id = ${pickId}`
  if (!pick) return { ok: false, reason: 'Unknown pick' }
  if (Number(pick.season) !== (await currentSeason())) {
    return { ok: false, reason: `That pick is from the ${pick.season} draft and is archived` }
  }

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

/**
 * Skip whoever is on the clock — they've stepped away.
 *
 * ⚠️ Advances past the seat that is *actually* on the clock, not past the raw
 * cursor. Those differ whenever full rosters were skipped to reach the current
 * nominator: with the cursor at 1 and seats 1–4 full, seat 5 is on the clock,
 * and `nomination_index + 1` would move the cursor to 2 — which still resolves
 * to seat 5. The skip button would do nothing, repeatedly, with the room
 * watching. Same root cause as docs/BACKLOG.md §9 P2: the cursor is not the
 * seat.
 */
export async function skipNominator(): Promise<ActionResult<null>> {
  const sql = getSql()
  const season = await currentSeason()
  const [open] = await sql`SELECT id FROM lots WHERE status = 'open' AND season = ${season}`
  if (open) return { ok: false, reason: 'Finish the current lot first' }

  const state = await getState()
  if (!state.onTheClock) return { ok: false, reason: 'Nobody is on the clock to skip' }

  await sql`UPDATE draft SET nomination_index = ${state.onTheClock.index + 1}, rev = rev + 1
            WHERE id = 1`
  return { ok: true, data: null }
}

/**
 * Cancel the lot on the clock without awarding it, and give the turn back to
 * whoever nominated it.
 *
 * Same rewind as `undoLastPick`, and for the same reason: nomination may have
 * advanced the cursor past several full rosters to reach that seat, so `- 1`
 * does not undo it. `lots.nomination_index` is the exact answer, with the old
 * behaviour kept as the fallback for lots opened before that column existed.
 *
 * One statement so a void cannot half-apply into a cancelled lot whose turn was
 * never returned — which reads in the room as the app skipping someone.
 */
export async function voidLot(): Promise<ActionResult<null>> {
  const sql = getSql()
  const season = await currentSeason()
  const rows = await sql`
    WITH voided AS (
      UPDATE lots SET status = 'void'
      WHERE status = 'open' AND season = ${season}
      RETURNING id, nomination_index
    )
    UPDATE draft
    SET nomination_index = COALESCE(
          (SELECT v.nomination_index FROM voided v),
          GREATEST(0, draft.nomination_index - 1)),
        rev = rev + 1
    WHERE id = 1 AND EXISTS (SELECT 1 FROM voided)
    RETURNING (SELECT v.id FROM voided v) AS lot_id`
  if (rows.length === 0) return { ok: false, reason: 'No lot is on the clock' }
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
  const [settings] = await sql`SELECT season, status FROM draft WHERE id = 1`
  const season = Number(settings.season)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${season}`
  if (Number(n) > 0 && settings.status !== 'setup') {
    return { ok: false, reason: 'The draft has started — use "swap two managers" instead' }
  }
  for (const [slot, id] of orderedManagerIds.entries()) {
    await sql`UPDATE managers SET draft_slot = ${slot} WHERE id = ${id}`
  }
  await snapshotOrder(season)
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
  await snapshotOrder(await currentSeason())
  await bumpRev()
  return { ok: true, data: null }
}

/** Let someone re-set a forgotten PIN. */
export async function clearPin(managerId: number): Promise<ActionResult<null>> {
  await getSql()`UPDATE managers SET pin_hash = NULL WHERE id = ${managerId}`
  return { ok: true, data: null }
}

/** Budget and roster size. Locked once picks exist — both feed max bid. */
export async function setLeagueSettings(
  startingBudget: number,
  rosterSize: number,
): Promise<ActionResult<null>> {
  if (startingBudget < 1 || startingBudget > 10_000) return { ok: false, reason: 'Budget out of range' }
  if (rosterSize < 1 || rosterSize > 40) return { ok: false, reason: 'Roster size out of range' }

  const sql = getSql()
  const season = await currentSeason()
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${season}`
  if (Number(n) > 0) {
    // Changing either mid-draft would silently rewrite every manager's max bid
    // and could push someone below $1 per empty slot retroactively.
    //
    // Scoped to this season on purpose: a past draft's 160 picks must not lock
    // the league out of changing the budget for a NEW year.
    return { ok: false, reason: `Cannot change these after the draft starts (${n} picks made)` }
  }

  await sql`UPDATE draft SET starting_budget = ${startingBudget}, roster_size = ${rosterSize} WHERE id = 1`
  await bumpRev()
  return { ok: true, data: null }
}

/** Rename a manager / change what the board calls them. */
export async function renameManager(
  managerId: number,
  displayName: string,
): Promise<ActionResult<null>> {
  const trimmed = displayName.trim()
  if (!trimmed) return { ok: false, reason: 'Name cannot be empty' }
  await getSql()`UPDATE managers SET display_name = ${trimmed} WHERE id = ${managerId}`
  // Only the current season's snapshot follows the rename. Past seasons keep
  // the name that was on the board that night.
  await snapshotOrder(await currentSeason())
  await bumpRev()
  return { ok: true, data: null }
}

/**
 * Wipe THIS SEASON'S picks, lots, trades, and adjustments and return to setup.
 *
 * Destructive and irreversible — this is the "we ran a rehearsal, now clear it
 * out" button. Managers, PINs, and the player pool are left alone.
 *
 * ⚠️ This is NOT how a new year starts. Use `startNewSeason()` /
 * `npm run season:new` for that: it keeps the finished draft and rolls the
 * season forward, which is the whole point of docs/BACKLOG.md §2. Reset exists
 * to clear a *rehearsal* of the season currently being set up.
 *
 * Every DELETE is scoped to `draft.season`. Unscoped, this single function
 * would erase every draft the league has ever run — which is exactly the risk
 * §2 was written about.
 *
 * budget_adjustments must go too. Leaving them would carry trade cash from the
 * rehearsal into the real draft, and because budgets are derived nobody would
 * see a stale number to be suspicious of — they'd just start at $190.
 */
export async function resetDraft(): Promise<ActionResult<{ cleared: number; season: number }>> {
  const sql = getSql()
  const season = await currentSeason()
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${season}`
  await sql`DELETE FROM budget_adjustments WHERE season = ${season}`
  await sql`DELETE FROM trades WHERE season = ${season}`
  await sql`DELETE FROM picks WHERE season = ${season}`
  await sql`DELETE FROM lots WHERE season = ${season}`
  await sql`UPDATE draft SET status = 'setup', nomination_index = 0, rev = rev + 1 WHERE id = 1`
  return { ok: true, data: { cleared: Number(n), season } }
}

/**
 * Start a new season. The replacement for "reset and start over".
 *
 * Deletes nothing. The finished draft keeps its rows, tagged with the season it
 * belonged to, and simply stops matching the current-season filter — so it
 * drops out of every live query and appears in the archive instead.
 *
 * Refuses to move backwards or sideways: a season is only ever created ahead of
 * the current one, because rolling onto a year that already has picks would
 * merge two drafts into one and produce budgets that are the sum of both.
 */
export async function startNewSeason(year: number): Promise<ActionResult<{ season: number }>> {
  const sql = getSql()
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    return { ok: false, reason: 'That is not a season year' }
  }

  const [d] = await sql`SELECT season, status FROM draft WHERE id = 1`
  const current = Number(d.season)
  if (year <= current) {
    return { ok: false, reason: `The league is already on ${current} — a new season must be later` }
  }
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${year}`
  if (Number(n) > 0) {
    return { ok: false, reason: `${year} already has ${n} picks — it is not a new season` }
  }

  // Freeze the outgoing season's seating before managers.draft_slot is re-drawn
  // for the new year. After this, nothing writes to that row again.
  await snapshotOrder(current)

  await sql`UPDATE draft
            SET season = ${year}, status = 'setup', nomination_index = 0, rev = rev + 1
            WHERE id = 1`

  // Seed the new season's order from the seating as it stands, so the archive
  // has a row for it even if nobody re-draws before the draft.
  await snapshotOrder(year)
  return { ok: true, data: { season: year } }
}
