/**
 * FAAB: what each manager spent, what they got for it, and who lost the bidding
 * (docs/ANALYTICS_ROADMAP.md step 60). Pure; the loader feeds it `season_transactions` and
 * `player_weeks`.
 *
 * ## Money
 *
 * `remaining = budget - spent + received - sent`, where `spent` is **completed** waiver bids
 * only and `received` / `sent` are the FAAB dollars that moved in trades (`trade_faab` rows).
 * A FAILED claim's bid was never spent, so it is a "losing bid" and never a charge. Leaving
 * the trade term out puts every manager who traded FAAB (17 trades on record) wrong.
 *
 * ## Points a claim earned
 *
 * Counted from the weeks AFTER the claim week, from `player_weeks`, so they are points scored
 * FOR THAT MANAGER: a player who left the roster scores nothing for it. A claim in week 5 is
 * processed after week 5's games, so the player's first game for the manager is week 6; a
 * player already on that roster in the claim week was re-added, not found, and earns the claim
 * nothing for that week.
 *
 * Each weekly row is credited to ONE acquisition, the latest the manager made of that player
 * before the week (a waiver win, a free-agent add, a trade, a commissioner move), and counts
 * for the claim only when that acquisition was a won waiver claim. Without this a player
 * claimed in week 3, dropped, and picked up free in week 8 would credit weeks 9 onward to the
 * week 3 bid.
 *
 * Two figures, because they answer different questions: `points` (whenever he was on the
 * roster) and `pointsStarted` (only when he was in the lineup). Points on a bench won nothing.
 *
 * ## Rules this file keeps
 *
 * - **A $0 claim has no points per dollar.** It reports points only; `pointsPerDollar` is null
 *   when nothing was spent, and $0 claims are left out of the worst-claims ranking.
 * - **Value is compared within a position, never across.** "Worst claims" measures a claim
 *   against what the same position returned per dollar across all paid claims, never against
 *   other positions: a cross-position list would just rediscover that quarterbacks score more
 *   than tight ends. A claim with no known position is left out of that ranking.
 * - **Null is unknown.** A season with no weekly data has `points: null`, not 0; a player
 *   claimed too late to play a counted week has a genuine 0 and `weeksHeld: 0`.
 * - **Failed claims are kept and reported** (who bid, how much, and who won).
 */

export const FAAB_BUDGET = 100

export interface FaabTransaction {
  season: number
  week: number
  transactionId: string
  type: string
  status: string
  managerId: number
  counterpartyManagerId: number | null
  playerIdAdded: string | null
  playerIdDropped: string | null
  addedName: string | null
  addedPosition: string | null
  droppedName: string | null
  faabBid: number | null
  faabTransferred: number | null
  note: string | null
}

export interface FaabWeek {
  season: number
  week: number
  managerId: number
  playerId: string
  position: string | null
  isStarter: boolean
  points: number
}

export interface FaabClaim {
  season: number
  /** The week Sleeper filed the claim under; the player's first counted game is the next week. */
  week: number
  managerId: number
  playerId: string
  name: string | null
  position: string | null
  droppedName: string | null
  bid: number
  /** Points for this manager in later counted weeks. Null when the season has no weekly data. */
  points: number | null
  pointsStarted: number | null
  /** Counted weeks he was on this manager's roster after the claim. */
  weeksHeld: number
  /**
   * How far short of a typical return for that position and money the claim fell, in points:
   * `bid * positionPointsPerDollar - pointsStarted`. Null for a $0 claim, an unknown position
   * or unknown points.
   */
  shortfall: number | null
}

export interface LostBid {
  season: number
  week: number
  managerId: number
  playerId: string
  name: string | null
  position: string | null
  bid: number
  note: string | null
  /** Who won him that week, and for how much, when a completed claim for him is on record. */
  winnerManagerId: number | null
  winnerBid: number | null
}

export interface ManagerFaab {
  managerId: number
  budget: number
  spent: number
  /** FAAB dollars received in trades. */
  received: number
  /** FAAB dollars sent in trades. */
  sent: number
  remaining: number
  won: number
  lost: number
  /** Won claims that cost nothing. */
  freeWins: number
  /** Points from paid (bid above $0) and free claims, kept apart so a $0 claim never dilutes a rate. */
  pointsPaid: number | null
  pointsStartedPaid: number | null
  pointsFree: number | null
  pointsStartedFree: number | null
  /** Started points per dollar over paid claims; null when nothing was spent or points are unknown. */
  pointsPerDollar: number | null
}

export interface FaabSeason {
  season: number
  budget: number
  managers: ManagerFaab[]
  /** Every won claim, newest first within a manager is the caller's business; order here is by week. */
  claims: FaabClaim[]
  /** Highest winning bids, best first. */
  expensive: FaabClaim[]
  /** Largest shortfalls, worst first; within-position, paid claims only. */
  worst: FaabClaim[]
  /** Every lost bid, biggest first. */
  lostBids: LostBid[]
  /** Whether player_weeks covers this season; when false every `points` is null. */
  hasWeekly: boolean
}

interface Options {
  budget?: number
  /** `season:week` keys of counted weeks (regular season, complete). */
  weekKeys: Set<string>
  /** Seasons with weekly data. A season missing from here reports null points. */
  weeklySeasons: Set<number>
  /** How many entries `expensive` and `worst` hold. */
  top?: number
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** An acquisition: any way a manager came to hold a player. */
interface Acquisition {
  week: number
  claim: FaabClaim | null
}

export function faabReport(
  transactions: FaabTransaction[],
  weeks: FaabWeek[],
  opts: Options,
): FaabSeason[] {
  const budget = opts.budget ?? FAAB_BUDGET
  const top = opts.top ?? 5
  const seasons = [...new Set(transactions.map((t) => t.season))].sort((a, b) => a - b)

  // --- claims, with the points each earned -----------------------------------
  const claims: FaabClaim[] = []
  for (const season of seasons) {
    const hasWeekly = opts.weeklySeasons.has(season)
    const tx = transactions.filter((t) => t.season === season)
    const rows = weeks.filter(
      (w) => w.season === season && opts.weekKeys.has(`${season}:${w.week}`),
    )

    // Every completed way a manager came to hold a player, per manager-player.
    const acquisitions = new Map<string, Acquisition[]>()
    const note = (managerId: number, playerId: string, a: Acquisition) => {
      const key = `${managerId}:${playerId}`
      const list = acquisitions.get(key) ?? []
      list.push(a)
      acquisitions.set(key, list)
    }
    const seasonClaims: FaabClaim[] = []
    for (const t of tx) {
      if (t.status !== 'complete' || !t.playerIdAdded) continue
      if (t.type === 'waiver') {
        const claim: FaabClaim = {
          season,
          week: t.week,
          managerId: t.managerId,
          playerId: t.playerIdAdded,
          name: t.addedName,
          position: t.addedPosition,
          droppedName: t.droppedName,
          bid: t.faabBid ?? 0,
          points: hasWeekly ? 0 : null,
          pointsStarted: hasWeekly ? 0 : null,
          weeksHeld: 0,
          shortfall: null,
        }
        seasonClaims.push(claim)
        note(t.managerId, t.playerIdAdded, { week: t.week, claim })
      } else {
        note(t.managerId, t.playerIdAdded, { week: t.week, claim: null })
      }
    }

    if (hasWeekly) {
      for (const w of rows) {
        const list = acquisitions.get(`${w.managerId}:${w.playerId}`)
        if (!list) continue
        // The latest acquisition strictly before this week; the claim week itself does not count.
        let credited: Acquisition | null = null
        for (const a of list)
          if (a.week < w.week && (!credited || a.week >= credited.week)) credited = a
        const claim = credited?.claim
        if (!claim) continue
        claim.points = (claim.points ?? 0) + w.points
        claim.pointsStarted = (claim.pointsStarted ?? 0) + (w.isStarter ? w.points : 0)
        claim.weeksHeld += 1
      }
    }
    claims.push(...seasonClaims)
  }

  // --- the within-position yardstick, pooled over every season supplied ------
  const pool = new Map<string, { points: number; bid: number }>()
  for (const c of claims) {
    if (c.bid <= 0 || c.position === null || c.pointsStarted === null) continue
    const p = pool.get(c.position) ?? { points: 0, bid: 0 }
    p.points += c.pointsStarted
    p.bid += c.bid
    pool.set(c.position, p)
  }
  for (const c of claims) {
    const p = c.position === null ? undefined : pool.get(c.position)
    if (c.bid > 0 && p && p.bid > 0 && c.pointsStarted !== null) {
      c.shortfall = c.bid * (p.points / p.bid) - c.pointsStarted
    }
  }

  // --- per season ---------------------------------------------------------------
  return seasons.map((season) => {
    const tx = transactions.filter((t) => t.season === season)
    const mine = claims.filter((c) => c.season === season)
    const hasWeekly = opts.weeklySeasons.has(season)
    const managerIds = [...new Set(tx.map((t) => t.managerId))].sort((a, b) => a - b)

    const managers: ManagerFaab[] = managerIds.map((managerId) => {
      const spent = sum(mine.filter((c) => c.managerId === managerId).map((c) => c.bid))
      const received = sum(
        tx
          .filter((t) => t.type === 'trade_faab' && t.managerId === managerId)
          .map((t) => t.faabTransferred ?? 0),
      )
      const sent = sum(
        tx
          .filter((t) => t.type === 'trade_faab' && t.counterpartyManagerId === managerId)
          .map((t) => t.faabTransferred ?? 0),
      )
      const own = mine.filter((c) => c.managerId === managerId)
      const paid = own.filter((c) => c.bid > 0)
      const free = own.filter((c) => c.bid === 0)
      const total = (list: FaabClaim[], pick: (c: FaabClaim) => number | null) =>
        hasWeekly ? sum(list.map((c) => pick(c) ?? 0)) : null
      const pointsStartedPaid = total(paid, (c) => c.pointsStarted)
      return {
        managerId,
        budget,
        spent,
        received,
        sent,
        remaining: budget - spent + received - sent,
        won: own.length,
        lost: tx.filter(
          (t) => t.type === 'waiver' && t.status === 'failed' && t.managerId === managerId,
        ).length,
        freeWins: free.length,
        pointsPaid: total(paid, (c) => c.points),
        pointsStartedPaid,
        pointsFree: total(free, (c) => c.points),
        pointsStartedFree: total(free, (c) => c.pointsStarted),
        pointsPerDollar: spent > 0 && pointsStartedPaid !== null ? pointsStartedPaid / spent : null,
      }
    })

    // Lost bids, each with the claim that beat it: the completed claim for the same player in
    // the same week, the highest if there were several.
    const lostBids: LostBid[] = tx
      .filter((t) => t.type === 'waiver' && t.status === 'failed' && t.playerIdAdded)
      .map((t) => {
        const winner = tx
          .filter(
            (w) =>
              w.type === 'waiver' &&
              w.status === 'complete' &&
              w.week === t.week &&
              w.playerIdAdded === t.playerIdAdded,
          )
          .sort((a, b) => (b.faabBid ?? 0) - (a.faabBid ?? 0))[0]
        return {
          season,
          week: t.week,
          managerId: t.managerId,
          playerId: t.playerIdAdded!,
          name: t.addedName,
          position: t.addedPosition,
          bid: t.faabBid ?? 0,
          note: t.note,
          winnerManagerId: winner?.managerId ?? null,
          winnerBid: winner ? (winner.faabBid ?? 0) : null,
        }
      })
      .sort((a, b) => b.bid - a.bid || a.week - b.week)

    return {
      season,
      budget,
      managers,
      claims: [...mine].sort((a, b) => a.week - b.week),
      expensive: [...mine].sort((a, b) => b.bid - a.bid || a.week - b.week).slice(0, top),
      worst: mine
        .filter((c) => c.shortfall !== null)
        .sort((a, b) => b.shortfall! - a.shortfall! || b.bid - a.bid)
        .slice(0, top),
      lostBids,
      hasWeekly,
    }
  })
}
