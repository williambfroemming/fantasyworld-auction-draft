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
    note: 'Each roster spot still to fill keeps $1 in reserve, which is why the opening max is $185, not $200.',
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
    note: 'Full rosters are skipped, so the seat on the clock can be several places past a simple round count.',
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
    note: 'Kickers and defenses are left out: at a dollar or two they drag every figure down. The Teams table keeps them as OTHER so each row adds up.',
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
    note: 'A trade moves the player, not the salary, so the money stays with the buyer.',
    source: 'draftersByPick() — src/lib/stats.ts',
  },
  {
    id: 'team-spend',
    term: 'Spend by team',
    group: 'draft',
    where: 'Spend & Value → Teams',
    formula: 'each manager’s auction spend, split QB / RB / WR / TE / OTHER',
    note: 'OTHER is kickers and defenses, kept so each row totals what that manager spent.',
    source: 'teamSpend() — src/lib/stats.ts',
  },
  {
    id: 'drift',
    term: 'adj',
    group: 'draft',
    where: 'Spend & Value → Teams',
    formula: 'starting budget − (spent + money left)',
    note: 'Should be zero. Anything else is trade cash or a commissioner correction.',
    source: 'TeamSpendRow.drift — src/lib/stats.ts',
  },
  {
    id: 'market-pace',
    term: 'Average price per block of picks',
    group: 'draft',
    where: 'Spend & Value → Pace',
    formula: 'picks bucketed two full rounds at a time; the total, mean, median and top price in each',
    source: 'spendBlocks() — src/lib/stats.ts',
  },
  {
    id: 'vs-room',
    term: 'vs room median',
    group: 'draft',
    where: 'Spend & Value → Pace',
    formula: 'your $/slot − the median $/slot of every manager who can still bid',
    note: 'Positive means more money per open spot than the room. Full rosters are left out of the median, since they cannot bid.',
    source: 'managerPace() — src/lib/stats.ts',
  },
  {
    id: 'spend-curve',
    term: 'Spend curve',
    group: 'draft',
    where: 'Spend & Value → Curve',
    formula: 'a running total of dollars spent, by pick number',
    note: 'The straight line is an even pace. Every panel shares the same axes.',
    source: 'spendCurve() — src/lib/stats.ts',
  },
  {
    id: 'halfway-pick',
    term: '½ (halfway pick)',
    group: 'draft',
    where: 'Spend & Value → Curve · Member page → Draft DNA',
    formula: 'the first pick at which a manager had spent half of their eventual total',
    note: 'Early is stars-and-scrubs; late is spreading it around. Member pages show it as a share of the draft.',
    source: 'ManagerCurve.halfwayPick — src/lib/stats.ts',
  },
  {
    id: 'nominations',
    term: 'Nominations, won and win %',
    group: 'draft',
    where: 'Spend & Value → Nominations',
    formula: 'players you put up; how many you ended up buying; won ÷ put up',
    note: 'A low win rate is not necessarily bad: nominating players you do not want drains rivals’ budgets. Credit goes to the buyer on the night.',
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
    note: 'Positive beat their price. Ranks, not points per dollar, or every $1 pick would top the list.',
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
    note: 'The benchmark is this room’s own bidding, not outside auction values. It shows who paid more than the room did for a comparable player, not whether the room was right.',
    source: 'valueVsRoom() — src/lib/stats.ts',
  },
  {
    id: 'within-position',
    term: 'Why every comparison is within a position',
    group: 'draft',
    where: 'Spend & Value → Value',
    formula: 'prices and finishes are only ever ranked against other players at the same position',
    note: 'Across positions every top overpay is a quarterback, which says superflex, not value. Kickers and defenses are excluded.',
    source: 'MARKET_POSITIONS / VALUED_POSITIONS — src/lib/draft.ts, src/lib/draft-value.ts',
  },
  {
    id: 'unscored',
    term: 'Unscored picks',
    group: 'draft',
    where: 'Spend & Value → Value',
    formula: 'picks with no season points, or no pool rank, on record',
    note: 'Left out rather than scored zero: unknown is not the same as bad.',
    source: 'valueVsResults() / valueVsRoom() — src/lib/draft-value.ts, src/lib/stats.ts',
  },
  {
    id: 'draft-dna',
    term: 'Draft DNA',
    group: 'draft',
    where: 'Member page',
    formula: 'one row per auction: position mix, share of budget in the top three buys, $1 picks, halfway pick, and places gained',
    note: 'A high top-3 share with a pile of $1 picks is stars-and-scrubs; an even mix is spreading it around.',
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
    note: 'Why the 🏆 column reaches further back than the rest: titles are counted from the start of the record, and the earliest seasons have nothing else.',
    source: 'coverageFor() — src/lib/history.ts',
  },
  {
    id: 'oracle',
    term: 'Ask the Oracle',
    group: 'league',
    where: 'League History · Ask the Oracle',
    formula: 'a language model writes one SQL query at a time against read-only views of the league record, then answers from the rows that come back',
    note: 'Player scores count only weeks rostered in this league, since 2020. The SQL and rows are shown under every answer.',
    source: 'askOracle() — src/server/oracle-service.ts',
  },
  {
    id: 'unknown',
    term: '—',
    group: 'league',
    where: 'Everywhere',
    formula: 'unknown, which is not the same as zero',
    note: 'A season with no buy-in on record adds nothing to Net; a player with no points on record is not a bust.',
    source: 'numOrNull() — src/server/history-service.ts',
  },
  {
    id: 'won-net',
    term: 'Won / Net',
    group: 'league',
    where: 'League Summary',
    formula: 'Won = prize money across all placings. Net = prizes − entry fees, over only the seasons with a buy-in on record.',
    note: 'Prize money alone flatters everyone: ten people pay in and one takes most of it out. Net shows that, for the seasons it can.',
    source: 'leagueSummary() — src/lib/history.ts',
  },
  {
    id: 'all-play',
    term: 'All-play',
    group: 'league',
    where: 'League Summary · Member page',
    formula: 'each week, your score against every other manager’s — so one week is nine results, not one',
    note: 'Regular season only. Weeks missing part of the field are skipped. A record without schedule luck.',
    source: 'allPlay() — src/lib/history.ts',
  },
  {
    id: 'lineup',
    term: 'Lineup efficiency',
    group: 'league',
    where: 'League Summary · Member page',
    formula: 'points you actually started ÷ points the best legal lineup on your roster would have scored',
    note: 'Regular season only, since eliminated teams stop setting lineups. Judged with hindsight.',
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
    note: 'Regular season only, so one playoff run cannot rewrite a rivalry.',
    source: 'headToHead() — src/lib/history.ts',
  },
  {
    id: 'record-by-week',
    term: 'Record by week',
    group: 'league',
    where: 'Record by Week, Playoff odds',
    formula: 'for every finished season since weekly records began: each team’s record after each regular-season week, and whether that team made the playoffs',
    note: 'Counts, not percentages, because most cells hold a handful of teams; under three is greyed. The current season is marked but not counted, and a team that ties drops out from that week on.',
    source: 'recordPaths() — src/lib/record-paths.ts',
  },
  {
    id: 'playoff-odds',
    term: 'Playoff odds',
    group: 'league',
    where: 'Front page',
    formula: 'the rest of the regular season simulated 10,000 times against the real schedule; seeded by wins, then points for',
    note: 'Each team scores around its average so far, pulled toward the league average early on. Rem SOS is the expected weekly score of opponents still to play. The median game does not affect seeding. Never shown as 100% or 0% while a game remains.',
    source: 'playoffOdds() — src/lib/playoff-odds.ts',
  },
  {
    id: 'title-odds',
    term: 'Title odds',
    group: 'league',
    where: 'Front page · Playoff odds',
    formula: 'the same simulations, each one seeded and then played through the bracket: six teams, the top two on a bye, 1 against the winner of 4 v 5 and 2 against the winner of 3 v 6',
    note: 'A fixed bracket, not re-seeded, as Sleeper runs it. Never 100% or 0% while a game remains.',
    source: 'playoffOdds() — src/lib/playoff-odds.ts',
  },
  {
    id: 'odds-leverage',
    term: 'If win / lose',
    group: 'league',
    where: 'Front page · Playoff odds',
    formula: 'playoff odds among the simulations where the team won its next game, and among those where it lost it',
    note: 'The gap is what the game is worth. It slightly overstates it, since a win is also evidence a team is good.',
    source: 'playoffOdds() — src/lib/playoff-odds.ts',
  },
  {
    id: 'seed-strip',
    term: 'Seed strip',
    group: 'league',
    where: 'Front page · Playoff odds',
    formula: 'ten cells, first seed to last, each shaded by the share of simulations the team finished there',
    note: 'Amber cells are playoff seeds; an outline marks a bye. Hover for exact shares.',
    source: 'playoffOdds() — src/lib/playoff-odds.ts',
  },
  {
    id: 'roster-origin',
    term: 'How the roster was built',
    group: 'league',
    where: 'Records \u00b7 Member page',
    formula: 'each manager\u2019s STARTED points, split by where the player came from: bought at that season\u2019s auction, traded for at the draft, or added later',
    note: 'Drafted: bought at that auction and still held. Traded: acquired at the draft, recorded only since this app ran it. Added later: waivers, free agency, or nobody’s auction pick. Unknown: an auction pick with no player id. Regular season, 2021 on.',
    source: 'rosterOrigin() \u2014 src/lib/roster-origin.ts',
  },
  {
    id: 'strength-rating',
    term: 'Strength rating',
    group: 'league',
    where: 'Ratings \u00b7 Member page',
    formula: 'an Elo rating: everyone starts at 1500; after each game, rating moves by 20 \u00d7 margin factor \u00d7 (result \u2212 expected result), where expected comes from the rating gap',
    note: 'An estimate of how strong a team has looked; it changes no real record. Beating a stronger team, or winning big, moves it more. Ratings drift a third of the way back to 1500 each offseason. Includes counted playoff games, 2020 on.',
    source: 'ratingHistory() \u2014 src/lib/rating.ts',
  },
  {
    id: 'positional-scorecard',
    term: 'Points by position',
    group: 'league',
    where: 'Front page · Member page',
    formula: 'for each manager and position: the points their STARTERS scored there, minus the average of every manager\u2019s starters at that position',
    note: 'Grouped by the player’s position, not lineup slot. Regular season, 2020 on. Each column sums to zero across the league; a dash means the position was not played.',
    source: 'positionalScorecard() \u2014 src/lib/positional.ts',
  },
  {
    id: 'best-record',
    term: 'Best / worst record',
    group: 'league',
    where: 'Records',
    formula: 'ranked by win percentage, not by games won',
    note: 'Seasons have been 13 and 14 weeks, so raw wins would favour the longer year.',
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
    note: 'Started, not rostered: starting someone is a decision made every week.',
    source: 'getMostStarted() — src/server/history-service.ts',
  },
]

/** The entries in one group, in declaration order. */
export function glossaryGroup(group: GlossaryGroup): GlossaryEntry[] {
  return GLOSSARY.filter((e) => e.group === group)
}
