/**
 * One manager, every auction they have drafted in — how they actually spend.
 *
 * ## What this is for
 *
 * `/stats` answers questions about *one* draft: who went RB-heavy in 2026, who
 * was ahead of pace that night. Nothing in the app has ever answered the
 * question the league actually argues about between seasons — "that's just how
 * he drafts" — because that claim is about a person across years and every
 * existing view is scoped to a single one.
 *
 * Five numbers per season turned out to be enough to characterise a drafter:
 *
 *   position mix   what they buy
 *   top-3 share    stars-and-scrubs, or spread around
 *   $1 picks       the other half of that same reading
 *   halfway pick   whether they commit early or wait the room out
 *   places gained  whether any of it worked
 *
 * ## Nothing here is new math
 *
 * Every measure is one the app already computes for a single season, applied
 * per season and lined up. That is deliberate: a member page that disagreed
 * with /stats about 2026 would discredit both, and the cheapest way to be
 * consistent is to call the same function.
 *
 * ⚠️ **Attribution is via `draftersByPick`**, like every other money view. A
 * trade moves `picks.manager_id` but not the salary, so reading the column
 * directly would credit somebody else's $47 to whoever ended up with the
 * player. See the note on `draftersByPick` in `stats.ts`.
 */
import { valueVsResults } from './draft-value'
import {
  SPEND_COLUMNS,
  draftersByPick,
  spendColumnFor,
  type SpendColumn,
  type StatsTrade,
} from './stats'

/**
 * A pick, flattened across seasons.
 *
 * Deliberately not `StatsPick`: that type is season-scoped and carries pool
 * rank, which does not survive the pool being re-imported and is not needed
 * here. This is the cross-season subset that is still true years later.
 */
export interface DnaPick {
  id: number
  season: number
  pickNo: number
  /** CURRENT owner. The drafter is recovered from the trade log. */
  managerId: number
  name: string
  position: string
  price: number
  /** Season fantasy points. **Null is unknown, never zero.** */
  points: number | null
}

export interface DraftDnaSeason {
  season: number
  spent: number
  picks: number
  /**
   * Dollars spent at each position. The stored truth; `positionShare` is
   * derived from it.
   *
   * Carried rather than recovered from `share × spent` because that is
   * floating-point arithmetic on a figure people read as money — a $47 back
   * comes back $46.999999999999996 and renders as $47 only by luck of rounding.
   */
  positionSpend: Record<SpendColumn, number>
  /** Each position's share of what they spent. Sums to 1 (0 if they spent nothing). */
  positionShare: Record<SpendColumn, number>
  /** Share of their spend in their three priciest buys. High = stars and scrubs. */
  topThreeShare: number
  /** Picks bought at the $1 minimum. */
  dollarPicks: number
  /** The pick number at which they had spent half their eventual total. */
  halfwayPick: number | null
  /** That pick as a share of the whole draft, so seasons of different lengths compare. */
  halfwayFraction: number | null
  /**
   * Places their picks beat the price they paid, summed. **Null, not zero,**
   * when the season has no points on record — an unplayed or unimported season
   * is not a manager who broke even.
   */
  placesGained: number | null
}

export interface DraftDnaCareer {
  seasons: number
  /** Dollars at each position across every auction on record. */
  positionSpend: Record<SpendColumn, number>
  /** Shares of career spend, not a mean of the yearly shares — a $50 year and a
      $200 year should not weigh the same. Summing the dollars first gives that
      weighting for free. */
  positionShare: Record<SpendColumn, number>
  /** Means over the seasons on record. */
  topThreeShare: number
  dollarPicks: number
  halfwayFraction: number | null
  /** Summed over the seasons that have points; null when none do. */
  placesGained: number | null
}

export interface DraftDna {
  /** Newest first. */
  seasons: DraftDnaSeason[]
  career: DraftDnaCareer
}

const zeroShares = () =>
  Object.fromEntries(SPEND_COLUMNS.map((c) => [c, 0])) as Record<SpendColumn, number>

/** Shares of a total, or all-zero when the total is zero. */
function sharesOf(byPosition: Record<SpendColumn, number>, total: number) {
  const out = zeroShares()
  if (total <= 0) return out
  for (const c of SPEND_COLUMNS) out[c] = byPosition[c] / total
  return out
}

/**
 * Build one manager's draft history.
 *
 * `picks` is **every pick in every season**, not just this manager's: the trade
 * rewind needs the whole log to resolve, the halfway pick is measured against
 * the length of the whole draft, and `valueVsResults` ranks a player against
 * the rest of the position field that year rather than against their own
 * roster.
 */
export function draftDna(picks: DnaPick[], trades: StatsTrade[], managerId: number): DraftDna {
  // One rewind over the whole log, not one per season. Pick ids are unique
  // across seasons, and a trade never spans two of them.
  const drafter = draftersByPick(
    picks.map((p) => ({
      id: p.id,
      pickNo: p.pickNo,
      managerId: p.managerId,
      nominatorId: 0,
      price: p.price,
      position: p.position,
      name: p.name,
      rank: null,
      posRank: null,
    })),
    trades,
  )

  const bySeason = new Map<number, DnaPick[]>()
  for (const p of picks) {
    const list = bySeason.get(p.season)
    if (list) list.push(p)
    else bySeason.set(p.season, [p])
  }

  const seasons: DraftDnaSeason[] = []

  for (const [season, all] of [...bySeason.entries()].sort((a, b) => b[0] - a[0])) {
    const mine = all
      .filter((p) => (drafter.get(p.id) ?? p.managerId) === managerId)
      .sort((a, b) => a.pickNo - b.pickNo)
    if (mine.length === 0) continue

    const spent = mine.reduce((s, p) => s + p.price, 0)

    const byPosition = zeroShares()
    for (const p of mine) byPosition[spendColumnFor(p.position)] += p.price

    const topThree = [...mine]
      .sort((a, b) => b.price - a.price)
      .slice(0, 3)
      .reduce((s, p) => s + p.price, 0)

    // The pick they were half done spending by — the same measure the spend
    // curve draws as "½", read here as a number instead of a mark on a chart.
    let running = 0
    let halfwayPick: number | null = null
    for (const p of mine) {
      running += p.price
      if (running * 2 >= spent) {
        halfwayPick = p.pickNo
        break
      }
    }
    const lastPick = Math.max(...all.map((p) => p.pickNo))

    // Scored against the whole draft's position field, credited to the drafter
    // — exactly what the Value tab does for a single season.
    const measured = all.some((p) => p.points !== null)
    const placesGained = measured
      ? (valueVsResults(
          all.map((p) => ({
            pickId: p.id,
            name: p.name,
            position: p.position,
            price: p.price,
            managerId: drafter.get(p.id) ?? p.managerId,
            points: p.points,
          })),
        ).byManager.find((b) => b.managerId === managerId)?.delta ?? 0)
      : null

    seasons.push({
      season,
      spent,
      picks: mine.length,
      positionSpend: byPosition,
      positionShare: sharesOf(byPosition, spent),
      topThreeShare: spent > 0 ? topThree / spent : 0,
      dollarPicks: mine.filter((p) => p.price <= 1).length,
      halfwayPick,
      halfwayFraction: halfwayPick !== null && lastPick > 0 ? halfwayPick / lastPick : null,
      placesGained,
    })
  }

  // ---- career ----
  // Dollars summed, then shared out — which weights a $200 season above a $50
  // one automatically. Averaging the yearly shares would treat them equally.
  const careerByPosition = zeroShares()
  let careerSpent = 0
  for (const s of seasons) {
    careerSpent += s.spent
    for (const c of SPEND_COLUMNS) careerByPosition[c] += s.positionSpend[c]
  }

  const withHalfway = seasons.filter((s) => s.halfwayFraction !== null)
  const scored = seasons.filter((s) => s.placesGained !== null)

  return {
    seasons,
    career: {
      seasons: seasons.length,
      positionSpend: careerByPosition,
      positionShare: sharesOf(careerByPosition, careerSpent),
      topThreeShare: seasons.length
        ? seasons.reduce((s, x) => s + x.topThreeShare, 0) / seasons.length
        : 0,
      dollarPicks: seasons.reduce((s, x) => s + x.dollarPicks, 0),
      halfwayFraction: withHalfway.length
        ? withHalfway.reduce((s, x) => s + (x.halfwayFraction as number), 0) / withHalfway.length
        : null,
      placesGained: scored.length
        ? scored.reduce((s, x) => s + (x.placesGained as number), 0)
        : null,
    },
  }
}
