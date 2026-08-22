/**
 * The FantasyWorld Gazette — the database half.
 *
 * The thin one of the pair: everything that *computes* anything lives in
 * `src/lib/gazette.ts`, which is pure and unit-tested. This file runs queries and
 * converts types at the boundary, exactly as `history-service.ts` does.
 *
 * ⚠️ Nothing here may call a model. Generation happens in
 * `scripts/history/gazette.ts` and nowhere else, because `/history/gazette` is a
 * Server Component and this app's first rule is that nothing on a request path
 * makes an outbound call.
 *
 * `gazette.test.ts` enforces that by reading this file as text and asserting it
 * performs no outbound request and never names the model provider — which is
 * also why this note describes those strings rather than quoting them. A comment
 * that spells out the forbidden token fails the check it is documenting.
 */
import { getSql } from './sql'
import { getHistoryInput } from './history-service'
import { draftersByPick, type StatsTrade } from '@/lib/stats'
import {
  genreFor,
  seasonPreview,
  weekInReview,
  type GazetteFacts,
  type GazetteInput,
  type GazettePlayerWeek,
  type PreviewFacts,
  type PreviewPick,
  type PriorIssue,
  type Thread,
} from '@/lib/gazette'

/** `numeric` arrives from Neon as a string; null stays null. */
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

export interface StoredIssue {
  season: number
  week: number
  headline: string
  issueTitle: string | null
  lens: string | null
  deck: string
  columnText: string
  gameNotes: string[]
  threads: Thread[]
  /**
   * The pack as of press time. A week edition stores a `GazetteFacts`; the
   * season preview stores a `PreviewFacts`. Discriminate with `isPreview()` —
   * never on `kind === 'week'`, which is absent from the back catalogue.
   */
  facts: GazetteFacts | PreviewFacts
  model: string
  promptVersion: number
  generatedAt: string
}

/**
 * Every rostered player's line for weeks 1..`week` of a season.
 *
 * The whole season to date rather than one week, because a candidate that judges
 * a performance against a player's own form has to compute that form from the
 * weeks *before* the one being written about. `player_seasons.avg_points` is the
 * final season average and would quietly grade a week-7 explosion on games that
 * had not been played yet.
 */
async function getPlayersToDate(season: number, week: number): Promise<GazettePlayerWeek[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT season, week, manager_id, player_id, player_name, position, nfl_team,
           is_starter, slot, points
      FROM player_weeks
     WHERE season = ${season} AND week <= ${week}
     ORDER BY week, points DESC`
  return rows.map(
    (r): GazettePlayerWeek => ({
      season: Number(r.season),
      week: Number(r.week),
      managerId: Number(r.manager_id),
      playerId: String(r.player_id),
      player: str(r.player_name),
      position: str(r.position),
      nflTeam: str(r.nfl_team),
      isStarter: Boolean(r.is_starter),
      slot: str(r.slot),
      points: num(r.points),
    }),
  )
}

/**
 * Published issues of a season before `week`, oldest first.
 *
 * The belt holder and the stat ids already used both come off each issue's own
 * stored `facts` rather than columns of their own. The pack is already the record
 * of what that issue knew; a second copy is a second thing to keep in sync.
 */
export async function getPriorIssues(
  season: number,
  week: number,
  nameToId: Map<string, number>,
): Promise<PriorIssue[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT season, week, headline, lens, column_text, threads, facts
      FROM week_issues
     WHERE season = ${season} AND week < ${week}
     ORDER BY week`
  return rows.map((r): PriorIssue => {
    const facts = r.facts as GazetteFacts | null
    const holder = facts?.belt?.manager ?? null
    return {
      season: Number(r.season),
      week: Number(r.week),
      headline: String(r.headline),
      lens: str(r.lens),
      columnText: String(r.column_text),
      threads: (r.threads as Thread[]) ?? [],
      beltManagerId: holder === null ? null : (nameToId.get(holder) ?? null),
      statIds: facts?.stats?.map((s) => s.id) ?? [],
    }
  })
}

/**
 * The fact pack for one week, as of that week.
 *
 * Returns null when the week has no games — the normal state most of the year.
 */
export async function getWeekFacts(season: number, week: number): Promise<GazetteFacts | null> {
  const sql = getSql()
  const [history, playersToDate, rate] = await Promise.all([
    getHistoryInput(),
    getPlayersToDate(season, week),
    sql`SELECT side_bet FROM seasons WHERE season = ${season}`,
  ])
  const nameToId = new Map(history.members.map((m) => [m.displayName, m.managerId]))
  const priorIssues = await getPriorIssues(season, week, nameToId)

  const input: GazetteInput = {
    season,
    week,
    history,
    playersToDate,
    priorIssues,
    // Null is unknown, never zero. Most seasons predate the side bet.
    sideBet: rate[0]?.side_bet === null || rate[0]?.side_bet === undefined ? null : Number(rate[0].side_bet),
  }
  return weekInReview(input)
}

// ---------------------------------------------------------------------------
// The season preview
// ---------------------------------------------------------------------------

/**
 * Every auction pick on record, with the columns a preview needs.
 *
 * All seasons, not just the one being previewed: spotting that a man has bought
 * the same player three years running is the best material in the pack, and it
 * is only answerable across the whole archive.
 *
 * Snapshot columns only — never a join to `players`, which is re-imported every
 * August and would put this year's team on a 2021 pick.
 */
async function getPreviewPicks(): Promise<PreviewPick[]> {
  const sql = getSql()
  const [rows, tradeRows] = await Promise.all([
    sql`
      SELECT id, season, pick_no, manager_id, nominator_id, price,
             player_name, player_position, player_team, player_rank, player_sleeper_id
        FROM picks ORDER BY season, pick_no`,
    sql`
      SELECT id, created_at, manager_a_id, manager_b_id, picks_a_to_b, picks_b_to_a
        FROM trades ORDER BY created_at`,
  ])

  // A trade moves `picks.manager_id` but not the salary, so every dollar below
  // is attributed to whoever actually bought the player. With no trades on
  // record this resolves to the current owner, which is the normal state for a
  // preview filed days after the auction.
  const trades: StatsTrade[] = tradeRows.map((t) => ({
    id: Number(t.id),
    createdAt: String(t.created_at),
    managerAId: Number(t.manager_a_id),
    managerBId: Number(t.manager_b_id),
    players: [
      ...((t.picks_a_to_b as number[]) ?? []).map((pickId) => ({
        pickId: Number(pickId),
        toManagerId: Number(t.manager_b_id),
      })),
      ...((t.picks_b_to_a as number[]) ?? []).map((pickId) => ({
        pickId: Number(pickId),
        toManagerId: Number(t.manager_a_id),
      })),
    ],
  }))

  const drafter = draftersByPick(
    rows.map((r) => ({ id: Number(r.id), managerId: Number(r.manager_id) })),
    trades,
  )

  return rows.map((r): PreviewPick => {
    const id = Number(r.id)
    return {
      id,
      season: Number(r.season),
      pickNo: Number(r.pick_no),
      managerId: Number(r.manager_id),
      drafter: drafter.get(id) ?? Number(r.manager_id),
      nominatorId: r.nominator_id === null ? null : Number(r.nominator_id),
      price: num(r.price),
      player: String(r.player_name),
      position: String(r.player_position),
      nflTeam: str(r.player_team),
      // Null is unranked, never zero. See the column comment on `picks`.
      rank: r.player_rank === null || r.player_rank === undefined ? null : Number(r.player_rank),
      sleeperId: str(r.player_sleeper_id),
    }
  })
}

/**
 * The closing issues of the season before this one.
 *
 * Continuity across a New Year: `getPriorIssues` is same-season by design, so a
 * preview asking it for week zero of 2026 would get nothing and Gordon would
 * open the year with an empty notebook — losing every thread the last edition
 * of the old season left him owed.
 */
async function getPreviousSeasonIssues(
  season: number,
  nameToId: Map<string, number>,
): Promise<PriorIssue[]> {
  const sql = getSql()
  const [prev] = await sql`
    SELECT max(season)::int AS season FROM week_issues WHERE season < ${season}`
  if (prev?.season === null || prev?.season === undefined) return []
  // Past the end of any season, so every issue of it comes back. A literal
  // rather than MAX_SAFE_INTEGER, which overflows the `integer` week column and
  // fails in the driver rather than reading as "no bound".
  return getPriorIssues(Number(prev.season), 999, nameToId)
}

/**
 * The fact pack for a season preview, as of the end of the auction.
 *
 * Returns null when the season has no picks — which is every season before its
 * draft, and a quiet no-op rather than an empty issue.
 */
export async function getPreviewFacts(season: number): Promise<PreviewFacts | null> {
  const sql = getSql()
  const [history, picks, config] = await Promise.all([
    getHistoryInput(),
    getPreviewPicks(),
    // `seasons` carries the archived settings and `draft` the live ones, so a
    // preview works both for the season currently on the board and for a
    // backfilled one whose draft row has long since moved on.
    sql`
      SELECT COALESCE(s.roster_size, d.roster_size) AS roster_size,
             COALESCE(s.starting_budget, d.starting_budget) AS starting_budget,
             s.side_bet
        FROM draft d LEFT JOIN seasons s ON s.season = ${season}
       WHERE d.id = 1`,
  ])

  const nameToId = new Map(history.members.map((m) => [m.displayName, m.managerId]))
  const priorIssues = await getPreviousSeasonIssues(season, nameToId)

  return seasonPreview({
    season,
    history,
    picks,
    rosterSize: Number(config[0]?.roster_size ?? 16),
    budget: Number(config[0]?.starting_budget ?? 200),
    // Null is unknown, never "no bet".
    sideBet:
      config[0]?.side_bet === null || config[0]?.side_bet === undefined
        ? null
        : Number(config[0].side_bet),
    // Week zero has no entry in the house calendar, and should not: the preview's
    // frame is fixed by its own prompt rather than by the rotation.
    genre: genreFor(season, 0),
    priorIssues,
  })
}

// ---------------------------------------------------------------------------
// The read side, for the page
// ---------------------------------------------------------------------------

function toIssue(r: Record<string, unknown>): StoredIssue {
  return {
    season: Number(r.season),
    week: Number(r.week),
    headline: String(r.headline),
    issueTitle: r.issue_title === null || r.issue_title === undefined ? null : String(r.issue_title),
    lens: r.lens === null || r.lens === undefined ? null : String(r.lens),
    deck: String(r.deck),
    columnText: String(r.column_text),
    gameNotes: (r.game_notes as string[]) ?? [],
    threads: (r.threads as Thread[]) ?? [],
    facts: r.facts as GazetteFacts | PreviewFacts,
    model: String(r.model),
    promptVersion: Number(r.prompt_version),
    generatedAt: String(r.generated_at),
  }
}

export async function getLatestIssue(): Promise<StoredIssue | null> {
  const sql = getSql()
  const rows = await sql`
    SELECT season, week, headline, issue_title, lens, deck, column_text, game_notes, threads,
           facts, model, prompt_version, generated_at
      FROM week_issues ORDER BY season DESC, week DESC LIMIT 1`
  return rows[0] ? toIssue(rows[0]) : null
}

export async function getIssue(season: number, week: number): Promise<StoredIssue | null> {
  const sql = getSql()
  const rows = await sql`
    SELECT season, week, headline, issue_title, lens, deck, column_text, game_notes, threads,
           facts, model, prompt_version, generated_at
      FROM week_issues WHERE season = ${season} AND week = ${week}`
  return rows[0] ? toIssue(rows[0]) : null
}

/** Every issue on record, newest first. Headline and dateline only. */
export async function listIssues(): Promise<
  Array<{ season: number; week: number; headline: string; deck: string; weekLabel: string }>
> {
  const sql = getSql()
  const rows = await sql`
    SELECT season, week, headline, deck, facts->>'weekLabel' AS week_label
      FROM week_issues ORDER BY season DESC, week DESC`
  return rows.map((r) => ({
    season: Number(r.season),
    week: Number(r.week),
    headline: String(r.headline),
    issueTitle: r.issue_title === null || r.issue_title === undefined ? null : String(r.issue_title),
    lens: r.lens === null || r.lens === undefined ? null : String(r.lens),
    deck: String(r.deck),
    weekLabel: String(r.week_label ?? `Week ${r.week}`),
  }))
}

/** The issues either side of this one, for the footer links. */
export async function getAdjacentIssues(
  season: number,
  week: number,
): Promise<{ prev: { season: number; week: number } | null; next: { season: number; week: number } | null }> {
  const sql = getSql()
  const [prev, next] = await Promise.all([
    sql`SELECT season, week FROM week_issues
         WHERE (season, week) < (${season}, ${week})
         ORDER BY season DESC, week DESC LIMIT 1`,
    sql`SELECT season, week FROM week_issues
         WHERE (season, week) > (${season}, ${week})
         ORDER BY season, week LIMIT 1`,
  ])
  return {
    prev: prev[0] ? { season: Number(prev[0].season), week: Number(prev[0].week) } : null,
    next: next[0] ? { season: Number(next[0].season), week: Number(next[0].week) } : null,
  }
}
