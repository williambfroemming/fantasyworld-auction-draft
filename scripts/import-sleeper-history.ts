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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { flattenTransactions, type RawTransaction } from '../src/lib/transactions'
import {
  combinePoints,
  isScoredWeek,
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
import { STAT_KEYS, statRows, type RawStatsWeek } from '../src/lib/player-stats'

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

/** Whether `db:migrate-player-stats` has run here. */
async function hasStatsTable(): Promise<boolean> {
  const [{ exists }] = await sql`SELECT to_regclass('player_week_stats') IS NOT NULL AS exists`
  return Boolean(exists)
}

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
  /**
   * Every regular-season week Sleeper has published, played or not — the
   * pairings only. See `season_schedule`: an unplayed week is a schedule, never
   * a result, so it lives here and not in `weeks`.
   */
  schedule: Map<number, RawMatchup[]>
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
  const schedule = new Map<number, RawMatchup[]>()
  for (let w = 1; w <= playoffStart + 2; w++) {
    const file = join(dir, `matchups-${String(w).padStart(2, '0')}.json`)
    if (!existsSync(file)) continue
    const entries = read<RawMatchup[]>(file)
    if (entries.length && w < playoffStart) schedule.set(w, entries)
    // Skip weeks nobody has played yet, and the week still in progress. See
    // `isScoredWeek` — the first writes a season of 0-0 ties, the second a
    // half-played week counted as a whole one.
    if (isScoredWeek(w, entries, league.settings.last_scored_leg)) weeks.set(w, entries)
  }

  return { season, league, rosters, bracket, weeks, schedule, slots, playoffStart, owner }
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
  const { season, league, rosters, bracket, weeks, schedule, slots, playoffStart, owner } = data
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

  // --- schedule ------------------------------------------------------------
  // Pairings only, for every regular-season week Sleeper has published. The
  // points on an unplayed week are zeros and are never read from here.
  const scheduleRows: unknown[][] = []
  for (const [week, entries] of [...schedule].sort((a, b) => a[0] - b[0])) {
    for (const side of pairWeek(week, entries)) {
      scheduleRows.push([season, week, mgr(side.rosterId), mgr(side.opponentRosterId)])
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

  // --- transactions ----------------------------------------------------------
  // One row per player movement, failed claims included. `null` means the season has no
  // transaction files on disk (pull with `history:pull -- --transactions-only`); in that case
  // the table is left alone rather than emptied.
  const seasonDir = join(SLEEPER, String(season))
  const txFiles = readdirSync(seasonDir)
    .filter((f) => /^transactions-\d+\.json$/.test(f))
    .sort()
  const txRows =
    txFiles.length === 0
      ? null
      : flattenTransactions(
          season,
          txFiles.flatMap((f) => read<RawTransaction[]>(seasonDir, f)),
          owner,
          players,
        )
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

  // --- player stat lines --------------------------------------------------
  // Same weeks and same rostered ids as `player_weeks`, so every stat row has a
  // player-week to join to. A season pulled before the stats existed has no
  // stats files and simply yields no rows.
  const statRowsOut: unknown[][] = []
  for (const [week, entries] of weeks) {
    const file = join(SLEEPER, String(season), `stats-${String(week).padStart(2, '0')}.json`)
    if (!existsSync(file)) continue
    const rostered = entries.flatMap((e) => [...(e.players ?? []), ...(e.starters ?? [])])
    for (const r of statRows(season, week, read<RawStatsWeek>(file), rostered)) {
      statRowsOut.push([r.season, r.week, r.playerId, r.gp, ...STAT_KEYS.map((k) => r.stats[k])])
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
      `  ${season}  schedule ${scheduleRows.length} · standings ${standingRows.length} · matchups ${matchupRows.length} · ` +
        `lineups ${lineupRows.length} · player-weeks ${playerWeekRows.length} · players ${playerSeasonRows.length} · ` +
        `stat lines ${statRowsOut.length}` +
        (txRows ? ` · transactions ${txRows.length}` : ''),
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
    // Guarded rather than assumed: the weekly job must not fail on a database
    // that has not had `db:migrate-schedule` yet. Without the table the front
    // page shows no odds, which is the honest state for a missing schedule.
    const [{ exists }] = await sql`SELECT to_regclass('season_schedule') IS NOT NULL AS exists`
    if (exists) {
      await sql.query('DELETE FROM season_schedule WHERE season = $1', [season])
      await insertBatch('season_schedule',
        ['season','week','manager_id','opponent_manager_id'],
        scheduleRows, upsert(['season','week','manager_id'], ['opponent_manager_id']))
    } else {
      console.warn(`  ${season}  ⚠ season_schedule missing — run npm run db:migrate-schedule. Schedule skipped.`)
    }
    // Guarded like the schedule: the weekly job must not fail on a database that has not had
    // `db:migrate-transactions` yet. Delete and insert go up as ONE atomic batch, so a failure
    // halfway leaves last week's rows, not half of this week's.
    const [{ tx_exists: txTable }] = await sql`SELECT to_regclass('season_transactions') IS NOT NULL AS tx_exists`
    if (txRows && txTable) {
      const cols = ['season','week','transaction_id','line','type','status','manager_id',
        'counterparty_manager_id','player_id_added','player_id_dropped','added_name','added_position',
        'dropped_name','dropped_position','faab_bid','faab_transferred','note','created_at']
      const values = txRows.map((r) => [r.season, r.week, r.transactionId, r.line, r.type, r.status,
        r.managerId, r.counterpartyManagerId, r.playerIdAdded, r.playerIdDropped, r.addedName,
        r.addedPosition, r.droppedName, r.droppedPosition, r.faabBid, r.faabTransferred, r.note, r.createdAt])
      const statements = [sql.query('DELETE FROM season_transactions WHERE season = $1', [season])]
      const CHUNK = 400
      for (let i = 0; i < values.length; i += CHUNK) {
        const params: unknown[] = []
        const tuples = values.slice(i, i + CHUNK).map((row) => `(${row.map((v) => { params.push(v); return `$${params.length}` }).join(',')})`)
        statements.push(sql.query(`INSERT INTO season_transactions (${cols.join(',')}) VALUES ${tuples.join(',')}`, params))
      }
      await sql.transaction(statements)
    } else if (txRows) {
      console.warn(`  ${season}  ⚠ season_transactions missing — run npm run db:migrate-transactions. Transactions skipped.`)
    }
    // Guarded the same way, for the same reason: `db:migrate-player-stats`.
    //
    // Delete and insert in ONE statement, so a failure part-way can never leave
    // a season with no stat lines — the HTTP driver has no transactions, and a
    // DELETE followed by chunked INSERTs could. ~2,800 rows x 32 columns is over
    // Postgres's 65,535-parameter limit for a VALUES list, so the rows go up as
    // one JSON parameter and are unpacked server-side.
    if (await hasStatsTable()) {
      const cols = ['season', 'week', 'player_id', 'gp', ...STAT_KEYS]
      const types = ['integer', 'integer', 'text', 'integer', ...STAT_KEYS.map(() => 'numeric(8,2)')]
      const payload = statRowsOut.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])))
      await sql.query(
        `WITH gone AS (DELETE FROM player_week_stats WHERE season = $1)
         INSERT INTO player_week_stats (${cols.join(', ')})
         SELECT ${cols.join(', ')}
           FROM jsonb_to_recordset($2::jsonb) AS r(${cols.map((c, i) => `${c} ${types[i]}`).join(', ')})`,
        [season, JSON.stringify(payload)],
      )
    } else {
      console.warn(`  ${season}  ⚠ player_week_stats missing — run npm run db:migrate-player-stats. Stats skipped.`)
    }
    console.log(
      `  ${season}  ✓ schedule ${scheduleRows.length} · standings ${standingRows.length} · matchups ${matchupRows.length} · ` +
        `lineups ${lineupRows.length} · player-weeks ${playerWeekRows.length} · players ${playerSeasonRows.length} · ` +
        `stat lines ${statRowsOut.length}` +
        (txRows ? ` · transactions ${txRows.length}` : ''),
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
    if (await hasStatsTable()) {
      const lines = await sql`SELECT season, count(*)::int AS n FROM player_week_stats GROUP BY season`
      const bySeason = new Map(lines.map((r) => [Number(r.season), Number(r.n)]))
      for (const row of summary) row.stat_lines = bySeason.get(Number(row.season)) ?? 0
    }
    console.table(summary)
  }
  console.log('✓ Sleeper era imported. manager_totals unchanged.\n')
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
