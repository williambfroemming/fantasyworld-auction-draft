/**
 * Pull the league's Sleeper seasons to disk, verbatim.
 *
 *   npm run history:pull                # every importable season (2020-2025)
 *   npm run history:pull -- --season 2022
 *   npm run history:pull -- --force     # refetch even if the files exist
 *
 * Writes raw, unmodified API responses to `data/sleeper/<season>/`, plus a
 * MANIFEST.json of counts and sha256s. Every importer verifies that manifest
 * before it opens a database connection.
 *
 * ## Why the responses are committed rather than fetched at import time
 *
 * Three reasons, in order of weight:
 *
 *  1. **The import becomes reproducible and reviewable.** What Sleeper said on
 *     the day is in the repo, diffable. If a later import produces different
 *     numbers, the manifest says whether the source moved or our code did.
 *  2. **Sleeper is not a database we control.** Leagues can be deleted and
 *     history is not guaranteed. Sixteen years of league record should not
 *     depend on a third party staying up, which is the same argument
 *     `docs/BACKLOG.md` §1 makes for storing injury status in a column.
 *  3. **It keeps the network off every subsequent run.** `npm run history:import`
 *     works offline, in CI, and on a plane.
 *
 * ## This is a setup script and never touches a request path
 *
 * `docs/PROJECT_PLAN.md` §9 bans Sleeper from any request path. Nothing here is
 * imported by the app; it writes files and exits.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SLEEPER_IMPORT_SEASONS,
  SLEEPER_LEAGUE_IDS,
  verifyLeagueChain,
} from '../../src/lib/history-identity'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_ROOT = join(ROOT, 'data', 'sleeper')
const API = 'https://api.sleeper.app/v1'

/** Sleeper asks for restraint rather than publishing a hard limit. ~120 calls total. */
const PAUSE_MS = 120

const args = process.argv.slice(2)
const force = args.includes('--force')
const seasonArg = args.indexOf('--season')
const seasons: number[] =
  seasonArg >= 0 ? [Number(args[seasonArg + 1])] : [...SLEEPER_IMPORT_SEASONS]

interface LeagueSettings {
  playoff_week_start?: number
  playoff_teams?: number
  leg?: number
}
interface League {
  league_id: string
  previous_league_id: string | null
  name: string
  total_rosters: number
  roster_positions: string[]
  settings: LeagueSettings
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sleeper returned ${res.status} ${res.statusText} for /${path}`)
  await sleep(PAUSE_MS)
  return (await res.json()) as T
}

/** Stable formatting so an unchanged season re-hashes identically. */
function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writeJson(season: number, name: string, value: unknown) {
  const dir = join(OUT_ROOT, String(season))
  await mkdir(dir, { recursive: true })
  const body = serialize(value)
  await writeFile(join(dir, `${name}.json`), body, 'utf8')
  return {
    sha256: createHash('sha256').update(body).digest('hex'),
    count: Array.isArray(value) ? value.length : null,
  }
}

async function pullSeason(season: number) {
  const leagueId = SLEEPER_LEAGUE_IDS[season]
  if (!leagueId) throw new Error(`no pinned league id for ${season}`)

  const league = await get<League>(`league/${leagueId}`)
  const files: Record<string, { sha256: string; count: number | null }> = {}

  files['league'] = await writeJson(season, 'league', league)
  files['users'] = await writeJson(season, 'users', await get(`league/${leagueId}/users`))
  files['rosters'] = await writeJson(season, 'rosters', await get(`league/${leagueId}/rosters`))

  // The bracket is three rounds from playoff_week_start, so that plus two is the
  // last week that can contain a game. Pulling a week beyond the season returns
  // an empty array rather than an error, which is harmless.
  const playoffStart = league.settings.playoff_week_start ?? 15
  const lastWeek = playoffStart + 2
  for (let week = 1; week <= lastWeek; week++) {
    const w = String(week).padStart(2, '0')
    files[`matchups-${w}`] = await writeJson(
      season,
      `matchups-${w}`,
      await get(`league/${leagueId}/matchups/${week}`),
    )
  }

  files['winners_bracket'] = await writeJson(
    season,
    'winners_bracket',
    await get(`league/${leagueId}/winners_bracket`),
  )
  files['losers_bracket'] = await writeJson(
    season,
    'losers_bracket',
    await get(`league/${leagueId}/losers_bracket`),
  )

  // Draft picks are pulled for the roster cross-check ONLY. Sleeper's auction
  // amounts for this league are a formality -- 2022, 2023 and 2025 each record
  // 160 picks totalling exactly $160, every pick $1, because the room drafted on
  // a Google Sheet and the results were entered afterwards purely to set
  // rosters. 2024 has no picks at all. The prices live in the workbook and the
  // 2025 draft sheet; what these are good for is verifying WHICH players each
  // manager took, which caught a duplicated row and a missing pick in 2022.
  const drafts = await get<Array<{ draft_id: string }>>(`league/${leagueId}/drafts`)
  files['drafts'] = await writeJson(season, 'drafts', drafts)
  const picks = drafts.length ? await get(`draft/${drafts[0].draft_id}/picks`) : []
  files['draft_picks'] = await writeJson(season, 'draft_picks', picks)

  const starters = league.roster_positions.filter((p) => p !== 'BN').length
  console.log(
    `  ${season}  ${league.name.padEnd(20)} ${league.total_rosters} rosters · ` +
      `${starters} starters · reg 1-${playoffStart - 1} · playoffs ${playoffStart}-${lastWeek} · ` +
      `${Array.isArray(picks) ? picks.length : 0} draft picks`,
  )

  return { leagueId, league, files }
}

async function main() {
  console.log(`\nPulling Sleeper seasons ${seasons.join(', ')}\n`)

  const manifest: Record<string, unknown> = {}
  const chain: Record<number, { league_id: string; previous_league_id: string | null }> = {}

  for (const season of seasons) {
    const dir = join(OUT_ROOT, String(season))
    if (!force && existsSync(join(dir, 'MANIFEST.json'))) {
      console.log(`  ${season}  already pulled (use --force to refetch)`)
      const prior = JSON.parse(await readFile(join(dir, 'MANIFEST.json'), 'utf8'))
      manifest[season] = prior
      chain[season] = {
        league_id: prior.league_id,
        previous_league_id: prior.previous_league_id ?? null,
      }
      continue
    }
    const { leagueId, league, files } = await pullSeason(season)
    const entry = {
      league_id: leagueId,
      previous_league_id: league.previous_league_id,
      name: league.name,
      roster_positions: league.roster_positions,
      playoff_week_start: league.settings.playoff_week_start ?? null,
      playoff_teams: league.settings.playoff_teams ?? null,
      files,
    }
    await writeFile(join(dir, 'MANIFEST.json'), serialize(entry), 'utf8')
    manifest[season] = entry
    chain[season] = { league_id: leagueId, previous_league_id: league.previous_league_id }
  }

  // The check that stops this importing a stranger's league. See the warning on
  // SLEEPER_LEAGUE_IDS: the account also holds an 18-team Guillotine League, and
  // the real 2025 league is misnamed with 2024's name, so matching on names
  // picks the wrong one and every downstream number looks entirely plausible.
  if (seasons.length > 1) {
    verifyLeagueChain(chain)
    console.log('\n  ✓ previous_league_id chain matches the pinned ids')
  }

  await writeFile(join(OUT_ROOT, 'MANIFEST.json'), serialize(manifest), 'utf8')
  console.log(`\nwrote ${seasons.length} season(s) to ${OUT_ROOT}\n`)
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
