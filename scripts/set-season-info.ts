/**
 * Record the things about a season that exist in no API.
 *
 *   npm run season:info                                   # show every season
 *   npm run season:info -- 2026                           # show one
 *   npm run season:info -- 2026 --city "San Diego" --state CA
 *   npm run season:info -- 2026 --champion 2100 --runner-up 600 --third 300
 *   npm run season:info -- 2026 --buy-in 200
 *   npm run season:info -- 2025 --side-bet 10      # low scorer pays high scorer
 *   npm run season:info -- 2026 --champion none           # back to unknown
 *
 * Two kinds of league fact live here, and neither is derivable:
 *
 *  - **Prize money**, which changes from year to year — the pot has grown from $0
 *    in 2011 to $2,100 for a championship in 2024. The workbook carried it up to
 *    2024; from 2025 on it has to be entered.
 *  - **Where the draft was held.** The league has met in Deerfield, Madison,
 *    Denver, Las Vegas, Nashville, Scottsdale and San Diego, and that is half the
 *    fun of the archive. The workbook's `draft_locations` covered 2010-2025.
 *
 * The natural home for the location is the commissioner's setup screen, entered
 * on the night alongside the draft order — this script is what fills the gap
 * until then, and remains the way to correct a past year.
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

const MONEY_FIELDS: Array<[string, string]> = [
  ['champion', 'champion_prize'],
  ['runner-up', 'runner_up_prize'],
  ['third', 'third_prize'],
  ['buy-in', 'buy_in'],
  // What the low scorer pays the high scorer each week. Null is unknown rather
  // than "no bet" -- the league has only run it for the last couple of seasons,
  // and the Gazette's Ledger prints dollars only for the years that have a rate.
  ['side-bet', 'side_bet'],
]

const TEXT_FIELDS: Array<[string, string]> = [
  ['city', 'draft_city'],
  ['state', 'draft_state'],
  ['country', 'draft_country'],
]

/** `undefined` = leave alone · `null` = clear · string = set. */
function textFlag(name: string): string | null | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return undefined
  const raw = argv[i + 1]
  if (raw === undefined) throw new Error(`--${name} needs a value, or "none"`)
  if (raw === 'none' || raw === 'null') return null
  return raw
}

const money = (v: unknown) => (v === null || v === undefined ? '—' : `$${v}`)

async function show(only: number | null) {
  const rows = only
    ? await sql`SELECT season, data_tier, champion_prize, runner_up_prize, third_prize,
                       buy_in, side_bet, draft_city, draft_state
                  FROM seasons WHERE season = ${only}`
    : await sql`SELECT season, data_tier, champion_prize, runner_up_prize, third_prize,
                       buy_in, side_bet, draft_city, draft_state
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
      'buy-in': money(r.buy_in),
      'side bet': money(r.side_bet),
      drafted: r.draft_city ? `${r.draft_city}${r.draft_state ? `, ${r.draft_state}` : ''}` : '—',
    })),
  )
  console.log('  — means unknown, which is not the same as $0.\n')
}

async function main() {
  const updates = [
    ...MONEY_FIELDS.map(([name, column]) => [column, flag(name)] as const),
    ...TEXT_FIELDS.map(([name, column]) => [column, textFlag(name)] as const),
  ].filter(([, v]) => v !== undefined)

  if (!updates.length) {
    await show(season)
    if (!season) console.log('  Set one with:  npm run season:info -- 2026 --city "San Diego" --state CA\n')
    return
  }
  if (!season) throw new Error('name the season first:  npm run season:info -- 2026 --city "San Diego"')

  const [exists] = await sql`SELECT season FROM seasons WHERE season = ${season}`
  if (!exists) throw new Error(`No season ${season} on record — import it before pricing it.`)

  // One statement, so a half-applied payout cannot exist.
  const sets = updates.map(([column], i) => `${column} = $${i + 2}`).join(', ')
  await sql.query(`UPDATE seasons SET ${sets} WHERE season = $1`, [
    season,
    ...updates.map(([, v]) => v),
  ])

  console.log(
    `\n✓ ${season}: ${updates
      .map(([c, v]) => `${c} = ${typeof v === 'number' ? money(v) : (v ?? '—')}`)
      .join(', ')}`,
  )
  await show(season)
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
