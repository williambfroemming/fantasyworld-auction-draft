/**
 * Import the pre-Sleeper era and the league facts Sleeper cannot know.
 *
 *   npm run history:import-workbook
 *   npm run history:import-workbook -- --dry-run
 *
 * Reads only the committed CSVs under `data/history/`. What comes from here:
 *
 *  - **2011–2019 standings** — the only grain that exists for those years, and
 *    therefore the entire factual base of the "All-Time" era.
 *  - **2006–2010 champions** — a name and nothing else. Deliberately not linked
 *    to `managers`: those years predate the league's membership record, and
 *    asserting the 2006 "Daniel" is today's Daniel is a guess dressed as a fact.
 *  - **The podium and its prize money, 2011–2024.** Money is a league fact that
 *    exists nowhere in the API.
 *  - **Draft locations, 2010–2025.** Likewise.
 *
 * It runs *after* `history:import-sleeper` and is careful not to undo it: the
 * podium for 2020+ was derived from Sleeper's bracket and verified against this
 * same workbook, so those columns are filled with COALESCE rather than
 * overwritten.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { managerIdForMemberId, managerIdForName } from '../src/lib/history-identity'

const dryRun = process.argv.includes('--dry-run')
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set.')
const sql: NeonQueryFunction<false, false> = neon(url)

const DIR = join(process.cwd(), 'data', 'history')

/** The first Sleeper season. Everything before it comes from the workbook. */
const SLEEPER_FROM = 2020

function csv(name: string): Array<Record<string, string>> {
  const path = join(DIR, `${name}.csv`)
  if (!existsSync(path)) throw new Error(`missing ${path} — run scripts/history/xlsm-to-csv.py`)
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  const header = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]))
  })
}

/** '-' means unknown in this workbook, and unknown is not zero. */
function money(raw: string): number | null {
  if (!raw || raw === '-') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nImporting the workbook era into "${dbName}"${dryRun ? ' (dry run)' : ''}\n`)

  const totalsBefore = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`

  // --- gather ---------------------------------------------------------------
  const regular = csv('regular_season')
  const playoffs = csv('playoffs_legacy')
  const wins = csv('win_history')
  const legacy = csv('legacy_champions')
  const locations = csv('draft_locations')

  // Every season the workbook knows about, plus the ones already on record.
  const podium = new Map<number, { place: number; managerId: number; money: number | null }[]>()
  for (const r of wins) {
    const year = Number(r.championship_year)
    const list = podium.get(year) ?? []
    list.push({
      place: Number(r.place),
      managerId: managerIdForMemberId(Number(r.member_id)),
      money: money(r.money_won),
    })
    podium.set(year, list)
  }

  const place = (year: number, p: number) => podium.get(year)?.find((x) => x.place === p)

  const loc = new Map<number, { city: string; state: string; country: string }>()
  for (const r of locations) {
    if (!r.city) continue
    loc.set(Number(r.year), { city: r.city, state: r.state, country: r.country })
  }

  // Games played per pre-Sleeper season, from the records themselves.
  const weeksBySeason = new Map<number, Set<number>>()
  for (const r of regular) {
    const y = Number(r.reg_season_year)
    const games = Number(r.reg_season_wins) + Number(r.reg_season_losses)
    const set = weeksBySeason.get(y) ?? new Set<number>()
    set.add(games)
    weeksBySeason.set(y, set)
  }
  for (const [year, set] of weeksBySeason) {
    if (set.size !== 1) {
      throw new Error(`${year}: managers played different numbers of games (${[...set].join(', ')})`)
    }
  }

  const workbookYears = [...new Set(regular.map((r) => Number(r.reg_season_year)))].sort()
  const legacyYears = legacy.map((r) => Number(r.championship_year)).sort()
  const allYears = [...new Set([...legacyYears, ...workbookYears, ...loc.keys(), ...podium.keys()])].sort()

  // --- seasons --------------------------------------------------------------
  const seasonRows = allYears.map((year) => {
    const tier = year < 2011 ? 'legacy' : year < SLEEPER_FROM ? 'standings' : 'weekly'
    const l = loc.get(year)
    return {
      year,
      tier,
      weeks: [...(weeksBySeason.get(year) ?? [])][0] ?? null,
      city: l?.city ?? null,
      state: l?.state ?? null,
      country: l?.country ?? null,
      champion: place(year, 1),
      runnerUp: place(year, 2),
      third: place(year, 3),
    }
  })

  console.log(`  ${allYears.length} seasons on record: ${allYears[0]}–${allYears[allYears.length - 1]}`)
  console.log(`    legacy    ${seasonRows.filter((s) => s.tier === 'legacy').length}  (champion's name only)`)
  console.log(`    standings ${seasonRows.filter((s) => s.tier === 'standings').length}  (member-season totals)`)
  console.log(`    weekly    ${seasonRows.filter((s) => s.tier === 'weekly').length}  (already imported from Sleeper)`)

  // --- standings ------------------------------------------------------------
  const playoffByKey = new Map<string, { w: number; l: number }>()
  for (const r of playoffs) {
    playoffByKey.set(`${r.playoff_year}:${managerIdForMemberId(Number(r.member_id))}`, {
      w: Number(r.playoff_wins),
      l: Number(r.playoff_losses),
    })
  }

  const standingRows = regular
    .filter((r) => Number(r.reg_season_year) < SLEEPER_FROM)
    .map((r) => {
      const year = Number(r.reg_season_year)
      const managerId = managerIdForMemberId(Number(r.member_id))
      // Cross-check: the sheet names the member as well as numbering them.
      if (managerIdForName(r.member) !== managerId) {
        throw new Error(`${year}: member_id ${r.member_id} and name "${r.member}" disagree`)
      }
      const po = playoffByKey.get(`${year}:${managerId}`)
      return [
        year, managerId, Number(r.reg_season_place),
        Number(r.reg_season_wins), Number(r.reg_season_losses), 0,
        Number(r.points_for), Number(r.points_against),
        Boolean(po), po?.w ?? null, po?.l ?? null,
      ]
    })

  const byYear = new Map<number, number>()
  for (const row of standingRows) byYear.set(row[0] as number, (byYear.get(row[0] as number) ?? 0) + 1)
  for (const [year, n] of byYear) {
    if (n !== 10) throw new Error(`${year}: ${n} standings rows, expected 10`)
  }
  for (const year of [...byYear.keys()]) {
    const places = standingRows.filter((r) => r[0] === year).map((r) => r[2] as number).sort((a, b) => a - b)
    if (places.join(',') !== '1,2,3,4,5,6,7,8,9,10') {
      throw new Error(`${year}: places are not a permutation of 1-10 (${places.join(',')})`)
    }
  }
  console.log(`  ${standingRows.length} standings rows for ${byYear.size} pre-Sleeper seasons`)

  const legacyRows = legacy.map((r) => [
    Number(r.championship_year), r.member, money(r.money_won),
  ])
  console.log(`  ${legacyRows.length} legacy champions (${legacyYears[0]}–${legacyYears[legacyYears.length - 1]}), money unknown`)

  if (dryRun) {
    console.log('\n(dry run — nothing written)\n')
    return
  }

  // --- write ----------------------------------------------------------------
  for (const s of seasonRows) {
    await sql.query(
      `INSERT INTO seasons (season, data_tier, regular_season_weeks, draft_city, draft_state,
                            draft_country, champion_manager_id, runner_up_manager_id, third_manager_id,
                            champion_prize, runner_up_prize, third_prize, is_final)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
       ON CONFLICT (season) DO UPDATE SET
         -- data_tier and week count are the workbook's to state for its own
         -- years; never downgrade a season Sleeper already described.
         data_tier            = CASE WHEN seasons.data_tier = 'weekly' THEN 'weekly' ELSE excluded.data_tier END,
         regular_season_weeks = COALESCE(seasons.regular_season_weeks, excluded.regular_season_weeks),
         draft_city           = COALESCE(excluded.draft_city, seasons.draft_city),
         draft_state          = COALESCE(excluded.draft_state, seasons.draft_state),
         draft_country        = COALESCE(excluded.draft_country, seasons.draft_country),
         -- The podium for 2020+ came from Sleeper's bracket and agrees with this
         -- workbook on all fifteen placings. Keep it; only fill gaps.
         champion_manager_id  = COALESCE(seasons.champion_manager_id, excluded.champion_manager_id),
         runner_up_manager_id = COALESCE(seasons.runner_up_manager_id, excluded.runner_up_manager_id),
         third_manager_id     = COALESCE(seasons.third_manager_id, excluded.third_manager_id),
         -- Money exists nowhere else, so the workbook always wins.
         champion_prize       = COALESCE(excluded.champion_prize, seasons.champion_prize),
         runner_up_prize      = COALESCE(excluded.runner_up_prize, seasons.runner_up_prize),
         third_prize          = COALESCE(excluded.third_prize, seasons.third_prize)`,
      [
        s.year, s.tier, s.weeks, s.city, s.state, s.country,
        s.champion?.managerId ?? null, s.runnerUp?.managerId ?? null, s.third?.managerId ?? null,
        s.champion?.money ?? null, s.runnerUp?.money ?? null, s.third?.money ?? null,
      ],
    )
  }

  await sql.query(`DELETE FROM season_standings WHERE season < $1`, [SLEEPER_FROM])
  for (const row of standingRows) {
    await sql.query(
      `INSERT INTO season_standings (season, manager_id, place, wins, losses, ties,
                                     points_for, points_against, made_playoffs,
                                     playoff_wins, playoff_losses)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      row,
    )
  }

  await sql.query('DELETE FROM legacy_champions')
  for (const row of legacyRows) {
    await sql.query(
      'INSERT INTO legacy_champions (season, champion_name, money_won) VALUES ($1,$2,$3)',
      row,
    )
  }

  // --- prove nothing that matters moved ------------------------------------
  const totalsAfter = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`
  if (JSON.stringify(totalsBefore) !== JSON.stringify(totalsAfter)) {
    console.error('\n✗ manager_totals changed. History must never touch a live budget.')
    process.exit(1)
  }

  console.table(
    await sql`
      SELECT data_tier,
             min(season)::int AS from, max(season)::int AS to, count(*)::int AS seasons,
             count(champion_manager_id)::int AS with_champion,
             count(champion_prize)::int      AS with_money,
             count(draft_city)::int          AS with_location
        FROM seasons GROUP BY data_tier ORDER BY min(season)`,
  )
  const [{ n: standingsTotal }] = await sql`SELECT count(*)::int AS n FROM season_standings`
  const [{ n: legacyTotal }] = await sql`SELECT count(*)::int AS n FROM legacy_champions`
  console.log(`  ${standingsTotal} standings rows · ${legacyTotal} legacy champions`)
  console.log('\n✓ Workbook era imported. manager_totals unchanged.\n')
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
