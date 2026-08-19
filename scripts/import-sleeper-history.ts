/**
 * Import the Sleeper era (2020–2025) into the history tables.
 *
 *   npm run history:import-sleeper
 *   npm run history:import-sleeper -- --season 2023
 *   npm run history:import-sleeper -- --dry-run
 *
 * Reads only the committed files under `data/sleeper/` — no network — so the
 * import is reproducible, reviewable and offline. All parsing lives in
 * `src/lib/sleeper-history.ts`, which is pure and unit-tested against these same
 * files; this script is the part that talks to Postgres.
 *
 * ## Idempotent, and scoped to the seasons it owns
 *
 * Everything is `INSERT … ON CONFLICT DO UPDATE` on the natural key, so a re-run
 * converges rather than duplicating. Per-season deletes clear rows that no longer
 * exist in the source, and they are scoped to the seasons being imported — never
 * a bare `DELETE FROM`.
 *
 * ## What it refuses to do
 *
 * It touches no table the draft uses. `picks`, `lots`, `budget_adjustments`,
 * `trades` and `players` are untouched, and `manager_totals` is snapshotted before
 * and after and compared — history must never be able to move a live budget.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'
import {
  combinePoints,
  hasBeenPlayed,
  pairWeek,
  playerWeeks,
  playoffRound,
  podiumFromBracket,
  standings,
  startingSlots,
  weekLineups,
  type PlayerMap,
  type RawBracketGame,
  type RawLeague,
  type RawMatchup,
  type RawRoster,
} from '../src/lib/sleeper-history'
import {
  SLEEPER_IMPORT_SEASONS,
  managerIdForName,
  managerIdForSleeperOwner,
  verifyLeagueChain,
} from '../src/lib/history-identity'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const seasonArg = args.indexOf('--season')
const seasons: number[] =
  seasonArg >= 0 ? [Number(args[seasonArg + 1])] : [...SLEEPER_IMPORT_SEASONS]

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set.')
const sql: NeonQueryFunction<false, false> = neon(url)

const ROOT = process.cwd()
const SLEEPER = join(ROOT, 'data', 'sleeper')

const read = <T>(...p: string[]): T => JSON.parse(readFileSync(join(...p), 'utf8')) as T

// ---------------------------------------------------------------------------
// Batched writes. The HTTP driver takes one statement per call, so rows go up in
// multi-row INSERTs rather than one round trip each — ~17k player-weeks would
// otherwise be 17k requests.
// ---------------------------------------------------------------------------

async function insertBatch(table: string, columns: string[], rows: unknown[][], conflict: string) {
  const CHUNK = 400
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const params: unknown[] = []
    const tuples = chunk.map((row) => {
      const placeholders = row.map((v) => {
        params.push(v)
        return `$${params.length}`
      })
      return `(${placeholders.join(',')})`
    })
    await sql.query(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')} ${conflict}`,
      params,
    )
  }
}

const upsert = (keys: string[], cols: string[]) =>
  `ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${cols
    .filter((c) => !keys.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}`

// ---------------------------------------------------------------------------

interface SeasonManifest {
  league_id: string
  previous_league_id: string | null
  files: Record<string, { sha256: string; count: number | null }>
}

function verifyManifest(season: number): SeasonManifest {
  const dir = join(SLEEPER, String(season))
  const manifest = read<SeasonManifest>(dir, 'MANIFEST.json')
  for (const [name, entry] of Object.entries(manifest.files)) {
    const path = join(dir, `${name}.json`)
    if (!existsSync(path)) throw new Error(`${season}: ${name}.json is missing`)
    const digest = createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex')
    if (digest !== entry.sha256) {
      throw new Error(`${season}: ${name}.json does not match the manifest — re-run history:pull`)
    }
  }
  return manifest
}

interface Loaded {
  season: number
  league: RawLeague
  rosters: RawRoster[]
  bracket: RawBracketGame[]
  weeks: Map<number, RawMatchup[]>
  slots: string[]
  playoffStart: number
  /** roster_id -> managers.id */
  owner: Map<number, number>
}

function load(season: number): Loaded {
  const dir = join(SLEEPER, String(season))
  const league = read<RawLeague>(dir, 'league.json')
  const rosters = read<RawRoster[]>(dir, 'rosters.json')
  const bracket = read<RawBracketGame[]>(dir, 'winners_bracket.json')
  const playoffStart = league.settings.playoff_week_start ?? 15
  const slots = startingSlots(league.roster_positions)

  const owner = new Map<number, number>()
  for (const r of rosters) owner.set(r.roster_id, managerIdForSleeperOwner(r.owner_id))
  if (owner.size !== 10) throw new Error(`${season}: expected 10 rosters, got ${owner.size}`)
  if (new Set(owner.values()).size !== 10) {
    throw new Error(`${season}: two rosters resolve to the same manager`)
  }

  const weeks = new Map<number, RawMatchup[]>()
  for (let w = 1; w <= playoffStart + 2; w++) {
    const file = join(dir, `matchups-${String(w).padStart(2, '0')}.json`)
    if (!existsSync(file)) continue
    const entries = read<RawMatchup[]>(file)
    // Skip weeks Sleeper has scheduled but nobody has played yet. See
    // `hasBeenPlayed` — importing them writes a season of 0-0 ties that become
    // the lowest score on record.
    if (entries.length && hasBeenPlayed(entries)) weeks.set(w, entries)
  }

  return { season, league, rosters, bracket, weeks, slots, playoffStart, owner }
}

// ---------------------------------------------------------------------------

interface Reconciliation {
  season: number
  manager: string
  field: string
  ours: number | string
  workbook: number | string
}

/** The workbook's own standings, as an independent check on 2020–2024. */
function workbookStandings(): Map<string, { wins: number; losses: number; pf: number; place: number }> {
  const path = join(ROOT, 'data', 'history', 'regular_season.csv')
  const out = new Map<string, { wins: number; losses: number; pf: number; place: number }>()
  if (!existsSync(path)) return out
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  const header = lines[0].split(',')
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i]])) as Record<string, string>
    const managerId = managerIdForName(row.member)
    out.set(`${row.reg_season_year}:${managerId}`, {
      wins: Number(row.reg_season_wins),
      losses: Number(row.reg_season_losses),
      pf: Number(row.points_for),
      place: Number(row.reg_season_place),
    })
  }
  return out
}

// ---------------------------------------------------------------------------

async function importSeason(data: Loaded, wb: ReturnType<typeof workbookStandings>) {
  const { season, league, rosters, bracket, weeks, slots, playoffStart, owner } = data
  const mgr = (rosterId: number) => owner.get(rosterId)!

  // --- seasons -------------------------------------------------------------
  const podium = podiumFromBracket(bracket)
  const regularWeeks = playoffStart - 1
  await insertBatch(
    'seasons',
    [
      'season', 'data_tier', 'sleeper_league_id', 'roster_size', 'regular_season_weeks',
      'playoff_week_start', 'playoff_teams', 'is_final',
      'champion_manager_id', 'runner_up_manager_id', 'third_manager_id',
    ],
    [[
      season, 'weekly', league.league_id, league.roster_positions.length, regularWeeks,
      playoffStart, league.settings.playoff_teams ?? null,
      // A season is final when Sleeper says it is complete — never asserted.
      // Mid-season this is false, which keeps `draftComplete` and the archive
      // honest about a year still being played.
      league.status === 'complete',
      podium.championRosterId ? mgr(podium.championRosterId) : null,
      podium.runnerUpRosterId ? mgr(podium.runnerUpRosterId) : null,
      podium.thirdRosterId ? mgr(podium.thirdRosterId) : null,
    ]],
    upsert(['season'], [
      'data_tier', 'sleeper_league_id', 'roster_size', 'regular_season_weeks',
      'playoff_week_start', 'playoff_teams', 'is_final',
      'champion_manager_id', 'runner_up_manager_id', 'third_manager_id',
    ]),
  )

  // --- matchups ------------------------------------------------------------
  // Regular season, plus the winners bracket only. The playoff weeks also hold
  // consolation games, which the league has never counted as part of its record.
  // `p` on a bracket game is the place it decides: 1 the final, 3 the
  // third-place game, 5 the fifth-place game. Games without it are on the
  // championship path. Keyed by week and roster so each side can be tagged.
  const bracketPairs = new Map<number, Set<number>>()
  const placementOf = new Map<string, number | null>()
  for (const g of bracket) {
    if (g.t1 == null || g.t2 == null) continue
    const week = playoffStart + (g.r - 1)
    const set = bracketPairs.get(week) ?? new Set<number>()
    set.add(g.t1)
    set.add(g.t2)
    bracketPairs.set(week, set)
    // The final decides first place but is the championship path, not a
    // placement game — only 3rd, 5th and below are consolation-shaped.
    const placement = g.p && g.p > 1 ? g.p : null
    placementOf.set(`${week}:${g.t1}`, placement)
    placementOf.set(`${week}:${g.t2}`, placement)
  }

  const matchupRows: unknown[][] = []
  for (const [week, entries] of [...weeks].sort((a, b) => a[0] - b[0])) {
    const isPlayoffWeek = week >= playoffStart
    for (const side of pairWeek(week, entries)) {
      if (isPlayoffWeek) {
        const inBracket = bracketPairs.get(week)
        if (!inBracket?.has(side.rosterId) || !inBracket.has(side.opponentRosterId)) continue
      }
      matchupRows.push([
        season, week, mgr(side.rosterId), side.matchupId, side.points,
        mgr(side.opponentRosterId), side.opponentPoints,
        isPlayoffWeek, isPlayoffWeek ? playoffRound(week, playoffStart) : null, side.result,
        isPlayoffWeek ? (placementOf.get(`${week}:${side.rosterId}`) ?? null) : null,
      ])
    }
  }

  // --- standings -----------------------------------------------------------
  // Points for and against are Sleeper's own season totals, not a re-sum of the
  // weekly rows. Those two disagree slightly for eight rosters across 2020-21
  // (a stat correction that reached the weekly rows and not the stored total),
  // and the league's decision is to take the platform's published figure — it is
  // what Sleeper shows, and what the history workbook's standings sheet already
  // recorded, so the archive agrees with both.
  //
  // ⚠️ Consequence: summing a manager's `season_matchups.points` will not always
  // equal their `season_standings.points_for`. That is expected and is the
  // source's own inconsistency, not a bug here. Anything comparing the two must
  // pick one and say which.
  const table = standings(rosters)

  const playoffTally = new Map<number, { w: number; l: number }>()
  for (const row of matchupRows) {
    const [, , managerId, , , , , isPlayoff, , result, placement] = row as [
      number, number, number, number, number, number, number, boolean, number | null, string, number | null,
    ]
    // Third place pays, so it counts. Fifth place and below is a game nobody
    // plays seriously, and a playoff record that includes it is not a record.
    if (!isPlayoff || (placement !== null && placement > 3)) continue
    const t = playoffTally.get(managerId) ?? { w: 0, l: 0 }
    if (result === 'W') t.w++
    else if (result === 'L') t.l++
    playoffTally.set(managerId, t)
  }

  const standingRows = table.map((row) => {
    const managerId = mgr(row.rosterId)
    const tally = playoffTally.get(managerId)
    return [
      season, managerId, row.place, row.wins, row.losses, row.ties,
      row.pointsFor, row.pointsAgainst,
      Boolean(tally), tally?.w ?? null, tally?.l ?? null,
    ]
  })

  // --- lineups and player weeks -------------------------------------------
  const players = read<PlayerMap>(SLEEPER, 'players-min.json')
  const lineupRows: unknown[][] = []
  const playerWeekRows: unknown[][] = []
  for (const [week, entries] of weeks) {
    for (const l of weekLineups(entries, slots, players)) {
      lineupRows.push([season, week, mgr(l.rosterId), l.actual, l.optimal])
    }
    for (const p of playerWeeks(week, entries, slots, players)) {
      playerWeekRows.push([
        season, week, mgr(p.rosterId), p.playerId, p.playerName,
        p.position, p.nflTeam, p.isStarter, p.slot, p.points,
      ])
    }
  }

  // --- player seasons ------------------------------------------------------
  const agg = new Map<string, { name: string; pos: string | null; team: string | null; weeks: number; pts: number }>()
  for (const r of playerWeekRows) {
    const [, , , playerId, name, pos, team, , , pts] = r as [
      number, number, number, string, string | null, string | null, string | null, boolean, string | null, number,
    ]
    const cur = agg.get(playerId) ?? { name: name ?? playerId, pos, team, weeks: 0, pts: 0 }
    cur.weeks += 1
    cur.pts += Number(pts)
    agg.set(playerId, cur)
  }
  const playerSeasonRows = [...agg.entries()].map(([playerId, v]) => [
    season, playerId, v.name, v.pos, v.team, v.weeks,
    Number(v.pts.toFixed(2)),
    Number((v.pts / Math.max(v.weeks, 1)).toFixed(2)),
  ])

  if (dryRun) {
    console.log(
      `  ${season}  standings ${standingRows.length} · matchups ${matchupRows.length} · ` +
        `lineups ${lineupRows.length} · player-weeks ${playerWeekRows.length} · players ${playerSeasonRows.length}`,
    )
  } else {
    // Clear only this season, so a re-run after a source change cannot leave
    // orphans behind.
    for (const t of ['player_weeks', 'player_seasons', 'season_lineups', 'season_matchups', 'season_standings']) {
      await sql.query(`DELETE FROM ${t} WHERE season = $1`, [season])
    }
    await insertBatch('season_standings',
      ['season','manager_id','place','wins','losses','ties','points_for','points_against','made_playoffs','playoff_wins','playoff_losses'],
      standingRows, upsert(['season','manager_id'], ['place','wins','losses','ties','points_for','points_against','made_playoffs','playoff_wins','playoff_losses']))
    await insertBatch('season_matchups',
      ['season','week','manager_id','matchup_id','points','opponent_manager_id','opponent_points','is_playoff','playoff_round','result','playoff_placement'],
      matchupRows, upsert(['season','week','manager_id'], ['matchup_id','points','opponent_manager_id','opponent_points','is_playoff','playoff_round','result','playoff_placement']))
    await insertBatch('season_lineups',
      ['season','week','manager_id','actual_points','optimal_points'],
      lineupRows, upsert(['season','week','manager_id'], ['actual_points','optimal_points']))
    await insertBatch('player_weeks',
      ['season','week','manager_id','player_id','player_name','position','nfl_team','is_starter','slot','points'],
      playerWeekRows, upsert(['season','week','manager_id','player_id'], ['player_name','position','nfl_team','is_starter','slot','points']))
    await insertBatch('player_seasons',
      ['season','player_id','player_name','position','nfl_team','weeks_played','total_points','avg_points'],
      playerSeasonRows, upsert(['season','player_id'], ['player_name','position','nfl_team','weeks_played','total_points','avg_points']))
    console.log(
      `  ${season}  ✓ standings ${standingRows.length} · matchups ${matchupRows.length} · ` +
        `lineups ${lineupRows.length} · player-weeks ${playerWeekRows.length} · players ${playerSeasonRows.length}`,
    )
  }

  // --- reconcile against the workbook -------------------------------------
  const problems: Reconciliation[] = []
  for (const row of standingRows) {
    const [, managerId, place, wins, losses, , pf] = row as [number, number, number, number, number, number, number]
    const ref = wb.get(`${season}:${managerId}`)
    if (!ref) continue
    if (ref.wins !== wins || ref.losses !== losses) {
      problems.push({ season, manager: String(managerId), field: 'record', ours: `${wins}-${losses}`, workbook: `${ref.wins}-${ref.losses}` })
    }
    if (ref.place !== place) {
      problems.push({ season, manager: String(managerId), field: 'place', ours: place, workbook: ref.place })
    }
    if (Math.abs(ref.pf - Number(pf)) > 0.011) {
      problems.push({ season, manager: String(managerId), field: 'points_for', ours: Number(pf), workbook: ref.pf })
    }
  }
  return problems
}

// ---------------------------------------------------------------------------

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nImporting Sleeper seasons ${seasons.join(', ')} into "${dbName}"${dryRun ? ' (dry run)' : ''}\n`)

  const totalsBefore = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`

  const chain: Record<number, { league_id: string; previous_league_id: string | null }> = {}
  const loaded: Loaded[] = []
  for (const season of seasons) {
    const manifest = verifyManifest(season)
    chain[season] = { league_id: manifest.league_id, previous_league_id: manifest.previous_league_id }
    loaded.push(load(season))
  }
  if (seasons.length > 1) verifyLeagueChain(chain)
  console.log('  ✓ manifests verified, league chain intact\n')

  const wb = workbookStandings()
  const problems: Reconciliation[] = []
  for (const data of loaded) problems.push(...(await importSeason(data, wb)))

  // --- the assertion that matters -----------------------------------------
  const totalsAfter = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`
  if (JSON.stringify(totalsBefore) !== JSON.stringify(totalsAfter)) {
    console.error('\n✗ manager_totals changed. History must never touch a live budget.')
    process.exit(1)
  }

  console.log('\n  Reconciliation against the workbook (2020–2024):')
  if (problems.length === 0) {
    console.log('  ✓ every record, place and points-for agrees\n')
  } else {
    console.table(problems)
    const hard = problems.filter((p) => p.field !== 'points_for')
    console.log(`  ${problems.length} difference(s); ${hard.length} in record or place.\n`)
    if (hard.length) {
      console.error('✗ A record or place disagrees. That is not rounding — stopping.')
      process.exit(1)
    }
  }

  if (!dryRun) {
    const summary = await sql`
      SELECT s.season, s.data_tier,
             (SELECT count(*)::int FROM season_standings x WHERE x.season = s.season) AS standings,
             (SELECT count(*)::int FROM season_matchups  x WHERE x.season = s.season) AS matchups,
             (SELECT count(*)::int FROM season_lineups   x WHERE x.season = s.season) AS lineups,
             (SELECT count(*)::int FROM player_weeks     x WHERE x.season = s.season) AS player_weeks
        FROM seasons s ORDER BY s.season`
    console.table(summary)
  }
  console.log('✓ Sleeper era imported. manager_totals unchanged.\n')
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
