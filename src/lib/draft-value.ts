/**
 * What a pick was actually worth — measured against the season it bought.
 *
 * ## This is not `valueVsRoom`, and the difference is the whole point
 *
 * `valueVsRoom` in `stats.ts` compares a price to what the room paid for
 * similarly-ranked players at the same position **that night**. It is the only
 * thing computable during or right after a draft, because nobody has played a
 * game yet. It answers "did you pay over the odds?" and it is silent on whether
 * the player was any good.
 *
 * This answers the question people actually argue about at the next draft: who
 * paid a dollar for someone who went on to finish top five, and who spent half
 * their budget on a player who did nothing. It needs a finished season, so it
 * exists only for the archive — never on the live board.
 *
 * ## Why rank against rank, rather than points per dollar
 *
 * Points per dollar is degenerate at the bottom: the minimum bid is $1, so a
 * $1 player who scores 214 posts 214 points-per-dollar and buries every other
 * result in the list. Every "best value" leaderboard built that way is just a
 * list of $1 picks sorted by points.
 *
 * So both sides become ranks within the position: where the price slotted a
 * player among that position's drafted players, and where they actually
 * finished. The delta is how many places they beat or missed their price by,
 * which is scale-free, immune to a scoring-settings change, and reads the way
 * people talk — "a $1 flier who finished WR4".
 *
 * ## Within a position, never across
 *
 * The same rule the room view lives under, and for a stronger reason here: this
 * is a superflex league, QBs score far more than anyone, so a cross-position
 * comparison would rank every quarterback a steal and every kicker a bust
 * without measuring anything. K and DEF are excluded outright — they are
 * bought for a dollar and their scoring does not compare.
 */

/** The positions this measures. See the note above on K and DEF. */
export const VALUED_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

export interface ResultPick {
  pickId: number
  name: string
  position: string
  price: number
  managerId: number
  /**
   * Total fantasy points that season. **Null means unknown, never zero** — a
   * player with no season row (retired, never rostered by anyone in Sleeper)
   * has not been measured, and scoring them 0 would rank them the worst bust
   * in the league on no evidence.
   */
  points: number | null
}

export interface ValuedResult {
  pickId: number
  name: string
  position: string
  price: number
  managerId: number
  points: number
  /** Where the price slotted them among drafted players at this position. 1 = priciest. */
  priceRank: number
  /** Where they actually finished among those same players. 1 = most points. */
  finishRank: number
  /** priceRank − finishRank. Positive beat their price; negative missed it. */
  delta: number
}

export interface ResultsReport {
  scored: ValuedResult[]
  /** Best delta first — cheap players who produced. */
  steals: ValuedResult[]
  /** Worst delta first — expensive players who did not. */
  busts: ValuedResult[]
  byManager: Array<{ managerId: number; delta: number; scored: number }>
  /** Picks with no points on record, and so no verdict. */
  unscored: number
}

/**
 * Score every pick against how the player's season actually went.
 *
 * `topN` bounds the steals/busts lists only; `scored` always holds everything.
 */
export function valueVsResults(picks: ResultPick[], opts: { topN?: number } = {}): ResultsReport {
  const topN = opts.topN ?? 5
  const scored: ValuedResult[] = []
  let unscored = 0

  for (const position of VALUED_POSITIONS) {
    const group = picks.filter((p) => p.position === position)
    const measured = group.filter((p): p is ResultPick & { points: number } => p.points !== null)
    unscored += group.length - measured.length

    // Price ranks span the whole group, including unmeasured players: they were
    // still bought, and still took up a slot in what the room paid. Finish
    // ranks span only the measured ones, because that is all that is known.
    const priceRank = new Map<number, number>()
    ;[...group]
      .sort((a, b) => b.price - a.price || a.name.localeCompare(b.name))
      .forEach((p, i) => priceRank.set(p.pickId, i + 1))

    ;[...measured]
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
      .forEach((p, i) => {
        const pr = priceRank.get(p.pickId)!
        scored.push({
          pickId: p.pickId,
          name: p.name,
          position: p.position,
          price: p.price,
          managerId: p.managerId,
          points: p.points,
          priceRank: pr,
          finishRank: i + 1,
          delta: pr - (i + 1),
        })
      })
  }

  const byManager = new Map<number, { managerId: number; delta: number; scored: number }>()
  for (const s of scored) {
    const row = byManager.get(s.managerId) ?? { managerId: s.managerId, delta: 0, scored: 0 }
    row.delta += s.delta
    row.scored += 1
    byManager.set(s.managerId, row)
  }

  const ranked = [...scored].sort((a, b) => b.delta - a.delta || a.price - b.price)
  return {
    scored,
    steals: ranked.slice(0, topN),
    busts: ranked.slice(-topN).reverse(),
    byManager: [...byManager.values()].sort((a, b) => b.delta - a.delta),
    unscored,
  }
}
