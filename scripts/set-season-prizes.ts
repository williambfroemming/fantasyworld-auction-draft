/**
 * Record what a season paid out.
 *
 *   npm run season:prizes                                   # show every season
 *   npm run season:prizes -- 2025                           # show one
 *   npm run season:prizes -- 2025 --champion 2100 --runner-up 600 --third 300
 *   npm run season:prizes -- 2025 --high 10 --low 10        # the weekly side bet
 *   npm run season:prizes -- 2025 --champion none           # back to unknown
 *
 * Prize money is a league fact that exists in no API and changes from year to
 * year — the pot has grown from $0 in 2011 to $2,100 for a championship in 2024.
 * The workbook carried it up to 2024; from 2025 on it has to be entered, and this
 * is where.
 *
 * ## Null is unknown, and that is a real state
 *
 * A season with no prize recorded is **not** a season that paid nothing. 2006–2010
 * genuinely paid something nobody wrote down, while 2011–2013 genuinely paid zero,
 * and a career-earnings total that treats those the same is quietly authoritative
 * about years it knows nothing about. So `--champion none` clears a value back to
 * unknown rather than setting it to 0, and `0` means an actual zero payout.
 *
 * This writes only to `seasons` and touches nothing the draft uses.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set.')
const sql: NeonQueryFunction<false, false> = neon(url)

const argv = process.argv.slice(2).filter((a) => a !== '--')
const season = argv[0] && /^\d{4}$/.test(argv[0]) ? Number(argv[0]) : null

/** `undefined` = leave alone · `null` = clear to unknown · number = set. */
function flag(name: string): number | null | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return undefined
  const raw = argv[i + 1]
  if (raw === undefined) throw new Error(`--${name} needs a value (a number, or "none")`)
  if (raw === 'none' || raw === 'null') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number of dollars, or "none"`)
  return n
}

const FIELDS: Array<[string, string]> = [
  ['champion', 'champion_prize'],
  ['runner-up', 'runner_up_prize'],
  ['third', 'third_prize'],
  ['high', 'high_score_payout'],
  ['low', 'low_score_penalty'],
]

const money = (v: unknown) => (v === null || v === undefined ? '—' : `$${v}`)

async function show(only: number | null) {
  const rows = only
    ? await sql`SELECT season, data_tier, champion_prize, runner_up_prize, third_prize,
                       high_score_payout, low_score_penalty
                  FROM seasons WHERE season = ${only}`
    : await sql`SELECT season, data_tier, champion_prize, runner_up_prize, third_prize,
                       high_score_payout, low_score_penalty
                  FROM seasons ORDER BY season`
  if (!rows.length) {
    console.log(`\nNo season ${only} on record.\n`)
    return
  }
  console.log('')
  console.table(
    rows.map((r) => ({
      season: r.season,
      tier: r.data_tier,
      champion: money(r.champion_prize),
      'runner-up': money(r.runner_up_prize),
      third: money(r.third_prize),
      'high wk': money(r.high_score_payout),
      'low wk': money(r.low_score_penalty),
    })),
  )
  console.log('  — means unknown, which is not the same as $0.\n')
}

async function main() {
  const updates = FIELDS.map(([name, column]) => [column, flag(name)] as const).filter(
    ([, v]) => v !== undefined,
  )

  if (!updates.length) {
    await show(season)
    if (!season) console.log('  Set one with:  npm run season:prizes -- 2025 --champion 2100\n')
    return
  }
  if (!season) throw new Error('name the season first:  npm run season:prizes -- 2025 --champion 2100')

  const [exists] = await sql`SELECT season FROM seasons WHERE season = ${season}`
  if (!exists) throw new Error(`No season ${season} on record — import it before pricing it.`)

  // One statement, so a half-applied payout cannot exist.
  const sets = updates.map(([column], i) => `${column} = $${i + 2}`).join(', ')
  await sql.query(`UPDATE seasons SET ${sets} WHERE season = $1`, [
    season,
    ...updates.map(([, v]) => v),
  ])

  console.log(`\n✓ ${season}: ${updates.map(([c, v]) => `${c} = ${money(v)}`).join(', ')}`)
  await show(season)
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
