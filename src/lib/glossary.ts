/**
 * Every number the app shows, and how it is worked out.
 *
 * ## Why this is data and not a page full of prose
 *
 * The definitions used to live where the numbers were drawn — a subtitle under
 * each panel heading, a paragraph of methodology under each table. That put the
 * same caveat in four places and none of them where somebody actually goes
 * looking, and it made every analysis screen read like it was apologising for
 * itself. Here they are rows: the page renders them, the `?` links point at
 * their `id`, and there is one wording per metric.
 *
 * ## `source` is load-bearing
 *
 * Each entry names the function it describes. This file is a transcription of
 * code that already exists — nothing here computes anything — and the whole
 * failure mode of a glossary is drifting away from the thing it documents. A
 * named source is what makes the drift findable: change `managerPace` and the
 * grep for it lands you here.
 *
 * A rule for adding to this: an entry earns its place only if a reader could
 * misread the number without it. "Spent = total dollars spent" is not an entry.
 */

export type GlossaryGroup = 'auction' | 'draft' | 'league'

export interface GlossaryEntry {
  /** Anchor, so `/glossary#vs-room` lands on the row. Stable — links use it. */
  id: string
  term: string
  group: GlossaryGroup
  /** Where in the app you meet it. */
  where: string
  /** The calculation, in one line. */
  formula: string
  /** The one caveat that changes how the number should be read. Optional. */
  note?: string
  /** The function or view that computes it. Keeps this file honest. */
  source: string
}

export const GLOSSARY_GROUPS: Array<{ id: GlossaryGroup; title: string; blurb: string }> = [
  {
    id: 'auction',
    title: 'The auction',
    blurb: 'Money and turn order, live on draft night.',
  },
  {
    id: 'draft',
    title: 'Spend & value',
    blurb: 'A finished auction, read back as numbers.',
  },
  {
    id: 'league',
    title: 'League history',
    blurb: 'Seasons, records and the all-time table.',
  },
]

export const GLOSSARY: GlossaryEntry[] = [
  // -------------------------------------------------------------------------
  // The auction
  // -------------------------------------------------------------------------
  {
    id: 'budget',
    term: 'Budget',
    group: 'auction',
    where: 'Draft room · Board · Spend & Value',
    formula: 'starting budget − everything you have spent this season + any budget adjustments',
    note: 'Never stored, always derived from the picks. Filtered to the current season, so last year’s spending cannot follow you into this one.',
    source: 'manager_totals view — src/db/sql/manager_totals.sql',
  },
  {
    id: 'max-bid',
    term: 'Max bid',
    group: 'auction',
    where: 'Draft room · Board',
    formula: 'budget − (roster size − players rostered − 1)',
    note: 'Every roster spot you still have to fill keeps $1 in reserve, which is why the opening max is $185 rather than $200. It is also what makes it impossible to end up holding empty slots and no money.',
    source: 'maxBidFor() — src/lib/draft.ts',
  },
  {
    id: 'per-slot',
    term: '$/slot',
    group: 'auction',
    where: 'Draft room · Spend & Value → Pace',
    formula: 'budget ÷ roster spots still to fill',
    note: 'A full roster reads 0, not infinity — there is nothing left to spend it on.',
    source: 'perSlotLeft() — src/lib/stats.ts',
  },
  {
    id: 'nomination-order',
    term: 'Nomination order',
    group: 'auction',
    where: 'Draft room',
    formula: 'a snake through the drawn seat order: round 1 runs down it, round 2 back up it, and so on',
    note: 'A manager with a full roster is skipped rather than given a turn they cannot use, so the seat on the clock can be several places past where a round count would put it.',
    source: 'nominatorAt() — src/lib/draft.ts',
  },
  {
    id: 'spend-split',
    term: 'Spend split',
    group: 'auction',
    where: 'Draft room · Board → Market',
    formula: 'each position’s share of what has been spent',
    note: 'Grouped by the player’s real position, not the roster slot they are drawn in — a receiver in your FLEX is still a receiver.',
    source: 'positionMarket() — src/lib/draft.ts',
  },
  {
    id: 'market-median',
    term: 'Market by position',
    group: 'auction',
    where: 'Board → Market',
    formula: 'count, total, median, average and range of the prices paid at each position',
    note: 'Kickers and defenses are left out here: they go for a dollar or two and would drag every figure toward the floor. The Teams table keeps them, in an OTHER column, because a budget row has to add up to what someone actually spent.',
    source: 'positionMarket() — src/lib/draft.ts',
  },

  // -------------------------------------------------------------------------
  // Spend & value
  // -------------------------------------------------------------------------
  {
    id: 'attribution',
    term: 'Who a dollar counts against',
    group: 'draft',
    where: 'Every money figure in Spend & Value, and on a member page',
    formula: 'the manager who bought the player at auction — not whoever owns them now',
    note: 'A trade moves the player but not the salary, so the money stays charged to the buyer. The trade log is the only surviving record of who that was, and it is replayed backwards to recover it.',
    source: 'draftersByPick() — src/lib/stats.ts',
  },
  {
    id: 'team-spend',
    term: 'Spend by team',
    group: 'draft',
    where: 'Spend & Value → Teams',
    formula: 'each manager’s auction spend, split QB / RB / WR / TE / OTHER',
    note: 'OTHER is kickers and defenses. They are folded in rather than dropped so every row totals what that manager actually spent.',
    source: 'teamSpend() — src/lib/stats.ts',
  },
  {
    id: 'drift',
    term: 'adj',
    group: 'draft',
    where: 'Spend & Value → Teams',
    formula: 'starting budget − (spent + money left)',
    note: 'Should be zero. Anything else is money that moved without a pick behind it — trade cash, or a commissioner correction. Shown rather than hidden, so a row that does not add up says so.',
    source: 'TeamSpendRow.drift — src/lib/stats.ts',
  },
  {
    id: 'market-pace',
    term: 'Average price per block of picks',
    group: 'draft',
    where: 'Spend & Value → Pace',
    formula: 'picks bucketed two full rounds at a time; the total, mean, median and top price in each',
    note: 'The block size is derived from the league size rather than fixed, so it stays sensible if the league ever changes shape.',
    source: 'spendBlocks() — src/lib/stats.ts',
  },
  {
    id: 'vs-room',
    term: 'vs room median',
    group: 'draft',
    where: 'Spend & Value → Pace',
    formula: 'your $/slot − the median $/slot of every manager who can still bid',
    note: 'Positive means you have more money per remaining spot than the room does. Managers with a full roster are left out of the median: they cannot bid, so their leftover money will never chase another player.',
    source: 'managerPace() — src/lib/stats.ts',
  },
  {
    id: 'spend-curve',
    term: 'Spend curve',
    group: 'draft',
    where: 'Spend & Value → Curve',
    formula: 'a running total of dollars spent, by pick number',
    note: 'The straight line is an even pace — spending the same amount on every pick. Every panel shares one set of axes, so the shapes compare directly.',
    source: 'spendCurve() — src/lib/stats.ts',
  },
  {
    id: 'halfway-pick',
    term: '½ (halfway pick)',
    group: 'draft',
    where: 'Spend & Value → Curve · Member page → Draft DNA',
    formula: 'the first pick at which a manager had spent half of their eventual total',
    note: 'Early is stars-and-scrubs; late is spreading it around. On a member page it is shown as a share of the draft, so seasons of different lengths compare.',
    source: 'ManagerCurve.halfwayPick — src/lib/stats.ts',
  },
  {
    id: 'nominations',
    term: 'Nominations, won and win %',
    group: 'draft',
    where: 'Spend & Value → Nominations',
    formula: 'players you put up; how many you ended up buying; won ÷ put up',
    note: 'A low win rate is not automatically bad — putting up players you do not want is how a rival’s budget gets drained. Credit follows whoever bought the player that night, so a later trade cannot rewrite who won their own nomination.',
    source: 'nominationStats() — src/lib/stats.ts',
  },
  {
    id: 'to-rivals',
    term: '$ to rivals',
    group: 'draft',
    where: 'Spend & Value → Nominations',
    formula: 'total price of the players you nominated and somebody else bought',
    source: 'nominationStats() — src/lib/stats.ts',
  },
  {
    id: 'value',
    term: 'Steals & busts',
    group: 'draft',
    where: 'Spend & Value → Value',
    formula: 'where the price ranked a player at their position, minus where they actually finished that season',
    note: 'Positive beat their price. Ranks rather than points-per-dollar, because the minimum bid is $1 and a points-per-dollar list is just $1 picks sorted by points. A $1 receiver who ends the year WR4 is a steal; a $47 back who ends it RB44 is not.',
    source: 'valueVsResults() — src/lib/draft-value.ts',
  },
  {
    id: 'priced-finished',
    term: 'Priced / Finished',
    group: 'draft',
    where: 'Spend & Value → Value',
    formula: 'Priced = rank by price among drafted players at that position. Finished = rank by fantasy points among the same players.',
    note: 'Price ranks include everyone bought at the position; finish ranks cover only players with a season on record.',
    source: 'valueVsResults() — src/lib/draft-value.ts',
  },
  {
    id: 'room-benchmark',
    term: 'Room (the benchmark price)',
    group: 'draft',
    where: 'Spend & Value → Value, before the season has been played',
    formula: 'the median price this room paid for the three nearest-ranked players above and below, at the same position',
    note: 'The benchmark is the league’s own bidding, on purpose — no outside auction values, which were stripped from the board so no printed number anchors what people bid. So it can say who paid more than this room did for a comparable player; it cannot say the room was right. If everybody overpaid for running backs, nothing here will find it.',
    source: 'valueVsRoom() — src/lib/stats.ts',
  },
  {
    id: 'within-position',
    term: 'Why every comparison is within a position',
    group: 'draft',
    where: 'Spend & Value → Value',
    formula: 'prices and finishes are only ever ranked against other players at the same position',
    note: 'Compared across positions the measure just rediscovers that this is a superflex league: every top overpay comes out a quarterback and every bargain a receiver. Kickers and defenses are excluded outright.',
    source: 'MARKET_POSITIONS / VALUED_POSITIONS — src/lib/draft.ts, src/lib/draft-value.ts',
  },
  {
    id: 'unscored',
    term: 'Unscored picks',
    group: 'draft',
    where: 'Spend & Value → Value',
    formula: 'picks with no season points, or no pool rank, on record',
    note: 'Left out rather than scored zero. Unknown is not the same as bad, and a zero would rank a player the worst bust in the league on no evidence.',
    source: 'valueVsResults() / valueVsRoom() — src/lib/draft-value.ts, src/lib/stats.ts',
  },
  {
    id: 'draft-dna',
    term: 'Draft DNA',
    group: 'draft',
    where: 'Member page',
    formula: 'one row per auction: position mix, share of budget in the top three buys, $1 picks, halfway pick, and places gained',
    note: 'Top-3 share is the stars-and-scrubs reading — a high number and a pile of $1 picks is a barbell; an even mix is spreading it around.',
    source: 'draftDna() — src/lib/draft-dna.ts',
  },

  // -------------------------------------------------------------------------
  // League history
  // -------------------------------------------------------------------------
  {
    id: 'coverage',
    term: 'Coverage tiers',
    group: 'league',
    where: 'The badge beside every history heading',
    formula: 'legacy = a champion’s name and nothing else · standings = season records, points and money · weekly = everything needing week-by-week data',
    note: 'This is why the 🏆 column reaches further back than the record beside it: rings are counted from the start of the record, and the earliest seasons contribute to no other column. The league’s own spreadsheet puts these eras side by side unlabelled, which is how its records sheet ended up disagreeing with its front page about the all-time high score.',
    source: 'coverageFor() — src/lib/history.ts',
  },
  {
    id: 'unknown',
    term: '—',
    group: 'league',
    where: 'Everywhere',
    formula: 'unknown, which is not the same as zero',
    note: 'A season with no buy-in on record contributes nothing to a net total rather than being treated as free; a player with no points on record is not a bust.',
    source: 'numOrNull() — src/server/history-service.ts',
  },
  {
    id: 'won-net',
    term: 'Won / Net',
    group: 'league',
    where: 'League Summary',
    formula: 'Won = prize money across all placings. Net = prizes − entry fees, over only the seasons with a buy-in on record.',
    note: 'Prize money alone flatters everybody: ten people put in $200 and one takes $1,400, which is one winner and nine losers. Net says so — but only for the seasons it can.',
    source: 'leagueSummary() — src/lib/history.ts',
  },
  {
    id: 'all-play',
    term: 'All-play',
    group: 'league',
    where: 'League Summary · Member page',
    formula: 'each week, your score against every other manager’s — so one week is nine results, not one',
    note: 'Regular season only. A week missing any of the field is skipped rather than half-counted. It is the schedule-luck-free version of a record.',
    source: 'allPlay() — src/lib/history.ts',
  },
  {
    id: 'lineup',
    term: 'Lineup efficiency',
    group: 'league',
    where: 'League Summary · Member page',
    formula: 'points you actually started ÷ points the best legal lineup on your roster would have scored',
    note: 'The optimal lineup is filled most-restrictive slot first, so a flex never steals a player a locked slot needed.',
    source: 'lineupEfficiency() / optimalLineup() — src/lib/history.ts, src/lib/sleeper-history.ts',
  },
  {
    id: 'playoff-scope',
    term: 'What counts as a playoff game',
    group: 'league',
    where: 'League Summary · Records · Member page',
    formula: 'every bracket game except the fifth-place game',
    note: 'Third-place games count. The fifth-place game does not.',
    source: 'isCountedPlayoff() — src/lib/history.ts',
  },
  {
    id: 'h2h-scope',
    term: 'Head to head',
    group: 'league',
    where: 'Head to Head',
    formula: 'each row is that manager’s record against the manager in the column',
    note: 'Regular season only — playoff meetings are not schedule, they are consequence, and folding them in would let one bracket run rewrite a decade of a rivalry.',
    source: 'headToHead() — src/lib/history.ts',
  },
  {
    id: 'best-record',
    term: 'Best / worst record',
    group: 'league',
    where: 'Records',
    formula: 'ranked by win percentage, not by games won',
    note: 'The league has played 13- and 14-week regular seasons, so a raw win count would hand the record to whoever played the longer year.',
    source: 'records() — src/lib/history.ts',
  },
  {
    id: 'consistency',
    term: 'Most consistent / most volatile',
    group: 'league',
    where: 'Records → season review',
    formula: 'the lowest and highest standard deviation of weekly regular-season scores',
    note: 'Needs at least two weeks on record.',
    source: 'stdev() / seasonInReview() — src/lib/history.ts',
  },
  {
    id: 'pickups',
    term: 'Best waiver pickups',
    group: 'league',
    where: 'Records → season review',
    formula: 'players on nobody’s week-1 roster, ranked by points scored while in a starting lineup',
    source: 'getBestPickups() — src/server/history-service.ts',
  },
  {
    id: 'favourite-players',
    term: 'Favourite players',
    group: 'league',
    where: 'Member page',
    formula: 'ranked by weeks started, across every season',
    note: 'Started, not rostered: starting somebody is a decision taken every week, where a roster spot can be inertia. Both columns are shown because the gap between them is the interesting part.',
    source: 'getMostStarted() — src/server/history-service.ts',
  },
]

/** The entries in one group, in declaration order. */
export function glossaryGroup(group: GlossaryGroup): GlossaryEntry[] {
  return GLOSSARY.filter((e) => e.group === group)
}
