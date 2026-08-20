/**
 * Pull the season in progress from Sleeper and import it. Run weekly.
 *
 *   npm run history:refresh                # the current season
 *   npm run history:refresh -- --season 2025
 *   npm run history:refresh -- --check     # report only, write nothing
 *
 * Wednesday is the right day: the NFL week finishes Monday night, and stat
 * corrections settle through Tuesday. Pulling before that means importing scores
 * that are still moving.
 *
 * ## Why this exists rather than re-running the backfill
 *
 * `history:pull` and `history:import-sleeper` cover 2020–2025, six settled
 * seasons. Re-pulling all of them every week to learn one new week of results
 * would churn six seasons of committed files for nothing, and would quietly
 * rewrite settled history if Sleeper ever revised an old number. This touches
 * exactly one season.
 *
 * ## It is safe to run when nothing has happened
 *
 * Out of season, or before week 1, Sleeper returns empty matchups and this
 * writes a season row with no games. Re-running is idempotent — the importer
 * deletes and re-inserts that one season — so a cron that fires every week of
 * the year is fine.
 *
 * ⚠️ **The season stays `is_final = false` until Sleeper says complete.** Nothing
 * here asserts a season is over; `draftComplete` and the archive both read that
 * flag, and marking a live season final would show a finished board in October.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CURRENT_SLEEPER_SEASON, SLEEPER_LEAGUE_IDS } from '../../src/lib/history-identity'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const args = process.argv.slice(2).filter((a) => a !== '--')
const checkOnly = args.includes('--check')
const seasonArg = args.indexOf('--season')
const season = seasonArg >= 0 ? Number(args[seasonArg + 1]) : CURRENT_SLEEPER_SEASON

function run(label: string, cmd: string, cmdArgs: string[]) {
  console.log(`\n▸ ${label}`)
  execFileSync(cmd, cmdArgs, { stdio: 'inherit', cwd: ROOT })
}

async function main() {
  const leagueId = SLEEPER_LEAGUE_IDS[season]
  if (!leagueId) {
    console.error(
      `\n✗ No league id pinned for ${season}. Add it to SLEEPER_LEAGUE_IDS — and never resolve ` +
        'it by name, because the account holds other leagues and the names repeat.\n',
    )
    process.exit(1)
  }

  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sleeper returned ${res.status} for league ${leagueId}`)
  const league = (await res.json()) as {
    name: string
    status?: string
    settings: { leg?: number; playoff_week_start?: number }
  }

  const week = league.settings.leg ?? 0
  console.log(
    `\n${season} · ${league.name} · status ${league.status ?? 'unknown'} · week ${week}\n`,
  )

  if (checkOnly) {
    const dir = join(ROOT, 'data', 'sleeper', String(season))
    const have = existsSync(join(dir, 'MANIFEST.json'))
    console.log(`  files on disk: ${have ? 'yes' : 'no'}`)
    if (have) {
      const manifest = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8'))
      console.log(`  pinned league: ${manifest.league_id}`)
    }
    console.log('\n(check only — nothing written)\n')
    return
  }

  // --force, because the point is to overwrite last week's snapshot.
  run(`pull ${season} from Sleeper`, 'npx', [
    'tsx',
    'scripts/history/pull-sleeper.ts',
    '--season',
    String(season),
    '--force',
  ])

  run(`import ${season}`, 'npx', [
    'tsx',
    'scripts/import-sleeper-history.ts',
    '--season',
    String(season),
  ])

  console.log(
    `\n✓ ${season} refreshed through week ${week}.` +
      (league.status === 'complete'
        ? ' Season complete — marked final.\n'
        : ' Season still in progress.\n'),
  )
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
